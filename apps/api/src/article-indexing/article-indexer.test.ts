import type {
  EmbeddingProvider,
  EmbeddingResult,
} from '../embeddings/embedding-provider.js'
import type { ArticleChunk } from '../generated/prisma/client.js'
import type { PrismaService } from '../prisma/prisma.service.js'
import type { ArticleSourceSnapshot } from './article-chunking.js'
import type {
  ArticleIndexCommandLock,
  ArticleIndexPool,
  ArticleIndexReplacement,
  ArticleIndexRepositoryContract,
  ArticleIndexStatus,
} from './article-index.repository.js'
import assert from 'node:assert/strict'
// 项目使用 Node 原生测试运行器，不引入额外测试框架。
// eslint-disable-next-line test/no-import-node-test
import { describe, it } from 'node:test'

import {
  ACTIVE_EMBEDDING_PROFILE,
  EmbeddingAbortError,
  EmbeddingError,
} from '../embeddings/embedding-provider.js'
import { canonicalizeArticleSource } from './article-chunking.js'
import {
  ArticleIndexRepository,
} from './article-index.repository.js'
import {
  ArticleIndexer,
  isArticleIndexSummarySuccessful,
} from './article-indexer.js'

describe('ArticleIndexer', () => {
  it('Prisma Unsupported vector 不进入 generated model 读写字段', () => {
    // @ts-expect-error pgvector 字段必须只通过专用 raw SQL Repository 访问。
    const unsupportedField: keyof ArticleChunk = 'embedding'
    assert.equal(unsupportedField, 'embedding')
  })

  it('incremental 首次索引、D-09 无关 markup 更新和二次运行均幂等跳过', async () => {
    const repository = new FakeRepository([source(1, '<p style="color:red">Hello world</p>')])
    const provider = new FakeEmbeddingProvider()
    const indexer = new ArticleIndexer(repository, provider)

    const first = await indexer.run(options('incremental'))
    assert.equal(first.indexed, 1)
    assert.equal(first.skippedUnchanged, 0)
    assert.equal(first.providerRequests, 1)
    assert.equal(repository.replacements.length, 1)
    const firstIds = repository.replacements[0]!.chunks.map(chunk => chunk.id)

    repository.sources[0] = {
      ...repository.sources[0]!,
      content: '<div class="new"><p onclick="ignored()">Hello world</p></div>',
      updatedAt: new Date('2026-08-15T00:00:00.000Z'),
    }
    const second = await indexer.run(options('incremental'))
    assert.equal(second.skippedUnchanged, 1)
    assert.equal(second.indexed, 0)
    assert.equal(provider.calls.length, 1)
    assert.equal(repository.replacements.length, 1)
    assert.equal(
      repository.statuses.get(repository.sources[0]!.id)?.sourceUpdatedAt.toISOString(),
      '2026-08-15T00:00:00.000Z',
    )

    const full = await indexer.run(options('full'))
    assert.equal(full.indexed, 1)
    assert.equal(full.skippedUnchanged, 0)
    assert.equal(provider.calls.length, 2)
    assert.deepEqual(
      repository.replacements[1]!.chunks.map(chunk => chunk.id),
      firstIds,
    )
  })

  it('state/chunk count 冲突强制修复，完整一致才跳过', async () => {
    const article = source(1, '<p>Hello world</p>')
    const repository = new FakeRepository([article])
    const provider = new FakeEmbeddingProvider()
    const indexer = new ArticleIndexer(repository, provider)
    await indexer.run(options('incremental'))

    const current = repository.statuses.get(article.id)!
    repository.statuses.set(article.id, {
      ...current,
      actualChunkCount: current.actualChunkCount + 1,
    })
    const repaired = await indexer.run(options('incremental'))

    assert.equal(repaired.indexed, 1)
    assert.equal(repaired.skippedUnchanged, 0)
    assert.equal(provider.calls.length, 2)
  })

  it('incremental skip 前重验当前 Article，旧批次 snapshot 不会伪报 unchanged', async () => {
    const article = source(1, '<p>Old content</p>')
    const repository = new FakeRepository([article])
    const provider = new FakeEmbeddingProvider()
    const indexer = new ArticleIndexer(repository, provider)
    assert.equal((await indexer.run(options('incremental'))).indexed, 1)

    repository.beforeStatusCheck = () => {
      repository.sources[0] = source(1, '<p>Concurrent content</p>', {
        updatedAt: new Date('2026-08-15T00:00:00.000Z'),
      })
      repository.beforeStatusCheck = undefined
    }
    const result = await indexer.run(options('incremental'))

    assert.equal(result.skippedUnchanged, 0)
    assert.equal(result.stale, 1)
    assert.equal(result.indexed, 0)
    assert.equal(provider.calls.length, 2)
  })

  it('旧批次 snapshot 遇到 canonical no-op 更新会刷新当前 freshness', async () => {
    const article = source(1, '<p style="color:red">Same content</p>')
    const repository = new FakeRepository([article])
    const provider = new FakeEmbeddingProvider()
    const indexer = new ArticleIndexer(repository, provider)
    assert.equal((await indexer.run(options('incremental'))).indexed, 1)

    const updatedAt = new Date('2026-08-15T00:00:00.000Z')
    repository.beforeStatusCheck = () => {
      repository.sources[0] = source(1, '<div><p>Same content</p></div>', {
        updatedAt,
      })
      repository.beforeStatusCheck = undefined
    }
    const result = await indexer.run(options('incremental'))

    assert.equal(result.skippedUnchanged, 1)
    assert.equal(result.indexed, 0)
    assert.equal(provider.calls.length, 1)
    assert.equal(
      repository.statuses.get(article.id)?.sourceUpdatedAt.getTime(),
      updatedAt.getTime(),
    )
  })

  it('empty Article 不调用 provider，原子写 0 state 后可安全跳过', async () => {
    const article = source(1, '<script>ignore()</script><figure><img src="x"></figure>')
    const repository = new FakeRepository([article])
    const provider = new FakeEmbeddingProvider()
    const indexer = new ArticleIndexer(repository, provider)

    const first = await indexer.run(options('incremental'))
    assert.equal(first.skippedEmpty, 1)
    assert.equal(first.indexed, 0)
    assert.equal(first.chunksWritten, 0)
    assert.equal(provider.calls.length, 0)
    assert.equal(repository.replacements[0]!.chunks.length, 0)
    assert.equal(repository.statuses.get(article.id)?.declaredChunkCount, 0)

    const second = await indexer.run(options('incremental'))
    assert.equal(second.skippedUnchanged, 1)
    assert.equal(provider.calls.length, 0)
  })

  it('provider partial response 和 retry exhaustion 都是 fatal，且不提交 replacement', async () => {
    const repository = new FakeRepository([source(1, '<p>Hello world</p>')])
    const partialProvider: EmbeddingProvider = {
      profile: ACTIVE_EMBEDDING_PROFILE,
      embed: async () => ({
        vectors: [],
        providerRequests: 1,
        retryCount: 0,
      }),
    }
    const partial = await new ArticleIndexer(repository, partialProvider)
      .run(options('incremental'))

    assert.equal(partial.failed, 1)
    assert.equal(partial.fatal?.code, 'embedding_protocol')
    assert.equal(partial.providerRequests, 1)
    assert.equal(repository.replacements.length, 0)
    assert.equal(isArticleIndexSummarySuccessful(partial), false)

    const invalidMetricsProvider: EmbeddingProvider = {
      profile: ACTIVE_EMBEDDING_PROFILE,
      embed: async inputs => ({
        vectors: inputs.map(() => vector(0)),
        providerRequests: Number.NaN,
        retryCount: -1,
      }),
    }
    const invalidMetrics = await new ArticleIndexer(
      new FakeRepository([source(3, '<p>Invalid metrics</p>')]),
      invalidMetricsProvider,
    ).run(options('incremental'))
    assert.equal(invalidMetrics.fatal?.code, 'embedding_protocol')
    assert.equal(invalidMetrics.providerRequests, 0)
    assert.equal(invalidMetrics.retryCount, 0)
    assert.doesNotMatch(JSON.stringify(invalidMetrics), /null/)

    const exhaustedProvider: EmbeddingProvider = {
      profile: ACTIVE_EMBEDDING_PROFILE,
      embed: async () => {
        throw new EmbeddingError(
          'provider raw payload with secret must not leak',
          'retry_exhausted',
          false,
          3,
          2,
        )
      },
    }
    const exhausted = await new ArticleIndexer(
      new FakeRepository([source(2, '<p>Second</p>')]),
      exhaustedProvider,
    ).run(options('incremental'))
    assert.equal(exhausted.failed, 1)
    assert.equal(exhausted.fatal?.code, 'embedding_retry_exhausted')
    assert.equal(exhausted.providerRequests, 3)
    assert.equal(exhausted.retryCount, 2)
    assert.doesNotMatch(JSON.stringify(exhausted), /raw payload|secret/)
  })

  it('stale 保留旧 index 并导致非 0 结果语义', async () => {
    const repository = new FakeRepository([source(1, '<p>Hello world</p>')])
    repository.staleNext = true
    const summary = await new ArticleIndexer(
      repository,
      new FakeEmbeddingProvider(),
    ).run(options('incremental'))

    assert.equal(summary.stale, 1)
    assert.equal(summary.indexed, 0)
    assert.equal(summary.errors[0]?.code, 'stale')
    assert.equal(repository.statuses.size, 0)
    assert.equal(isArticleIndexSummarySuccessful(summary), false)
  })

  it('DB replacement failure 为 fatal，旧 state 不变', async () => {
    const article = source(1, '<p>Hello world</p>')
    const repository = new FakeRepository([article])
    const oldStatus: ArticleIndexStatus = {
      sourceHash: 'old',
      sourceUpdatedAt: new Date('2026-08-13T00:00:00.000Z'),
      currentSourceUpdatedAt: new Date('2026-08-13T00:00:00.000Z'),
      chunkerVersion: 'old',
      embeddingVersion: 'old',
      declaredChunkCount: 3,
      actualChunkCount: 3,
    }
    repository.statuses.set(article.id, oldStatus)
    repository.replaceError = new Error('raw database details must not leak')

    const summary = await new ArticleIndexer(
      repository,
      new FakeEmbeddingProvider(),
    ).run(options('incremental'))

    assert.equal(summary.failed, 1)
    assert.equal(summary.fatal?.code, 'database')
    assert.deepEqual(repository.statuses.get(article.id), oldStatus)
    assert.doesNotMatch(JSON.stringify(summary), /raw database details/)
  })

  it('并发命令 lock 在 provider 前 fail fast', async () => {
    const repository = new FakeRepository([source(1, '<p>Hello world</p>')])
    repository.lockAvailable = false
    const provider = new FakeEmbeddingProvider()
    const summary = await new ArticleIndexer(repository, provider)
      .run(options('incremental'))

    assert.equal(summary.fatal?.code, 'lock_unavailable')
    assert.equal(summary.scanned, 0)
    assert.equal(repository.schemaChecks, 0)
    assert.equal(provider.calls.length, 0)
  })

  it('migration / vector extension preflight 缺失时 fail closed 且 provider=0', async () => {
    const repository = new FakeRepository([source(1, '<p>Hello world</p>')])
    repository.schemaError = new Error('vector extension missing')
    const provider = new FakeEmbeddingProvider()
    const summary = await new ArticleIndexer(repository, provider)
      .run(options('incremental'))

    assert.equal(summary.fatal?.code, 'database')
    assert.equal(summary.scanned, 0)
    assert.equal(provider.calls.length, 0)
    assert.doesNotMatch(JSON.stringify(summary), /vector extension missing/)
  })

  it('schema preflight 在 Abort 时终止等待并销毁占用连接', async () => {
    const abortController = new AbortController()
    let startQuery!: () => void
    const queryStarted = new Promise<void>(resolve => void (startQuery = resolve))
    let releaseError: Error | undefined
    const client = {
      query: async () => {
        startQuery()
        return await new Promise<never>(() => {})
      },
      release: (error?: Error) => void (releaseError = error),
    }
    const pool = {
      connect: async () => client,
      query: async () => assert.fail('schema preflight must use an owned client'),
      end: async () => {},
    } as unknown as ArticleIndexPool
    const repository = new ArticleIndexRepository(
      {} as PrismaService,
      pool,
    )
    const pending = repository.assertSchemaReady(abortController.signal)

    await queryStarted
    abortController.abort(new DOMException('stop indexing', 'AbortError'))

    await assert.rejects(pending, { name: 'AbortError' })
    assert.equal(releaseError?.name, 'AbortError')
  })

  it('单篇 chunking error 隔离后继续，sourceId ASC keyset 且 article concurrency=1', async () => {
    const repository = new FakeRepository([
      source(2, '<p>Second article</p>'),
      source(1, '<p>broken body</p>', { title: 'metadata '.repeat(2_000) }),
      source(3, '<p>Third article</p>'),
    ])
    const provider = new FakeEmbeddingProvider(true)
    const summary = await new ArticleIndexer(repository, provider)
      .run(options('incremental'))

    assert.equal(summary.scanned, 3)
    assert.equal(summary.failed, 1)
    assert.equal(summary.indexed, 2)
    assert.deepEqual(
      repository.replacements.map(item => item.source.sourceId),
      [2, 3],
    )
    assert.deepEqual(repository.listCalls, [{ afterSourceId: undefined, take: 25 }, { afterSourceId: 3, take: 25 }])
    assert.equal(provider.maxConcurrent, 1)
  })

  it('Abort 停止新工作且不记录成功 replacement', async () => {
    const repository = new FakeRepository([source(1, '<p>Hello world</p>')])
    const provider: EmbeddingProvider = {
      profile: ACTIVE_EMBEDDING_PROFILE,
      embed: async () => {
        throw new EmbeddingAbortError(1, 0)
      },
    }
    const summary = await new ArticleIndexer(repository, provider).run({
      mode: 'incremental',
      signal: new AbortController().signal,
    })

    assert.equal(summary.aborted, true)
    assert.equal(summary.providerRequests, 1)
    assert.equal(summary.indexed, 0)
    assert.equal(repository.replacements.length, 0)
    assert.equal(isArticleIndexSummarySuccessful(summary), false)
  })

  it('状态读取期间 Abort 记为 aborted，不伪报 database failure', async () => {
    const repository = new FakeRepository([source(1, '<p>Hello world</p>')])
    repository.statusError = Object.assign(new Error('aborted'), {
      name: 'AbortError',
    })

    const summary = await new ArticleIndexer(
      repository,
      new FakeEmbeddingProvider(),
    ).run(options('incremental'))

    assert.equal(summary.aborted, true)
    assert.equal(summary.failed, 0)
    assert.equal(summary.fatal, null)
    assert.deepEqual(summary.errors, [])
  })
})

