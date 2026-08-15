import type {
  EmbeddingProvider,
  EmbeddingResult,
} from '../embeddings/embedding-provider.js'
import type { ArticleSourceSnapshot } from './article-chunking.js'
import type {
  ArticleIndexRepositoryContract,
  ArticleIndexStatus,
} from './article-index.repository.js'
import {
  ACTIVE_EMBEDDING_PROFILE,
  EmbeddingError,
} from '../embeddings/embedding-provider.js'
import {
  ARTICLE_CHUNKER_PROFILE,
  canonicalizeArticleSource,
  chunkCanonicalArticle,
} from './article-chunking.js'

const ARTICLE_READ_BATCH_SIZE = 25

export type ArticleIndexMode = 'incremental' | 'full'

export interface ArticleIndexOptions {
  mode: ArticleIndexMode
  sourceId?: number
  signal: AbortSignal
}

export interface ArticleIndexSafeError {
  sourceId: number
  code: string
  message: string
}

export interface ArticleIndexFatalError {
  code: string
  message: string
}

export interface ArticleIndexSummary {
  profile: {
    chunkerVersion: typeof ARTICLE_CHUNKER_PROFILE.version
    targetTokens: typeof ARTICLE_CHUNKER_PROFILE.targetTokens
    hardMaxTokens: typeof ARTICLE_CHUNKER_PROFILE.hardMaxTokens
    overlapTokens: typeof ARTICLE_CHUNKER_PROFILE.overlapTokens
    embeddingProvider: typeof ACTIVE_EMBEDDING_PROFILE.provider
    embeddingModel: typeof ACTIVE_EMBEDDING_PROFILE.model
    embeddingDimensions: typeof ACTIVE_EMBEDDING_PROFILE.dimensions
    embeddingVersion: typeof ACTIVE_EMBEDDING_PROFILE.version
  }
  mode: ArticleIndexMode
  sourceId?: number
  scanned: number
  indexed: number
  skippedUnchanged: number
  skippedEmpty: number
  stale: number
  failed: number
  chunksWritten: number
  providerRequests: number
  retryCount: number
  aborted: boolean
  fatal: ArticleIndexFatalError | null
  errors: ArticleIndexSafeError[]
}

export class ArticleIndexer {
  constructor(
    private readonly repository: ArticleIndexRepositoryContract,
    private readonly embeddingProvider: EmbeddingProvider,
  ) {}

  async run(options: ArticleIndexOptions): Promise<ArticleIndexSummary> {
    const summary = createArticleIndexSummary(options)
    let commandLock: Awaited<ReturnType<
      ArticleIndexRepositoryContract['acquireCommandLock']
    >> = null

    try {
      options.signal.throwIfAborted()
      commandLock = await this.repository.acquireCommandLock(options.signal)
      if (!commandLock) {
        summary.fatal = {
          code: 'lock_unavailable',
          message: '另一个 Article indexing command 正在运行',
        }
        return summary
      }

      await this.repository.assertSchemaReady(options.signal)

      if (options.sourceId !== undefined) {
        const source = await this.repository.findArticleBySourceId(
          options.sourceId,
          options.signal,
        )
        if (!source) {
          summary.failed += 1
          summary.errors.push({
            sourceId: options.sourceId,
            code: 'article_not_found',
            message: 'Article sourceId 不存在',
          })
          return summary
        }

        await this.indexOne(source, options, summary)
        return summary
      }

      let afterSourceId: number | undefined
      while (!summary.fatal && !summary.aborted) {
        options.signal.throwIfAborted()
        const sources = await this.repository.listArticlesAfter(
          afterSourceId,
          ARTICLE_READ_BATCH_SIZE,
          options.signal,
        )
        if (sources.length === 0)
          break

        for (const source of sources) {
          options.signal.throwIfAborted()
          await this.indexOne(source, options, summary)
          if (summary.fatal || summary.aborted)
            break
        }

        afterSourceId = sources.at(-1)!.sourceId
      }
    }
    catch (error) {
      if (isAbortError(error) || options.signal.aborted) {
        summary.aborted = true
      }
      else if (!summary.fatal) {
        summary.fatal = safeFatalError(error)
      }
    }
    finally {
      if (commandLock) {
        try {
          await commandLock.release()
        }
        catch {
          summary.fatal ??= {
            code: 'database',
            message: '释放 Article indexing command lock 失败',
          }
        }
      }
    }

    return summary
  }

