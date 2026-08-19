import type {
  ArticleRetrievalPool,
  ArticleRetrievalPoolClient,
} from './postgres-article-retrieval.repository.js'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import process from 'node:process'
// 项目使用 Node 原生测试运行器，不引入额外测试框架。
// eslint-disable-next-line test/no-import-node-test
import { after, before, describe, it } from 'node:test'

import { ARTICLE_CHUNKER_PROFILE } from '../article-indexing/article-chunking.js'
import { ACTIVE_EMBEDDING_PROFILE } from '../embeddings/embedding-provider.js'
import { DatabaseOperationDeadlineExceededError } from '../prisma/prisma.service.js'
import {
  createArticleRetrievalPool,
  PostgresArticleRetrievalRepository,
} from './postgres-article-retrieval.repository.js'

const testDatabaseUrl = process.env.ARTICLE_INDEX_TEST_DATABASE_URL?.trim()
const integrationDescribe = testDatabaseUrl ? describe : describe.skip
const require = createRequire(import.meta.url)
const { Pool: PgPool } = require('pg') as {
  Pool: new (options: {
    connectionString: string
    max: number
    connectionTimeoutMillis: number
  }) => TestPool
}

interface QueryResult<Row> {
  rows: Row[]
}

interface TestClient {
  readonly processID?: number
  query: <Row = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ) => Promise<QueryResult<Row>>
  release: (error?: Error) => void
}

interface TestPool {
  connect: () => Promise<TestClient>
  query: <Row = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ) => Promise<QueryResult<Row>>
  end: () => Promise<void>
}

