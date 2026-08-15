const MAX_TIMER_TIMEOUT_MS = 2_147_483_647
const MAX_EMBEDDING_BATCH_SIZE = 375
const MAX_EMBEDDING_RETRIES = 2

export const ACTIVE_EMBEDDING_PROFILE = {
  provider: 'google',
  model: 'gemini-embedding-2',
  dimensions: 1536,
  version: 'google:gemini-embedding-2:1536:search-result-v1',
} as const

export const DEFAULT_EMBEDDING_RUNTIME_CONFIG = {
  batchSize: 64,
  requestTimeoutMs: 60_000,
  maxRetries: 2,
} as const

export interface EmbeddingRuntimeConfig {
  apiKey: string
  model: typeof ACTIVE_EMBEDDING_PROFILE.model
  dimensions: typeof ACTIVE_EMBEDDING_PROFILE.dimensions
  batchSize: number
  requestTimeoutMs: number
  maxRetries: number
}

export interface EmbeddingRequestOptions {
  signal: AbortSignal
}

export interface EmbeddingResult {
  vectors: number[][]
  providerRequests: number
  retryCount: number
}

export interface EmbeddingProvider {
  readonly profile: typeof ACTIVE_EMBEDDING_PROFILE
  embed: (
    inputs: readonly string[],
    options: EmbeddingRequestOptions,
  ) => Promise<EmbeddingResult>
}

export type EmbeddingErrorCode
  = | 'authentication'
    | 'configuration'
    | 'invalid_request'
    | 'network'
    | 'protocol'
    | 'rate_limit'
    | 'retry_exhausted'
    | 'server'
    | 'timeout'
    | 'unknown'

export class EmbeddingError extends Error {
  constructor(
    message: string,
    readonly code: EmbeddingErrorCode,
    readonly retryable: boolean,
    readonly providerRequests = 0,
    readonly retryCount = 0,
    readonly retryAfterMs = 0,
  ) {
    super(message)
    this.name = 'EmbeddingError'
  }
}

export class EmbeddingAbortError extends EmbeddingError {
  constructor(
    providerRequests: number,
    retryCount: number,
  ) {
    super(
      'embedding request aborted',
      'unknown',
      false,
      providerRequests,
      retryCount,
    )
    this.name = 'AbortError'
  }
}

export function resolveEmbeddingRuntimeConfig(
  env: NodeJS.ProcessEnv,
): EmbeddingRuntimeConfig {
  const apiKey = env.GEMINI_API_KEY?.trim()

  if (!apiKey) {
    throw new EmbeddingError(
      '请在项目根目录 .env 中设置 GEMINI_API_KEY',
      'configuration',
      false,
    )
  }

  return {
    apiKey,
    model: ACTIVE_EMBEDDING_PROFILE.model,
    dimensions: ACTIVE_EMBEDDING_PROFILE.dimensions,
    batchSize: readInteger(
      env,
      'EMBEDDING_BATCH_SIZE',
      DEFAULT_EMBEDDING_RUNTIME_CONFIG.batchSize,
      1,
      MAX_EMBEDDING_BATCH_SIZE,
    ),
    requestTimeoutMs: readInteger(
      env,
      'EMBEDDING_REQUEST_TIMEOUT_MS',
      DEFAULT_EMBEDDING_RUNTIME_CONFIG.requestTimeoutMs,
      1,
      MAX_TIMER_TIMEOUT_MS,
    ),
    maxRetries: readInteger(
      env,
      'EMBEDDING_MAX_RETRIES',
      DEFAULT_EMBEDDING_RUNTIME_CONFIG.maxRetries,
      0,
      MAX_EMBEDDING_RETRIES,
    ),
  }
}

function readInteger(
  env: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const rawValue = env[name]
  if (rawValue === undefined)
    return fallback
  if (!/^\d+$/.test(rawValue))
    throw invalidConfig(name, `必须是 ${minimum}-${maximum} 的十进制整数`)

  const value = Number(rawValue)
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum)
    throw invalidConfig(name, `必须是 ${minimum}-${maximum} 的十进制整数`)
  return value
}

function invalidConfig(name: string, reason: string): EmbeddingError {
  return new EmbeddingError(
    `Embedding 配置 ${name} 非法：${reason}`,
    'configuration',
    false,
  )
}
