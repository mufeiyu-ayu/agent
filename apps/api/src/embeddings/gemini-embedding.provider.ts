import type {
  EmbeddingProvider,
  EmbeddingResult,
  EmbeddingRuntimeConfig,
} from './embedding-provider.js'
import process from 'node:process'
import { ApiError, GoogleGenAI } from '@google/genai'
import { EnvHttpProxyAgent, setGlobalDispatcher } from 'undici'
import {
  ACTIVE_EMBEDDING_PROFILE,
  EMBEDDING_ATTEMPT_TIMEOUT_MS,
  EMBEDDING_BATCH_INPUTS,
  EMBEDDING_RETRIES,
  EmbeddingAbortError,
  EmbeddingError,
} from './embedding-provider.js'

let environmentProxyConfigured = false

interface GeminiEmbeddingRequest {
  model: string
  contents: Array<{
    parts: Array<{ text: string }>
  }>
  config: {
    outputDimensionality: number
    abortSignal: AbortSignal
    httpOptions: {
      timeout: number
      retryOptions: { attempts: number }
    }
  }
}

interface GeminiEmbeddingResponse {
  embeddings?: Array<{ values?: number[] }>
}

export interface GeminiEmbeddingClient {
  models: {
    embedContent: (
      request: GeminiEmbeddingRequest,
    ) => Promise<GeminiEmbeddingResponse>
  }
}

export class GeminiEmbeddingProvider implements EmbeddingProvider {
  readonly profile = ACTIVE_EMBEDDING_PROFILE
  private readonly client: GeminiEmbeddingClient

  constructor(
    private readonly config: EmbeddingRuntimeConfig,
    client?: GeminiEmbeddingClient,
  ) {
    this.client = client ?? createGeminiEmbeddingClient(config)
  }

  async embed(
    inputs: readonly string[],
    options: { signal: AbortSignal },
  ): Promise<EmbeddingResult> {
    if (options.signal.aborted)
      throw new EmbeddingAbortError(0, 0)
    if (inputs.length === 0)
      return { vectors: [], providerRequests: 0, retryCount: 0 }
    if (inputs.some(input => typeof input !== 'string' || input.length === 0)) {
      throw new EmbeddingError(
        'embedding input 必须是非空字符串',
        'invalid_request',
        false,
      )
    }

    const vectors: number[][] = []
    // 重试在 SDK 内部完成，这里只能数到 embedContent 调用次数；retryCount 恒为 0。
    let providerRequests = 0

    for (let offset = 0; offset < inputs.length; offset += EMBEDDING_BATCH_INPUTS) {
      if (options.signal.aborted)
        throw new EmbeddingAbortError(providerRequests, 0)
      const batch = inputs.slice(offset, offset + EMBEDDING_BATCH_INPUTS)
      providerRequests += 1

      const requestAbort = createRequestAbort(options.signal)
      try {
        const response = await this.client.models.embedContent({
          model: this.config.model,
          contents: batch.map(text => ({ parts: [{ text }] })),
          config: {
            outputDimensionality: this.config.dimensions,
            abortSignal: requestAbort.signal,
            httpOptions: {
              timeout: EMBEDDING_ATTEMPT_TIMEOUT_MS,
              // 退避用 SDK 默认（1s 起、×2、带 jitter）；SDK 不读 Retry-After，
              // 也不重试 Node 的 `fetch failed`，见 classifyEmbeddingError。
              retryOptions: { attempts: 1 + EMBEDDING_RETRIES },
            },
          },
        })
        options.signal.throwIfAborted()
        vectors.push(...validateGeminiEmbeddingResponse(
          response,
          batch.length,
          this.config.dimensions,
        ))
      }
      catch (cause) {
        if (options.signal.aborted)
          throw new EmbeddingAbortError(providerRequests, 0)
        const error = classifyEmbeddingError(cause)
        // 走到这里说明 SDK 已用完 attempts，可重试类错误统一按耗尽上报。
        throw error.retryable
          ? new EmbeddingError(
              `embedding ${error.code} 重试已耗尽`,
              'retry_exhausted',
              false,
              providerRequests,
            )
          : new EmbeddingError(error.message, error.code, false, providerRequests)
      }
      finally {
        requestAbort.cleanup()
      }
    }

    return { vectors, providerRequests, retryCount: 0 }
  }
}