integrationDescribe('Article retrieval PostgreSQL / pgvector integration', {
  concurrency: 1,
}, () => {
  const schema = `article_retrieval_test_${randomUUID().replaceAll('-', '')}`
  let adminPool: TestPool
  let retrievalPool: ArticleRetrievalPool
  let trackingPool: TrackingPool
  let repository: PostgresArticleRetrievalRepository

  before(async () => {
    assert.ok(testDatabaseUrl)
    assert.match(schema, /^article_retrieval_test_[a-f\d]+$/)
    adminPool = new PgPool({
      connectionString: testDatabaseUrl,
      max: 4,
      connectionTimeoutMillis: 2_000,
    })
    const migrationClient = await adminPool.connect()

    try {
      // identifier 来自上面的 UUID 且经过 regex 复核；PostgreSQL 不支持参数化 identifier。
      await migrationClient.query(`CREATE SCHEMA "${schema}"`)
      await migrationClient.query(
        'SELECT set_config(\'search_path\', $1, false)',
        [`${schema},public`],
      )
      for (const path of [
        '../../../../prisma/migrations/20260711115000_add_article_demo_data/migration.sql',
        '../../../../prisma/migrations/20260711122500_add_article_language_code/migration.sql',
        '../../../../prisma/migrations/20260814090000_add_article_embedding_index/migration.sql',
      ]) {
        await migrationClient.query(await readFile(new URL(path, import.meta.url), 'utf8'))
      }
    }
    finally {
      migrationClient.release()
    }

    retrievalPool = createArticleRetrievalPool(withSearchPath(testDatabaseUrl, schema))
    trackingPool = new TrackingPool(retrievalPool)
    repository = new PostgresArticleRetrievalRepository(trackingPool)
    await seedLexicalFixtures()
    await seedVectorFixtures()
  })

  after(async () => {
    await retrievalPool?.end()
    if (adminPool) {
      assert.match(schema, /^article_retrieval_test_[a-f\d]+$/)
      await adminPool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
      await adminPool.end()
    }
  })

  it('独立 lexical strategy 按最小 relevance priority、literal special chars 和 sourceId 排序', async () => {
    const context = createContext()
    const result = await repository.findLexicalCandidates({
      query: 'alpha%_\\',
      languageCode: 'lex',
      limit: 10,
    }, context)

    assert.deepEqual(result.map(candidate => candidate.sourceId), [
      10,
      11,
      12,
      13,
      14,
      15,
    ])
    assert.deepEqual(
      await repository.findLexicalCandidates(
        { query: 'does-not-exist', languageCode: 'lex', limit: 10 },
        createContext(),
      ),
      [],
    )
  })

  it('exact cosine 只返回 active/compatible/non-stale/count-complete index，并稳定支持 language filter', async () => {
    const result = await repository.findVectorChunkCandidates(
      basisVector(0),
      { query: 'semantic', languageCode: 'en', limit: 10 },
      createContext(),
    )

    assert.deepEqual(result.map(candidate => candidate.sourceId), [
      101,
      102,
      101,
      110,
      111,
    ])
    assert.equal(result[0]?.chunkId, 'article-101-chunk-0')
    assert.equal(result[0]?.cosineDistance, 0)
    assert.ok((result[1]?.cosineDistance ?? 1) > 0)
    assert.deepEqual(
      (await repository.findVectorChunkCandidates(
        basisVector(0),
        { query: '中文语义', languageCode: 'zh-cn', limit: 10 },
        createContext(),
      )).map(candidate => candidate.sourceId),
      [103],
    )
  })

  it('exact candidate query 固定最多 40 chunks，distance tie 按 sourceId 稳定', async () => {
    for (let index = 0; index < 45; index += 1) {
      await seedArticle({
        sourceId: 1_000 + index,
        languageCode: 'limit',
        chunks: [{ vector: basisVector(0) }],
      })
    }

    const result = await repository.findVectorChunkCandidates(
      basisVector(0),
      { query: 'limit', languageCode: 'limit', limit: 10 },
      createContext(),
    )

    assert.equal(result.length, 40)
    assert.deepEqual(
      result.map(candidate => candidate.sourceId),
      Array.from({ length: 40 }, (_, index) => 1_000 + index),
    )
  })

  it('Abort 真实终止 blocked SQL、error-release owned connection 且 pool 后续可复用', async () => {
    const blocker = await adminPool.connect()
    const abortController = new AbortController()
    let pending: Promise<unknown> | undefined

    try {
      await blocker.query('BEGIN')
      await blocker.query(`LOCK TABLE "${schema}"."ArticleChunk" IN ACCESS EXCLUSIVE MODE`)
      const connectionCount = trackingPool.connectedProcessIds.length
      const releaseCount = trackingPool.releaseErrors.length
      pending = repository.findVectorChunkCandidates(
        basisVector(0),
        { query: 'abort', languageCode: 'en', limit: 5 },
        createContext(abortController.signal),
      )
      void pending.catch(() => {})
      await waitFor(() => trackingPool.connectedProcessIds.length > connectionCount)
      const processId = trackingPool.connectedProcessIds.at(-1)
      assert.ok(processId)
      await waitForBlockedQuery(processId)

      abortController.abort()
      await assert.rejects(pending, { name: 'AbortError' })
      assert.equal(trackingPool.releaseErrors.length, releaseCount + 1)
      assert.equal(trackingPool.releaseErrors.at(-1)?.name, 'AbortError')
      await waitForBackendExit(processId)
    }
    finally {
      abortController.abort()
      await blocker.query('ROLLBACK').catch(() => {})
      blocker.release()
      await pending?.catch(() => {})
    }

    const reusable = await repository.findVectorChunkCandidates(
      basisVector(0),
      { query: 'reusable', languageCode: 'en', limit: 5 },
      createContext(),
    )
    assert.ok(reusable.length > 0)
  })

  it('database deadline 真实终止 blocked SQL、返回统一 timeout 且 pool 后续可复用', async () => {
    const blocker = await adminPool.connect()
    let pending: Promise<unknown> | undefined

    try {
      await blocker.query('BEGIN')
      await blocker.query(`LOCK TABLE "${schema}"."ArticleChunk" IN ACCESS EXCLUSIVE MODE`)
      const connectionCount = trackingPool.connectedProcessIds.length
      pending = repository.findVectorChunkCandidates(
        basisVector(0),
        { query: 'deadline', languageCode: 'en', limit: 5 },
        createContext(new AbortController().signal, 750),
      )
      void pending.catch(() => {})
      await waitFor(() => trackingPool.connectedProcessIds.length > connectionCount)
      const processId = trackingPool.connectedProcessIds.at(-1)
      assert.ok(processId)
      await waitForBlockedQuery(processId)

      await assert.rejects(pending, {
        name: 'DatabaseOperationDeadlineExceededError',
      })
      await waitForBackendExit(processId)
    }
    finally {
      await blocker.query('ROLLBACK').catch(() => {})
      blocker.release()
      await pending?.catch(() => {})
    }

    const reusable = await repository.findVectorChunkCandidates(
      basisVector(0),
      { query: 'reusable', languageCode: 'en', limit: 5 },
      createContext(),
    )
    assert.ok(reusable.length > 0)
  })

  async function seedLexicalFixtures(): Promise<void> {
    const literal = 'alpha%_\\'
    await seedArticle({ sourceId: 10, languageCode: 'lex', title: literal.toUpperCase() })
    await seedArticle({ sourceId: 11, languageCode: 'lex', title: `prefix ${literal} suffix` })
    await seedArticle({ sourceId: 12, languageCode: 'lex', slug: `slug-${literal}-match` })
    await seedArticle({ sourceId: 13, languageCode: 'lex', seoTitle: `seo ${literal}` })
    await seedArticle({ sourceId: 14, languageCode: 'lex', seoDescription: `description ${literal}` })
    await seedArticle({ sourceId: 15, languageCode: 'lex', content: `<p>content ${literal}</p>` })
    await seedArticle({ sourceId: 16, languageCode: 'lex', content: '<p>alphaXYZ</p>' })
  }

  async function seedVectorFixtures(): Promise<void> {
    await seedArticle({
      sourceId: 101,
      chunks: [
        { vector: basisVector(0) },
        { vector: basisVector(1) },
      ],
    })
    await seedArticle({
      sourceId: 102,
      chunks: [{ vector: twoAxisVector() }],
    })
    await seedArticle({
      sourceId: 103,
      languageCode: 'zh-cn',
      chunks: [{ vector: basisVector(0) }],
    })
    const staleUpdatedAt = new Date('2026-08-14T00:00:01.000Z')
    await seedArticle({
      sourceId: 104,
      updatedAt: staleUpdatedAt,
      stateSourceUpdatedAt: new Date(staleUpdatedAt.getTime() - 1_000),
      chunks: [{ vector: basisVector(0) }],
    })
    await seedArticle({
      sourceId: 105,
      stateEmbeddingVersion: 'openai:text-embedding-3-small:1536:v1',
      chunks: [{
        vector: basisVector(0),
        provider: 'openai',
        model: 'text-embedding-3-small',
        embeddingVersion: 'openai:text-embedding-3-small:1536:v1',
      }],
    })
    await seedArticle({
      sourceId: 106,
      chunks: [{
        vector: basisVector(0),
        provider: 'openai',
        model: 'text-embedding-3-small',
        embeddingVersion: 'openai:text-embedding-3-small:1536:v1',
      }],
    })
    await seedArticle({
      sourceId: 107,
      stateChunkCount: 2,
      chunks: [{ vector: basisVector(0) }],
    })
    await seedArticle({
      sourceId: 108,
      stateChunkCount: 1,
      chunks: [
        { vector: basisVector(0) },
        {
          vector: basisVector(0),
          provider: 'openai',
          model: 'text-embedding-3-small',
          embeddingVersion: 'openai:text-embedding-3-small:1536:v1',
        },
      ],
    })
    await seedArticle({
      sourceId: 109,
      stateChunkCount: 2,
      chunks: [
        { vector: basisVector(0) },
        {
          vector: basisVector(0),
          provider: 'openai',
          model: 'text-embedding-3-small',
          embeddingVersion: 'openai:text-embedding-3-small:1536:v1',
        },
      ],
    })
    await seedArticle({ sourceId: 110, chunks: [{ vector: basisVector(1) }] })
    await seedArticle({ sourceId: 111, chunks: [{ vector: basisVector(1) }] })
    await seedArticle({
      sourceId: 112,
      stateChunkerVersion: 'old-chunker',
      chunks: [{ vector: basisVector(0), chunkerVersion: 'old-chunker' }],
    })
    await seedArticle({
      sourceId: 113,
      chunks: [{ vector: basisVector(0), languageCode: 'zh-cn' }],
    })
    await seedArticle({ sourceId: 114, chunks: [], stateChunkCount: 0 })
  }

  async function seedArticle(options: SeedArticleOptions): Promise<void> {
    const id = `article-${options.sourceId}`
    const updatedAt = options.updatedAt ?? new Date('2026-08-14T00:00:00.000Z')
    const languageCode = options.languageCode ?? 'en'
    const chunks = options.chunks
    await retrievalPool.query(`
      INSERT INTO "Article" (
        "id", "sourceId", "slug", "languageCode", "title", "content",
        "seoTitle", "seoDescription", "createdAt", "updatedAt"
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9)
    `, [
      id,
      options.sourceId,
      options.slug ?? `article-${options.sourceId}`,
      languageCode,
      options.title ?? `Article ${options.sourceId}`,
      options.content ?? `<p>Article ${options.sourceId}</p>`,
      options.seoTitle ?? null,
      options.seoDescription ?? null,
      updatedAt,
    ])

    if (chunks === undefined)
      return

    for (const [ordinal, chunk] of chunks.entries()) {
      const embeddingVersion = chunk.embeddingVersion ?? ACTIVE_EMBEDDING_PROFILE.version
      await retrievalPool.query(`
        INSERT INTO "ArticleChunk" (
          "id", "articleId", "ordinal", "languageCode", "sectionPath", "content",
          "tokenCount", "contentHash", "embeddingInputHash", "chunkerVersion",
          "embeddingProvider", "embeddingModel", "embeddingDimensions",
          "embeddingVersion", "embedding", "createdAt", "updatedAt"
        ) VALUES (
          $1, $2, $3, $4, $5, $6,
          1, $7, $8, $9,
          $10, $11, $12,
          $13, $14::vector, $15, $15
        )
      `, [
        `article-${options.sourceId}-chunk-${ordinal}`,
        id,
        ordinal,
        chunk.languageCode ?? languageCode,
        `Section ${ordinal}`,
        `Evidence ${options.sourceId}-${ordinal}`,
        `content-hash-${options.sourceId}-${ordinal}`,
        `input-hash-${options.sourceId}-${ordinal}`,
        chunk.chunkerVersion ?? ARTICLE_CHUNKER_PROFILE.version,
        chunk.provider ?? ACTIVE_EMBEDDING_PROFILE.provider,
        chunk.model ?? ACTIVE_EMBEDDING_PROFILE.model,
        ACTIVE_EMBEDDING_PROFILE.dimensions,
        embeddingVersion,
        vectorLiteral(chunk.vector),
        updatedAt,
      ])
    }

    await retrievalPool.query(`
      INSERT INTO "ArticleIndexState" (
        "articleId", "sourceHash", "sourceUpdatedAt", "chunkerVersion",
        "embeddingVersion", "chunkCount", "indexedAt", "createdAt", "updatedAt"
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $7, $7)
    `, [
      id,
      `source-hash-${options.sourceId}`,
      options.stateSourceUpdatedAt ?? updatedAt,
      options.stateChunkerVersion ?? ARTICLE_CHUNKER_PROFILE.version,
      options.stateEmbeddingVersion ?? ACTIVE_EMBEDDING_PROFILE.version,
      options.stateChunkCount ?? chunks.length,
      updatedAt,
    ])
  }

  async function waitForBlockedQuery(processId: number): Promise<void> {
    await waitFor(async () => {
      const result = await adminPool.query<{
        query: string
        wait_event_type: string | null
      }>(`
        SELECT query, wait_event_type
        FROM pg_stat_activity
        WHERE pid = $1
      `, [processId])
      return result.rows.some(row => (
        row.query.includes('compatible_chunks')
        && row.wait_event_type === 'Lock'
      ))
    })
  }

  async function waitForBackendExit(processId: number): Promise<void> {
    const deadlineAt = Date.now() + 5_000
    let lastState = 'unknown'
    let lastWaitEventType = 'unknown'
    while (Date.now() < deadlineAt) {
      const result = await adminPool.query<{
        state: string
        wait_event_type: string | null
      }>(`
        SELECT state, wait_event_type
        FROM pg_stat_activity
        WHERE pid = $1
      `, [processId])
      const activity = result.rows[0]
      if (!activity)
        return
      lastState = activity.state
      lastWaitEventType = activity.wait_event_type ?? 'null'
      await new Promise(resolve => setTimeout(resolve, 20))
    }
    throw new Error(
      `retrieval backend did not exit: state=${lastState}, wait=${lastWaitEventType}`,
    )
  }
})

