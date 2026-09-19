export const ACTIVE_EMBEDDING_PROFILE = {
  provider: 'google',
  model: 'gemini-embedding-2',
  dimensions: 1536,
  version: 'google:gemini-embedding-2:1536:search-result-v1',
} as const

// 固定值，没有部署差异需求前不做 env（同 #127 对 LLM 层的决定）。
/** 单次 batchEmbedContents 的输入条数（Gemini 单请求上限 375）。 */
export const EMBEDDING_BATCH_INPUTS = 64
/** 单次 HTTP 尝试的超时（毫秒）；SDK 对每次重试各自计时。 */
export const EMBEDDING_ATTEMPT_TIMEOUT_MS = 60_000
/** 交给 SDK 的重试次数（不含首次请求）。 */
export const EMBEDDING_RETRIES = 2

export interface EmbeddingRuntimeConfig {
  apiKey: string
  model: typeof ACTIVE_EMBEDDING_PROFILE.model
  dimensions: typeof ACTIVE_EMBEDDING_PROFILE.dimensions
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
  }
}
