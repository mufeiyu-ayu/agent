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
  EmbeddingAbortError,
  EmbeddingError,
} from './embedding-provider.js'

const RETRY_BASE_DELAY_MS = 250
const RATE_LIMIT_FALLBACK_DELAY_MS = 60_000
const RATE_LIMIT_MAX_DELAY_MS = 60_000
const RATE_LIMIT_SAFETY_MARGIN_MS = 1_000
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
      retryOptions: { attempts: 1 }
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

type RetrySleep = (milliseconds: number, signal: AbortSignal) => Promise<void>

export class GeminiEmbeddingProvider implements EmbeddingProvider {
  readonly profile = ACTIVE_EMBEDDING_PROFILE
  private readonly client: GeminiEmbeddingClient

  constructor(
    private readonly config: EmbeddingRuntimeConfig,
    client?: GeminiEmbeddingClient,
    private readonly retrySleep: RetrySleep = sleepWithAbort,
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
    let providerRequests = 0
    let retryCount = 0

    for (let offset = 0; offset < inputs.length; offset += this.config.batchSize) {
      if (options.signal.aborted)
        throw new EmbeddingAbortError(providerRequests, retryCount)
      const batch = inputs.slice(offset, offset + this.config.batchSize)

      try {
        const result = await this.embedBatch(batch, options.signal)
        vectors.push(...result.vectors)
        providerRequests += result.providerRequests
        retryCount += result.retryCount
      }
      catch (cause) {
        if (cause instanceof EmbeddingAbortError) {
          throw new EmbeddingAbortError(
            providerRequests + cause.providerRequests,
            retryCount + cause.retryCount,
          )
        }
        if (cause instanceof EmbeddingError) {
          throw new EmbeddingError(
            cause.message,
            cause.code,
            cause.retryable,
            providerRequests + cause.providerRequests,
            retryCount + cause.retryCount,
          )
        }
        throw cause
      }
    }

    return { vectors, providerRequests, retryCount }
  }

  private async embedBatch(
    inputs: string[],
    signal: AbortSignal,
  ): Promise<EmbeddingResult> {
    let providerRequests = 0
    let retryCount = 0

    for (let attempt = 0; ; attempt += 1) {
      if (signal.aborted)
        throw new EmbeddingAbortError(providerRequests, retryCount)
      providerRequests += 1

      try {
        const requestAbort = createRequestAbort(signal)
        let response: GeminiEmbeddingResponse
        try {
          response = await this.client.models.embedContent({
            model: this.config.model,
            contents: inputs.map(text => ({ parts: [{ text }] })),
            config: {
              outputDimensionality: this.config.dimensions,
              abortSignal: requestAbort.signal,
              httpOptions: {
                timeout: this.config.requestTimeoutMs,
                // The project owns retries and metrics; one SDK attempt prevents
                // hidden retries from stacking underneath this loop.
                retryOptions: { attempts: 1 },
              },
            },
          })
        }
        finally {
          requestAbort.cleanup()
        }
        if (signal.aborted)
          throw new EmbeddingAbortError(providerRequests, retryCount)

        return {
          vectors: validateGeminiEmbeddingResponse(
            response,
            inputs.length,
            this.config.dimensions,
          ),
          providerRequests,
          retryCount,
        }
      }
      catch (cause) {
        if (cause instanceof EmbeddingAbortError)
          throw cause
        if (signal.aborted) {
          throw new EmbeddingAbortError(
            providerRequests,
            retryCount,
          )
        }

        const error = classifyEmbeddingError(cause)
        if (!error.retryable)
          throw withMetrics(error, providerRequests, retryCount)
        if (attempt >= this.config.maxRetries) {
          throw new EmbeddingError(
            `embedding ${error.code} 重试已耗尽`,
            'retry_exhausted',
            false,
            providerRequests,
            retryCount,
          )
        }

        retryCount += 1
        try {
          await this.retrySleep(
            error.code === 'rate_limit'
              ? error.retryAfterMs
              : RETRY_BASE_DELAY_MS * 2 ** attempt,
            signal,
          )
        }
        catch (cause) {
          if (signal.aborted || isAbortError(cause)) {
            throw new EmbeddingAbortError(
              providerRequests,
              retryCount,
            )
          }
          throw cause
        }
      }
    }
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
      true,
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
        0,
        0,
        readRateLimitRetryDelayMs(cause.message),
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

function withMetrics(
  error: EmbeddingError,
  providerRequests: number,
  retryCount: number,
): EmbeddingError {
  return new EmbeddingError(
    error.message,
    error.code,
    error.retryable,
    providerRequests,
    retryCount,
    error.retryAfterMs,
  )
}

function readRateLimitRetryDelayMs(message: string): number {
  const match = /(?:retry in |retryDelay\D+)(\d+(?:\.\d+)?)s/i.exec(message)
  const seconds = Number(match?.[1])

  if (!Number.isFinite(seconds) || seconds <= 0)
    return RATE_LIMIT_FALLBACK_DELAY_MS

  return Math.min(
    RATE_LIMIT_MAX_DELAY_MS,
    Math.ceil(seconds * 1_000) + RATE_LIMIT_SAFETY_MARGIN_MS,
  )
}

async function sleepWithAbort(
  milliseconds: number,
  signal: AbortSignal,
): Promise<void> {
  if (signal.aborted)
    throw new DOMException('embedding retry aborted', 'AbortError')

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(finish, milliseconds)
    const abort = (): void => {
      clearTimeout(timer)
      signal.removeEventListener('abort', abort)
      reject(new DOMException('embedding retry aborted', 'AbortError'))
    }
    function finish(): void {
      signal.removeEventListener('abort', abort)
      resolve()
    }
    signal.addEventListener('abort', abort, { once: true })
  })
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}