function createRequestAbort(parent: AbortSignal): {
  signal: AbortSignal
  cleanup: () => void
} {
  const controller = new AbortController()
  const abort = (): void => controller.abort(parent.reason)

  if (parent.aborted)
    abort()
  else
    parent.addEventListener('abort', abort, { once: true })

  return {
    signal: controller.signal,
    cleanup: () => parent.removeEventListener('abort', abort),
  }
}

export function createGeminiEmbeddingClient(
  config: EmbeddingRuntimeConfig,
): GeminiEmbeddingClient {
  configureEnvironmentProxy()
  const client = new GoogleGenAI({ apiKey: config.apiKey })

  return {
    models: {
      embedContent: async request => await client.models.embedContent(request),
    },
  }
}

function configureEnvironmentProxy(): void {
  if (
    environmentProxyConfigured
    || ![
      'HTTPS_PROXY',
      'https_proxy',
      'HTTP_PROXY',
      'http_proxy',
    ].some(name => process.env[name]?.trim())
  ) {
    return
  }

  setGlobalDispatcher(new EnvHttpProxyAgent())
  environmentProxyConfigured = true
}

export function validateGeminiEmbeddingResponse(
  response: unknown,
  expectedCount: number,
  expectedDimensions: number,
): number[][] {
  const record = response as { embeddings?: unknown }

  if (
    typeof record !== 'object'
    || record === null
    || !Array.isArray(record.embeddings)
    || record.embeddings.length !== expectedCount
  ) {
    throw protocolError('embedding response 数量不匹配')
  }

  return record.embeddings.map((item) => {
    const embedding = item as { values?: unknown }
    if (
      typeof embedding !== 'object'
      || embedding === null
      || !Array.isArray(embedding.values)
      || embedding.values.length !== expectedDimensions
      || embedding.values.some(value => (
        typeof value !== 'number' || !Number.isFinite(value)
      ))
      || !embedding.values.some(value => value !== 0)
    ) {
      throw protocolError('embedding response 顺序、维度或数值非法')
    }

    return [...embedding.values] as number[]
  })
}

/**
 * 把 SDK 抛出的错误归类为项目错误码。
 *
 * `retryable` 决定耗尽后是否按 `retry_exhausted` 上报。SDK 内置重试（p-retry@4）对
 * 408 / 429 / 5xx 与每次尝试的 timeout 一律重试、不看响应体，所以 daily quota 的 429
 * 也会被 SDK 多打两次，这里仍按不可重试的 rate_limit 上报以保留原因；Node fetch 的
 * `TypeError: fetch failed` 则不会被 SDK 重试（p-retry 只放行浏览器网络错误文案），
 * network 直接失败。
 */
function classifyEmbeddingError(cause: unknown): EmbeddingError {
  if (cause instanceof EmbeddingError)
    return cause
  if (isAbortError(cause)) {
    return new EmbeddingError(
      'embedding request timeout',
      'timeout',
      true,
    )
  }
  if (cause instanceof TypeError) {
    return new EmbeddingError(
      'embedding network error',
      'network',
      false,
    )
  }
  if (cause instanceof ApiError) {
    if (cause.status === 408) {
      return new EmbeddingError(
        'embedding request timeout',
        'timeout',
        true,
      )
    }
    if (cause.status === 429) {
      const dailyQuotaExceeded = /PerDay|per day|requests per day|\bRPD\b/i
        .test(cause.message)
      return new EmbeddingError(
        dailyQuotaExceeded
          ? 'embedding daily quota exhausted'
          : 'embedding rate limited',
        'rate_limit',
        !dailyQuotaExceeded,
      )
    }
    if (cause.status >= 500) {
      return new EmbeddingError(
        'embedding server error',
        'server',
        true,
      )
    }
    if (
      cause.status === 401
      || cause.status === 403
      || (
        cause.status === 400
        && /API_KEY_INVALID|API key not valid/i.test(cause.message)
      )
    ) {
      return new EmbeddingError(
        'embedding authentication or permission error',
        'authentication',
        false,
      )
    }
    if (cause.status >= 400) {
      return new EmbeddingError(
        'embedding request rejected',
        'invalid_request',
        false,
      )
    }
  }

  return new EmbeddingError(
    'embedding provider error',
    'unknown',
    false,
  )
}

function protocolError(message: string): EmbeddingError {
  return new EmbeddingError(message, 'protocol', false)
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}
