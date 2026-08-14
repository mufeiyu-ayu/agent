import type { EmbeddingProvider } from './embedding-provider.js'
import { performance } from 'node:perf_hooks'
import process from 'node:process'
import { pathToFileURL } from 'node:url'
import { formatEmbeddingQueryInput } from './embedding-formatter.js'
import {
  ACTIVE_EMBEDDING_PROFILE,
  EmbeddingError,
  resolveEmbeddingRuntimeConfig,
} from './embedding-provider.js'
import { GeminiEmbeddingProvider } from './gemini-embedding.provider.js'

const SMOKE_INPUT = formatEmbeddingQueryInput('embedding provider smoke check')

export interface EmbeddingSmokeSummary {
  provider: typeof ACTIVE_EMBEDDING_PROFILE.provider
  model: typeof ACTIVE_EMBEDDING_PROFILE.model
  vectorCount: 1
  dimensions: typeof ACTIVE_EMBEDDING_PROFILE.dimensions
  norm: number
  providerRequests: number
  retryCount: number
  elapsedMs: number
}

type ProviderFactory = () => EmbeddingProvider

export async function executeEmbeddingSmoke(
  signal: AbortSignal,
  createProvider: ProviderFactory = createProductionProvider,
): Promise<EmbeddingSmokeSummary> {
  signal.throwIfAborted()
  const provider = createProvider()
  const startedAt = performance.now()
  const result = await provider.embed([SMOKE_INPUT], { signal })
  const elapsedMs = Math.max(0, Math.round(performance.now() - startedAt))
  const vector = result.vectors[0]
  const norm = vector ? Math.hypot(...vector) : Number.NaN

  if (
    result.vectors.length !== 1
    || !vector
    || vector.length !== ACTIVE_EMBEDDING_PROFILE.dimensions
    || vector.some(value => !Number.isFinite(value))
    || !vector.some(value => value !== 0)
    || !Number.isFinite(norm)
    || norm <= 0
    || !Number.isSafeInteger(result.providerRequests)
    || result.providerRequests < 1
    || !Number.isSafeInteger(result.retryCount)
    || result.retryCount < 0
    || result.retryCount >= result.providerRequests
  ) {
    throw new EmbeddingError(
      'embedding smoke 返回非法结果',
      'protocol',
      false,
    )
  }

  return {
    provider: ACTIVE_EMBEDDING_PROFILE.provider,
    model: ACTIVE_EMBEDDING_PROFILE.model,
    vectorCount: 1,
    dimensions: ACTIVE_EMBEDDING_PROFILE.dimensions,
    norm,
    providerRequests: result.providerRequests,
    retryCount: result.retryCount,
    elapsedMs,
  }
}

export function serializeEmbeddingSmokeSummary(
  summary: EmbeddingSmokeSummary,
): string {
  return JSON.stringify(summary, null, 2)
}

function createProductionProvider(): EmbeddingProvider {
  return new GeminiEmbeddingProvider(resolveEmbeddingRuntimeConfig(process.env))
}

export function safeSmokeFailure(error: unknown): { error: string, message: string } {
  if (error instanceof Error && error.name === 'AbortError') {
    return {
      error: 'embedding_aborted',
      message: 'Gemini embedding smoke 已终止',
    }
  }
  if (error instanceof EmbeddingError) {
    return {
      error: `embedding_${error.code}`,
      message: 'Gemini embedding smoke 失败',
    }
  }
  return {
    error: 'embedding_unknown',
    message: 'Gemini embedding smoke 失败',
  }
}

async function main(): Promise<void> {
  const abortController = new AbortController()
  const abort = (): void => abortController.abort(
    new DOMException('embedding smoke aborted', 'AbortError'),
  )
  process.once('SIGINT', abort)
  process.once('SIGTERM', abort)

  try {
    const summary = await executeEmbeddingSmoke(abortController.signal)
    process.stdout.write(`${serializeEmbeddingSmokeSummary(summary)}\n`)
  }
  catch (error) {
    process.stderr.write(`${JSON.stringify(safeSmokeFailure(error))}\n`)
    process.exitCode = 1
  }
  finally {
    process.removeListener('SIGINT', abort)
    process.removeListener('SIGTERM', abort)
  }
}

const entrypoint = process.argv[1]
if (entrypoint && import.meta.url === pathToFileURL(entrypoint).href)
  void main()