class FakeRepository implements ArticleIndexRepositoryContract {
  readonly statuses = new Map<string, ArticleIndexStatus>()
  readonly replacements: ArticleIndexReplacement[] = []
  readonly listCalls: Array<{ afterSourceId: number | undefined, take: number }> = []
  lockAvailable = true
  schemaChecks = 0
  staleNext = false
  replaceError: Error | undefined
  schemaError: Error | undefined
  statusError: Error | undefined
  beforeStatusCheck: (() => void) | undefined

  constructor(readonly sources: ArticleSourceSnapshot[]) {
    sources.sort((left, right) => left.sourceId - right.sourceId)
  }

  async acquireCommandLock(): Promise<ArticleIndexCommandLock | null> {
    return this.lockAvailable ? { release: async () => {} } : null
  }

  async assertSchemaReady(): Promise<void> {
    this.schemaChecks += 1
    if (this.schemaError)
      throw this.schemaError
  }

  async findArticleBySourceId(sourceId: number): Promise<ArticleSourceSnapshot | null> {
    return this.sources.find(item => item.sourceId === sourceId) ?? null
  }

  async listArticlesAfter(
    afterSourceId: number | undefined,
    take: number,
  ): Promise<ArticleSourceSnapshot[]> {
    this.listCalls.push({ afterSourceId, take })
    return this.sources
      .filter(item => afterSourceId === undefined || item.sourceId > afterSourceId)
      .slice(0, take)
  }