  private async indexOne(
    snapshot: ArticleSourceSnapshot,
    options: ArticleIndexOptions,
    summary: ArticleIndexSummary,
  ): Promise<void> {
    summary.scanned += 1
    let source: ReturnType<typeof canonicalizeArticleSource>
    let chunks: ReturnType<typeof chunkCanonicalArticle>

    try {
      source = canonicalizeArticleSource(snapshot)
    }
    catch {
      summary.failed += 1
      summary.errors.push({
        sourceId: snapshot.sourceId,
        code: 'chunking',
        message: 'Article canonicalization 或 chunking 失败',
      })
      return
    }

    if (options.mode === 'incremental') {
      let status: ArticleIndexStatus | null
      try {
        status = await this.repository.getIndexStatus(
          source,
          options.signal,
        )
      }
      catch (error) {
        if (isAbortError(error) || options.signal.aborted)
          throw error
        summary.failed += 1
        const databaseError = {
          code: 'database',
          message: '读取 Article index state 失败',
        }
        summary.errors.push({ sourceId: snapshot.sourceId, ...databaseError })
        summary.fatal = databaseError
        return
      }
      if (isUnchanged(status, source.sourceHash)) {
        const freshnessCurrent = status.sourceUpdatedAt.getTime()
          === status.currentSourceUpdatedAt.getTime()
        if (
          freshnessCurrent
          || await this.repository.refreshIndexSourceUpdatedAt(
            source,
            options.signal,
          )
        ) {
          summary.skippedUnchanged += 1
          return
        }
      }
    }

    try {
      chunks = chunkCanonicalArticle(source, ACTIVE_EMBEDDING_PROFILE.version)
    }
    catch {
      summary.failed += 1
      summary.errors.push({
        sourceId: snapshot.sourceId,
        code: 'chunking',
        message: 'Article canonicalization 或 chunking 失败',
      })
      return
    }

    let embeddingResult: EmbeddingResult
    if (chunks.length === 0) {
      embeddingResult = {
        vectors: [],
        providerRequests: 0,
        retryCount: 0,
      }
    }
    else {
      try {
        embeddingResult = await this.embeddingProvider.embed(
          chunks.map(chunk => chunk.embeddingInput),
          { signal: options.signal },
        )
        validateEmbeddingResult(embeddingResult, chunks.length)
        summary.providerRequests += embeddingResult.providerRequests
        summary.retryCount += embeddingResult.retryCount
      }
      catch (error) {
        if (error instanceof EmbeddingError) {
          summary.providerRequests += safeMetric(error.providerRequests)
          summary.retryCount += safeMetric(error.retryCount)
        }
        if (isAbortError(error) || options.signal.aborted) {
          summary.aborted = true
          return
        }

        summary.failed += 1
        const providerError = safeProviderError(error)
        summary.errors.push({
          sourceId: snapshot.sourceId,
          ...providerError,
        })
        summary.fatal = providerError
        return
      }
    }

    options.signal.throwIfAborted()
    try {
      const result = await this.repository.replaceArticleIndex({
        source,
        chunks,
        vectors: embeddingResult.vectors,
        embeddingProfile: ACTIVE_EMBEDDING_PROFILE,
        signal: options.signal,
      })

      if (result === 'stale') {
        summary.stale += 1
        summary.errors.push({
          sourceId: snapshot.sourceId,
          code: 'stale',
          message: 'Article 在 embedding 后发生变化，未提交过期结果',
        })
        return
      }

      if (chunks.length === 0)
        summary.skippedEmpty += 1
      else
        summary.indexed += 1
      summary.chunksWritten += chunks.length
    }
    catch (error) {
      if (isAbortError(error) || options.signal.aborted) {
        summary.aborted = true
        return
      }
      summary.failed += 1
      const databaseError = {
        code: 'database',
        message: 'Article active index 原子替换失败',
      }
      summary.errors.push({
        sourceId: snapshot.sourceId,
        ...databaseError,
      })
      summary.fatal = databaseError
    }
  }
}

