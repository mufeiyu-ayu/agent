const MAX_TIMER_TIMEOUT_MS = 2_147_483_647
// Each chunk is capped at 800 tokens; 375 keeps the configured batch within
// OpenAI's 300,000 aggregate-input-token request ceiling.
const MAX_EMBEDDING_BATCH_SIZE = 375
const MAX_EMBEDDING_RETRIES = 2

export const ACTIVE_EMBEDDING_PROFILE = {
  provider: 'openai',
  model: 'text-embedding-3-small',
  dimensions: 1536,
  version: 'openai:text-embedding-3-small:1536:v1',
} as const

export const DEFAULT_EMBEDDING_RUNTIME_CONFIG = {
  baseUrl: 'https://api.openai.com/v1',
  batchSize: 64,
  requestTimeoutMs: 60_000,
  maxRetries: 2,
} as const

export interface EmbeddingRuntimeConfig {
  apiKey: string
  baseUrl: string
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
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.name = 'EmbeddingError'
  }
}

export class EmbeddingAbortError extends EmbeddingError {
  constructor(
    providerRequests: number,
    retryCount: number,
    options?: ErrorOptions,
  ) {
    super(
      'embedding request aborted',
      'unknown',
      false,
      providerRequests,
      retryCount,
      options,
    )
    this.name = 'AbortError'
  }
}

export function resolveEmbeddingRuntimeConfig(
  env: NodeJS.ProcessEnv,
): EmbeddingRuntimeConfig {
  const apiKey = env.EMBEDDING_API_KEY?.trim()

  if (!apiKey) {
    throw new EmbeddingError(
      '请在项目根目录 .env 中设置 EMBEDDING_API_KEY',
      'configuration',
      false,
    )
  }

  const baseUrl = readOptionalString(
    env,
    'EMBEDDING_BASE_URL',
    DEFAULT_EMBEDDING_RUNTIME_CONFIG.baseUrl,
  )
  let parsedBaseUrl: URL

  try {
    parsedBaseUrl = new URL(baseUrl)
  }
  catch (cause) {
    throw invalidConfig('EMBEDDING_BASE_URL', '必须是有效的 http(s) URL', cause)
  }

  if (!['http:', 'https:'].includes(parsedBaseUrl.protocol)) {
    throw invalidConfig('EMBEDDING_BASE_URL', '必须是有效的 http(s) URL')
  }

  const model = readOptionalString(
    env,
    'EMBEDDING_MODEL',
    ACTIVE_EMBEDDING_PROFILE.model,
  )
  if (model !== ACTIVE_EMBEDDING_PROFILE.model) {
    throw invalidConfig(
      'EMBEDDING_MODEL',
      `本 Task 只接受 ${ACTIVE_EMBEDDING_PROFILE.model}`,
    )
  }

  const dimensions = readInteger(
    env,
    'EMBEDDING_DIMENSIONS',
    ACTIVE_EMBEDDING_PROFILE.dimensions,
    ACTIVE_EMBEDDING_PROFILE.dimensions,
    ACTIVE_EMBEDDING_PROFILE.dimensions,
  )

  return {
    apiKey,
    baseUrl: baseUrl.replace(/\/+$/, ''),
    model,
    dimensions: dimensions as typeof ACTIVE_EMBEDDING_PROFILE.dimensions,
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

function readOptionalString(
  env: NodeJS.ProcessEnv,
  name: string,
  fallback: string,
): string {
  const rawValue = env[name]
  if (rawValue === undefined)
    return fallback
  const value = rawValue.trim()
  if (!value)
    throw invalidConfig(name, '不得为空')
  return value
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
  const value = rawValue.trim()

  if (!/^(?:0|[1-9]\d*)$/.test(value)) {
    throw invalidConfig(name, `必须是 ${minimum}-${maximum} 范围内的十进制整数`)
  }

  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw invalidConfig(name, `必须是 ${minimum}-${maximum} 范围内的十进制整数`)
  }
  return parsed
}

function invalidConfig(
  name: string,
  message: string,
  cause?: unknown,
): EmbeddingError {
  return new EmbeddingError(
    `${name} ${message}`,
    'configuration',
    false,
    0,
    0,
    cause === undefined ? undefined : { cause },
  )
}