interface SeedChunkOptions {
  vector: readonly number[]
  languageCode?: string
  provider?: string
  model?: string
  embeddingVersion?: string
  chunkerVersion?: string
}

interface SeedArticleOptions {
  sourceId: number
  slug?: string
  languageCode?: string
  title?: string
  content?: string
  seoTitle?: string
  seoDescription?: string
  updatedAt?: Date
  stateSourceUpdatedAt?: Date
  stateChunkerVersion?: string
  stateEmbeddingVersion?: string
  stateChunkCount?: number
  chunks?: SeedChunkOptions[]
}

class TrackingPool implements ArticleRetrievalPool {
  readonly connectedProcessIds: number[] = []
  readonly releaseErrors: Array<Error | undefined> = []

  constructor(private readonly pool: ArticleRetrievalPool) {}

  async connect(): Promise<ArticleRetrievalPoolClient> {
    const client = await this.pool.connect()
    if (client.processID !== undefined)
      this.connectedProcessIds.push(client.processID)
    return {
      ...(client.processID === undefined ? {} : { processID: client.processID }),
      query: async <Row>(text: string, values?: unknown[]) => (
        await client.query<Row>(text, values)
      ),
      release: (error?: Error) => {
        this.releaseErrors.push(error)
        client.release(error)
      },
    }
  }

