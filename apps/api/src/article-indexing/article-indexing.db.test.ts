import type { DeterministicArticleChunk } from './article-chunking.js'
import type { ArticleIndexPool } from './article-index.repository.js'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import process from 'node:process'
// 项目使用 Node 原生测试运行器，不引入额外测试框架。
// eslint-disable-next-line test/no-import-node-test
import { after, before, describe, it } from 'node:test'
import { PrismaService } from '../prisma/prisma.service.js'
import {
  canonicalizeArticleSource,
  chunkCanonicalArticle,
} from './article-chunking.js'
import {
  ArticleIndexRepository,
  createArticleIndexPool,
} from './article-index.repository.js'
import { ACTIVE_EMBEDDING_PROFILE } from './embedding-provider.js'

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
  query: <Row = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ) => Promise<QueryResult<Row>>
  release: () => void
}

interface TestPool {
  connect: () => Promise<TestClient>
  query: <Row = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ) => Promise<QueryResult<Row>>
  end: () => Promise<void>
}

const articleSelect = {
  id: true,
  sourceId: true,
  title: true,
  languageCode: true,
  content: true,
  updatedAt: true,
} as const

integrationDescribe('Article indexing PostgreSQL / pgvector integration', {
  concurrency: 1,
}, () => {
  const schema = `article_index_test_${randomUUID().replaceAll('-', '')}`
  let adminPool: TestPool
  let repositoryPool: ArticleIndexPool
  let prisma: PrismaService
  let repository: ArticleIndexRepository

  before(async () => {
    assert.ok(testDatabaseUrl)
    assert.match(schema, /^article_index_test_[a-f\d]+$/)
    adminPool = new PgPool({
      connectionString: testDatabaseUrl,
      max: 4,
      connectionTimeoutMillis: 2_000,
    })
    const migrationClient = await adminPool.connect()

    try {
      // PostgreSQL cannot parameterize identifiers. The target is a freshly
      // generated, regex-validated test schema in an explicitly dedicated DB.
      await migrationClient.query(`CREATE SCHEMA "${schema}"`)
      await migrationClient.query(
        'SELECT set_config(\'search_path\', $1, false)',
        [`${schema},public`],
      )
      for (const path of [
        '../../prisma/migrations/20260711115000_add_article_demo_data/migration.sql',
        '../../prisma/migrations/20260711122500_add_article_language_code/migration.sql',
        '../../prisma/migrations/20260814090000_add_article_embedding_index/migration.sql',
      ]) {
        await migrationClient.query(await readFile(path, 'utf8'))
      }
    }
    finally {
      migrationClient.release()
    }

    const scopedUrl = withSearchPath(testDatabaseUrl, schema)
    const previousDatabaseUrl = process.env.DATABASE_URL
    process.env.DATABASE_URL = scopedUrl
    try {
      prisma = new PrismaService()
    }
    finally {
      if (previousDatabaseUrl === undefined)
        delete process.env.DATABASE_URL
      else
        process.env.DATABASE_URL = previousDatabaseUrl
    }
    repositoryPool = createArticleIndexPool(scopedUrl)
    repository = new ArticleIndexRepository(prisma, repositoryPool)
    await prisma.$connect()
  })

  after(async () => {
    await prisma?.$disconnect()
    await repositoryPool?.end()
    if (adminPool) {
      assert.match(schema, /^article_index_test_[a-f\d]+$/)
      await adminPool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
      await adminPool.end()
    }
  })

  it('正式 migration 建立 extension、vector(1536)、约束且不创建 ANN index', async () => {
    await repository.assertSchemaReady(new AbortController().signal)
    const result = await repositoryPool.query<{
      embedding_type: string
      has_chunk_table: boolean
      has_state_table: boolean
      ann_index_count: string
    }>(`
      SELECT
        (
          SELECT format_type(attribute.atttypid, attribute.atttypmod)
          FROM pg_attribute AS attribute
          JOIN pg_class AS relation ON relation.oid = attribute.attrelid
          WHERE relation.oid = to_regclass('"ArticleChunk"')
            AND attribute.attname = 'embedding'
        ) AS embedding_type,
        to_regclass('"ArticleChunk"') IS NOT NULL AS has_chunk_table,
        to_regclass('"ArticleIndexState"') IS NOT NULL AS has_state_table,
        (
          SELECT COUNT(*)::text
          FROM pg_indexes
          WHERE schemaname = current_schema()
            AND indexdef ~* 'USING (hnsw|ivfflat)'
        ) AS ann_index_count
    `)

    assert.deepEqual(result.rows[0], {
      embedding_type: 'vector(1536)',
      has_chunk_table: true,
      has_state_table: true,
      ann_index_count: '0',
    })
  })

  it('参数化 raw vector SQL 原子写入 active index 并支持 empty replacement', async () => {
    const article = await createArticle(101, '<h2>Section</h2><p>Hello vector</p>')
    const first = canonicalizeArticleSource(article)
    const firstChunks = chunkCanonicalArticle(
      first,
      ACTIVE_EMBEDDING_PROFILE.version,
    )

    assert.equal(await repository.replaceArticleIndex({
      source: first,
      chunks: firstChunks,
      vectors: firstChunks.map((_, index) => vector(index + 1)),
      embeddingProfile: ACTIVE_EMBEDDING_PROFILE,
      signal: new AbortController().signal,
    }), 'committed')

    const stored = await repositoryPool.query<{
      count: string
      dimensions: number
      chunk_count: number
    }>(`
      SELECT
        COUNT(*)::text AS count,
        MIN(vector_dims("embedding"))::integer AS dimensions,
        (SELECT "chunkCount" FROM "ArticleIndexState" WHERE "articleId" = $1) AS chunk_count
      FROM "ArticleChunk"
      WHERE "articleId" = $1
    `, [article.id])
    assert.deepEqual(stored.rows[0], {
      count: String(firstChunks.length),
      dimensions: 1536,
      chunk_count: firstChunks.length,
    })
    assert.equal(
      (await repository.getIndexStatus(
        first,
        new AbortController().signal,
      ))?.actualChunkCount,
      firstChunks.length,
    )

    const updated = await prisma.article.update({
      where: { id: article.id },
      data: { content: '<script>removed()</script>' },
      select: articleSelect,
    })
    assert.equal(
      await repository.getIndexStatus(first, new AbortController().signal),
      null,
    )
    const empty = canonicalizeArticleSource(updated)
    assert.equal(await repository.replaceArticleIndex({
      source: empty,
      chunks: [],
      vectors: [],
      embeddingProfile: ACTIVE_EMBEDDING_PROFILE,
      signal: new AbortController().signal,
    }), 'committed')
    assert.equal(await prisma.articleChunk.count({ where: { articleId: article.id } }), 0)
    assert.equal((await prisma.articleIndexState.findUniqueOrThrow({
      where: { articleId: article.id },
    })).chunkCount, 0)
  })

  it('事务中途约束失败会回滚 delete/insert/state，旧 index 完整保留', async () => {
    const article = await createArticle(102, '<p>Old active index</p>')
    const oldSource = canonicalizeArticleSource(article)
    const oldChunks = chunkCanonicalArticle(oldSource, ACTIVE_EMBEDDING_PROFILE.version)
    await repository.replaceArticleIndex({
      source: oldSource,
      chunks: oldChunks,
      vectors: oldChunks.map(() => vector(1)),
      embeddingProfile: ACTIVE_EMBEDDING_PROFILE,
      signal: new AbortController().signal,
    })
    const oldIds = oldChunks.map(chunk => chunk.id)

    const updated = await prisma.article.update({
      where: { id: article.id },
      data: { content: `<p>${'New content sentence. '.repeat(2_000)}</p>` },
      select: articleSelect,
    })
    const newSource = canonicalizeArticleSource(updated)
    const generated = chunkCanonicalArticle(
      newSource,
      ACTIVE_EMBEDDING_PROFILE.version,
    )
    assert.ok(generated.length > 1)
    const duplicateIdChunks: DeterministicArticleChunk[] = generated.map(
      (chunk, index) => index === 1 ? { ...chunk, id: generated[0]!.id } : chunk,
    )

    await assert.rejects(repository.replaceArticleIndex({
      source: newSource,
      chunks: duplicateIdChunks,
      vectors: duplicateIdChunks.map(() => vector(2)),
      embeddingProfile: ACTIVE_EMBEDDING_PROFILE,
      signal: new AbortController().signal,
    }))

    const remaining = await prisma.articleChunk.findMany({
      where: { articleId: article.id },
      select: { id: true },
      orderBy: { ordinal: 'asc' },
    })
    assert.deepEqual(remaining.map(item => item.id), oldIds)
    assert.equal(
      (await prisma.articleIndexState.findUniqueOrThrow({
        where: { articleId: article.id },
      })).sourceHash,
      oldSource.sourceHash,
    )
  })

  it('并发 Article update 在 FOR UPDATE fence 后判 stale，不写过期结果', async () => {
    const article = await createArticle(103, '<p>Before concurrent update</p>')
    const oldSource = canonicalizeArticleSource(article)
    const chunks = chunkCanonicalArticle(oldSource, ACTIVE_EMBEDDING_PROFILE.version)
    const updater = await adminPool.connect()
    await updater.query('SELECT set_config(\'search_path\', $1, false)', [schema])
    await updater.query('BEGIN')
    await updater.query(
      'UPDATE "Article" SET "content" = $1, "updatedAt" = $2 WHERE "id" = $3',
      ['After concurrent update', new Date(), article.id],
    )

    const replacement = repository.replaceArticleIndex({
      source: oldSource,
      chunks,
      vectors: chunks.map(() => vector(3)),
      embeddingProfile: ACTIVE_EMBEDDING_PROFILE,
      signal: new AbortController().signal,
    })
    await new Promise<void>(resolve => setTimeout(resolve, 25))
    await updater.query('COMMIT')
    updater.release()

    assert.equal(await replacement, 'stale')
    assert.equal(await prisma.articleChunk.count({ where: { articleId: article.id } }), 0)
    assert.equal(await prisma.articleIndexState.findUnique({
      where: { articleId: article.id },
    }), null)
  })

  it('session advisory lock 阻止第二个 repository，释放后可重新获取', async () => {
    assert.ok(testDatabaseUrl)
    const secondPool = createArticleIndexPool(withSearchPath(testDatabaseUrl, schema))
    const secondRepository = new ArticleIndexRepository(prisma, secondPool)
    const firstLock = await repository.acquireCommandLock(new AbortController().signal)
    assert.ok(firstLock)
    assert.equal(
      await secondRepository.acquireCommandLock(new AbortController().signal),
      null,
    )
    await firstLock.release()

    const secondLock = await secondRepository.acquireCommandLock(
      new AbortController().signal,
    )
    assert.ok(secondLock)
    await secondLock.release()
    await secondPool.end()
  })

  async function createArticle(sourceId: number, content: string) {
    return await prisma.article.create({
      data: {
        sourceId,
        slug: `db-article-${sourceId}`,
        languageCode: 'en',
        title: `DB Article ${sourceId}`,
        content,
      },
      select: articleSelect,
    })
  }
})

function vector(value: number): number[] {
  return Array.from(
    new Float64Array(ACTIVE_EMBEDDING_PROFILE.dimensions).fill(value),
  )
}

function withSearchPath(connectionString: string, schema: string): string {
  const url = new URL(connectionString)
  url.searchParams.delete('schema')
  url.searchParams.set('options', `-c search_path=${schema},public`)
  return url.toString()
}