export function createArticleIndexSummary(
  options: Pick<ArticleIndexOptions, 'mode' | 'sourceId'>,
): ArticleIndexSummary {
  return {
    profile: {
      chunkerVersion: ARTICLE_CHUNKER_PROFILE.version,
      targetTokens: ARTICLE_CHUNKER_PROFILE.targetTokens,
      hardMaxTokens: ARTICLE_CHUNKER_PROFILE.hardMaxTokens,
      overlapTokens: ARTICLE_CHUNKER_PROFILE.overlapTokens,
      embeddingProvider: ACTIVE_EMBEDDING_PROFILE.provider,
      embeddingModel: ACTIVE_EMBEDDING_PROFILE.model,
      embeddingDimensions: ACTIVE_EMBEDDING_PROFILE.dimensions,
      embeddingVersion: ACTIVE_EMBEDDING_PROFILE.version,
    },
    mode: options.mode,
    ...(options.sourceId === undefined ? {} : { sourceId: options.sourceId }),
    scanned: 0,
    indexed: 0,
    skippedUnchanged: 0,
    skippedEmpty: 0,
    stale: 0,
    failed: 0,
    chunksWritten: 0,
    providerRequests: 0,
    retryCount: 0,
    aborted: false,
    fatal: null,
    errors: [],
  }
}

export function isArticleIndexSummarySuccessful(
  summary: ArticleIndexSummary,
): boolean {
  return !summary.aborted
    && summary.fatal === null
    && summary.failed === 0
    && summary.stale === 0
}

function isUnchanged(
  status: ArticleIndexStatus | null,
  sourceHash: string,
): status is ArticleIndexStatus {
  return status !== null
    && status.sourceHash === sourceHash
    && status.chunkerVersion === ARTICLE_CHUNKER_PROFILE.version
    && status.embeddingVersion === ACTIVE_EMBEDDING_PROFILE.version
    && status.declaredChunkCount === status.actualChunkCount
}

function validateEmbeddingResult(
  result: EmbeddingResult,
  expectedCount: number,
): void {
  const metricsValid = Number.isSafeInteger(result.providerRequests)
    && result.providerRequests > 0
    && Number.isSafeInteger(result.retryCount)
    && result.retryCount >= 0
    && result.retryCount < result.providerRequests
  if (
    result.vectors.length !== expectedCount
    || !metricsValid
    || result.vectors.some(vector => (
      vector.length !== ACTIVE_EMBEDDING_PROFILE.dimensions
      || vector.some(value => !Number.isFinite(value))
      || !vector.some(value => value !== 0)
    ))
  ) {
    throw new EmbeddingError(
      'EmbeddingProvider 返回非法或部分结果',
      'protocol',
      false,
      metricsValid ? result.providerRequests : 0,
      metricsValid ? result.retryCount : 0,
    )
  }
}

function safeMetric(value: number): number {
  return Number.isSafeInteger(value) && value >= 0 ? value : 0
}

function safeProviderError(error: unknown): ArticleIndexFatalError {
  if (error instanceof EmbeddingError) {
    return {
      code: `embedding_${error.code}`,
      message: safeEmbeddingErrorMessage(error.code),
    }
  }
  return {
    code: 'embedding_provider',
    message: 'Embedding provider 执行失败',
  }
}

function safeFatalError(error: unknown): ArticleIndexFatalError {
  if (error instanceof EmbeddingError) {
    return {
      code: `embedding_${error.code}`,
      message: safeEmbeddingErrorMessage(error.code),
    }
  }
  return {
    code: 'database',
    message: 'Article indexing 数据库准备或读取失败',
  }
}

function safeEmbeddingErrorMessage(code: EmbeddingError['code']): string {
  const messages: Record<EmbeddingError['code'], string> = {
    authentication: 'Embedding provider 认证或权限失败',
    configuration: 'Embedding 配置无效',
    invalid_request: 'Embedding 请求被拒绝',
    network: 'Embedding provider 网络失败',
    protocol: 'Embedding provider 响应协议非法',
    rate_limit: 'Embedding provider 限流',
    retry_exhausted: 'Embedding provider 重试已耗尽',
    server: 'Embedding provider 服务失败',
    timeout: 'Embedding provider 请求超时',
    unknown: 'Embedding provider 执行失败',
  }
  return messages[code]
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}