  async getIndexStatus(
    source: ReturnType<typeof canonicalizeArticleSource>,
  ): Promise<ArticleIndexStatus | null> {
    if (this.statusError)
      throw this.statusError
    this.beforeStatusCheck?.()
    const current = this.sources.find(item => item.id === source.articleId)
    if (
      !current
      || canonicalizeArticleSource(current).sourceHash !== source.sourceHash
    ) {
      return null
    }
    const status = this.statuses.get(source.articleId)
    return status
      ? {
          ...status,
          currentSourceUpdatedAt: current.updatedAt,
        }
      : null
  }

  async refreshIndexSourceUpdatedAt(
    source: ReturnType<typeof canonicalizeArticleSource>,
  ): Promise<boolean> {
    const current = this.sources.find(item => item.id === source.articleId)
    const status = this.statuses.get(source.articleId)
    if (
      !current
      || !status
      || canonicalizeArticleSource(current).sourceHash !== source.sourceHash
      || status.sourceHash !== source.sourceHash
      || status.chunkerVersion !== 'article-html-cl100k-v1'
      || status.embeddingVersion !== ACTIVE_EMBEDDING_PROFILE.version
      || status.declaredChunkCount !== status.actualChunkCount
    ) {
      return false
    }

    status.sourceUpdatedAt = current.updatedAt
    return true
  }