  async cancel(processId: number): Promise<boolean> {
    return await this.pool.cancel(processId)
  }

  async query<Row>(
    text: string,
    values?: unknown[],
  ): Promise<QueryResult<Row>> {
    return await this.pool.query<Row>(text, values)
  }

  async auxiliaryQuery<Row>(
    text: string,
    values?: unknown[],
  ): Promise<QueryResult<Row>> {
    return await this.pool.auxiliaryQuery<Row>(text, values)
  }

  async end(): Promise<void> {
    await this.pool.end()
  }
}

function createContext(
  signal = new AbortController().signal,
  timeoutMs = 60_000,
) {
  return {
    signal,
    databaseDeadline: {
      deadlineAt: Date.now() + timeoutMs,
      signal,
      createTimeoutError: () => new DatabaseOperationDeadlineExceededError(
        'Article retrieval 数据库操作超时',
      ),
    },
  }
}

function basisVector(index: number): number[] {
  return Array.from(
    { length: ACTIVE_EMBEDDING_PROFILE.dimensions },
    (_, vectorIndex) => vectorIndex === index ? 1 : 0,
  )
}

function twoAxisVector(): number[] {
  const vector = basisVector(0)
  vector[1] = 1
  return vector
}

function vectorLiteral(vector: readonly number[]): string {
  assert.equal(vector.length, ACTIVE_EMBEDDING_PROFILE.dimensions)
  return `[${vector.join(',')}]`
}

function withSearchPath(connectionString: string, schema: string): string {
  const url = new URL(connectionString)
  url.searchParams.set('schema', schema)
  url.searchParams.set('options', `-c search_path=${schema},public`)
  return url.toString()
}

async function waitFor(
  predicate: () => boolean | Promise<boolean>,
  timeoutMs = 5_000,
): Promise<void> {
  const deadlineAt = Date.now() + timeoutMs
  while (Date.now() < deadlineAt) {
    if (await predicate())
      return
    await new Promise(resolve => setTimeout(resolve, 20))
  }
  throw new Error('timed out waiting for PostgreSQL integration condition')
}
