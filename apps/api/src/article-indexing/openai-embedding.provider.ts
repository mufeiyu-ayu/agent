import type { CreateEmbeddingResponse } from 'openai/resources/embeddings'
import type {
  EmbeddingProvider,
  EmbeddingResult,
  EmbeddingRuntimeConfig,
} from './embedding-provider.js'
import OpenAI, {
  APIConnectionError,
  APIConnectionTimeoutError,
  APIError,
  APIUserAbortError,
} from 'openai'

import {
  ACTIVE_EMBEDDING_PROFILE,
  EmbeddingAbortError,
  EmbeddingError,
} from './embedding-provider.js'

const RETRY_BASE_DELAY_MS = 250

export interface OpenAIEmbeddingClient {
  embeddings: {
    create: (
      body: {
        input: string[]
        model: string
        dimensions: number
        encoding_format: 'float'
      },
      options: { timeout: number, signal: AbortSignal },
    ) => Promise<CreateEmbeddingResponse>
  }
}

type RetrySleep = (milliseconds: number, signal: AbortSignal) => Promise<void>

export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  readonly profile = ACTIVE_EMBEDDING_PROFILE
  private readonly client: OpenAIEmbeddingClient

  constructor(
    private readonly config: EmbeddingRuntimeConfig,
    client?: OpenAIEmbeddingClient,
    private readonly retrySleep: RetrySleep = sleepWithAbort,
  ) {
    this.client = client ?? createOpenAIEmbeddingClient(config)
  }

  async embed(
    inputs: readonly string[],
    options: { signal: AbortSignal },
  ): Promise<EmbeddingResult> {
    options.signal.throwIfAborted()
    if (inputs.length === 0) {
      return { vectors: [], providerRequests: 0, retryCount: 0 }
    }
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
            { cause },
          )
        }
        if (cause instanceof EmbeddingError) {
          throw new EmbeddingError(
            cause.message,
            cause.code,
            cause.retryable,
            providerRequests + cause.providerRequests,
            retryCount + cause.retryCount,
            { cause },
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
      signal.throwIfAborted()
      providerRequests += 1

      try {
        const response = await this.client.embeddings.create({
          input: inputs,
          model: this.config.model,
          dimensions: this.config.dimensions,
          encoding_format: 'float',
        }, {
          timeout: this.config.requestTimeoutMs,
          signal,
        })
        signal.throwIfAborted()

        return {
          vectors: validateEmbeddingResponse(
            response,
            inputs.length,
            this.config.model,
            this.config.dimensions,
          ),
          providerRequests,
          retryCount,
        }
      }
      catch (cause) {
        if (signal.aborted || cause instanceof APIUserAbortError) {
          throw new EmbeddingAbortError(
            providerRequests,
            retryCount,
            { cause },
          )
        }

        const error = classifyEmbeddingError(cause)
        if (!error.retryable) {
          throw withMetrics(error, providerRequests, retryCount)
        }
        if (attempt >= this.config.maxRetries) {
          throw new EmbeddingError(
            `embedding ${error.code} 重试已耗尽`,
            'retry_exhausted',
            false,
            providerRequests,
            retryCount,
            { cause: error },
          )
        }

        retryCount += 1
        try {
          await this.retrySleep(
            RETRY_BASE_DELAY_MS * 2 ** attempt,
            signal,
          )
        }
        catch (cause) {
          if (signal.aborted || isAbortError(cause)) {
            throw new EmbeddingAbortError(
              providerRequests,
              retryCount,
              { cause },
            )
          }
          throw cause
        }
      }
    }
  }
}

export function createOpenAIEmbeddingClient(
  config: EmbeddingRuntimeConfig,
): OpenAIEmbeddingClient {
  return new OpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseUrl,
    organization: null,
    project: null,
    maxRetries: 0,
    logLevel: 'off',
  })
}

export function validateEmbeddingResponse(
  response: unknown,
  expectedCount: number,
  expectedModel: string,
  expectedDimensions: number,
): number[][] {
  const record = response as {
    data?: unknown
    model?: unknown
  }

  if (
    typeof record !== 'object'
    || record === null
    || record.model !== expectedModel
    || !Array.isArray(record.data)
    || record.data.length !== expectedCount
  ) {
    throw protocolError('embedding response 数量或 model 不匹配')
  }

  return record.data.map((item, position) => {
    const embedding = item as { index?: unknown, embedding?: unknown }
    if (
      typeof embedding !== 'object'
      || embedding === null
      || embedding.index !== position
      || !Array.isArray(embedding.embedding)
      || embedding.embedding.length !== expectedDimensions
      || embedding.embedding.some(value => (
        typeof value !== 'number' || !Number.isFinite(value)
      ))
    ) {
      throw protocolError('embedding response index、顺序、维度或数值非法')
    }

    return [...embedding.embedding] as number[]
  })
}

function classifyEmbeddingError(cause: unknown): EmbeddingError {
  if (cause instanceof EmbeddingError)
    return cause
  if (cause instanceof APIConnectionTimeoutError) {
    return new EmbeddingError(
      'embedding request timeout',
      'timeout',
      true,
      0,
      0,
      { cause },
    )
  }
  if (cause instanceof APIConnectionError) {
    return new EmbeddingError(
      'embedding network error',
      'network',
      true,
      0,
      0,
      { cause },
    )
  }
  if (cause instanceof APIError) {
    if (cause.status === 408) {
      return new EmbeddingError(
        'embedding request timeout',
        'timeout',
        true,
        0,
        0,
        { cause },
      )
    }
    if (cause.status === 429) {
      return new EmbeddingError(
        'embedding rate limited',
        'rate_limit',
        true,
        0,
        0,
        { cause },
      )
    }
    if (typeof cause.status === 'number' && cause.status >= 500) {
      return new EmbeddingError(
        'embedding server error',
        'server',
        true,
        0,
        0,
        { cause },
      )
    }
    if (cause.status === 401 || cause.status === 403) {
      return new EmbeddingError(
        'embedding authentication or permission error',
        'authentication',
        false,
        0,
        0,
        { cause },
      )
    }
    if (typeof cause.status === 'number' && cause.status >= 400) {
      return new EmbeddingError(
        'embedding request rejected',
        'invalid_request',
        false,
        0,
        0,
        { cause },
      )
    }
  }

  return new EmbeddingError(
    'embedding provider error',
    'unknown',
    false,
    0,
    0,
    { cause },
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
    { cause: error },
  )
}

async function sleepWithAbort(
  milliseconds: number,
  signal: AbortSignal,
): Promise<void> {
  signal.throwIfAborted()
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(finish, milliseconds)
    const abort = (): void => {
      clearTimeout(timer)
      signal.removeEventListener('abort', abort)
      try {
        signal.throwIfAborted()
      }
      catch (error) {
        reject(error)
      }
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