  async replaceArticleIndex(
    input: ArticleIndexReplacement,
  ): Promise<'committed' | 'stale'> {
    input.signal.throwIfAborted()
    if (this.staleNext) {
      this.staleNext = false
      return 'stale'
    }
    if (this.replaceError)
      throw this.replaceError

    const current = this.sources.find(item => item.id === input.source.articleId)
    if (
      !current
      || canonicalizeArticleSource(current).sourceHash !== input.source.sourceHash
    ) {
      return 'stale'
    }

    this.replacements.push(input)
    this.statuses.set(input.source.articleId, {
      sourceHash: input.source.sourceHash,
      sourceUpdatedAt: input.source.sourceUpdatedAt,
      currentSourceUpdatedAt: input.source.sourceUpdatedAt,
      chunkerVersion: input.chunks[0]?.chunkerVersion ?? 'article-html-cl100k-v1',
      embeddingVersion: input.embeddingProfile.version,
      declaredChunkCount: input.chunks.length,
      actualChunkCount: input.chunks.length,
    })
    return 'committed'
  }
}

class FakeEmbeddingProvider implements EmbeddingProvider {
  readonly profile = ACTIVE_EMBEDDING_PROFILE
  readonly calls: string[][] = []
  active = 0
  maxConcurrent = 0

  constructor(private readonly yieldOnce = false) {}

  async embed(inputs: readonly string[]): Promise<EmbeddingResult> {
    this.active += 1
    this.maxConcurrent = Math.max(this.maxConcurrent, this.active)
    this.calls.push([...inputs])
    if (this.yieldOnce)
      await new Promise<void>(resolve => setImmediate(resolve))
    this.active -= 1
    return {
      vectors: inputs.map((_, index) => vector(index + 1)),
      providerRequests: 1,
      retryCount: 0,
    }
  }
}

function vector(value: number): number[] {
  return Array.from(
    new Float64Array(ACTIVE_EMBEDDING_PROFILE.dimensions).fill(value),
  )
}

function source(
  sourceId: number,
  content: string,
  overrides: Partial<ArticleSourceSnapshot> = {},
): ArticleSourceSnapshot {
  return {
    id: `article-${sourceId}`,
    sourceId,
    title: `Article ${sourceId}`,
    languageCode: 'en',
    content,
    updatedAt: new Date('2026-08-14T00:00:00.000Z'),
    ...overrides,
  }
}

function options(mode: 'incremental' | 'full') {
  return {
    mode,
    signal: new AbortController().signal,
  } as const
}
