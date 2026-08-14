import type {
  ArticleRetrievalPool,
  ArticleRetrievalPoolClient,
} from './postgres-article-retrieval.repository.js'
import assert from 'node:assert/strict'
// 项目使用 Node 原生测试运行器，不引入额外测试框架。
// eslint-disable-next-line test/no-import-node-test
import { describe, it } from 'node:test'

import { ACTIVE_EMBEDDING_PROFILE } from '../embeddings/embedding-provider.js'
import {
  PostgresArticleRetrievalRepository,
} from './postgres-article-retrieval.repository.js'

describe('PostgresArticleRetrievalRepository', () => {
  it('使用 literal ILIKE pattern、稳定 relevance priority 和 sourceId tie-break', async () => {
    const client = new FakePoolClient({
      lexicalRows: [{
        source_id: 7,
        slug: 'literal-specials',
        language_code: 'zh-cn',
        title: 'Alpha%_\\',
        seo_title: null,
        seo_description: null,
        content: '<p>literal match</p>',
      }],
    })
    const repository = new PostgresArticleRetrievalRepository(
      new FakePool(client),
    )

    const result = await repository.findLexicalCandidates({
      query: 'Alpha%_\\',
      languageCode: 'zh-cn',
      limit: 10,
    }, createContext())

    assert.equal(result[0]?.sourceId, 7)
    const query = client.queries.find(entry => entry.text.includes('FROM "Article" AS article'))
    assert.ok(query)
    assert.deepEqual(query.values, [
      'Alpha%_\\',
      '%Alpha\\%\\_\\\\%',
      'zh-cn',
    ])
    assert.match(query.text, /LOWER\(article\."title"\) = LOWER\(\$1::text\)/)
    assert.match(query.text, /ESCAPE E'\\\\'/)
    assert.match(query.text, /article\."sourceId" ASC/)
    assert.match(query.text, /LIMIT 10/)
    assert.deepEqual(client.releaseArguments, [undefined])
  })

  it('参数化 exact cosine SQL 并过滤 active profile、语言、stale 和 chunk count', async () => {
    const client = new FakePoolClient({
      vectorRows: [{
        source_id: 3,
        slug: 'vector-result',
        language_code: 'en',
        title: 'Vector result',
        seo_title: null,
        seo_description: null,
        chunk_id: 'chunk-3-0',
        ordinal: 0,
        section_path: 'Overview',
        chunk_content: 'semantic content',
        cosine_distance: '0.125',
      }],
    })
    const repository = new PostgresArticleRetrievalRepository(
      new FakePool(client),
    )
    const vector = createVector(1)
    let sqlLatencyMs: number | undefined

    const result = await repository.findVectorChunkCandidates(
      vector,
      { query: 'semantic query', languageCode: 'en', limit: 5 },
      createContext(),
      latencyMs => void (sqlLatencyMs = latencyMs),
    )

    assert.equal(result[0]?.cosineDistance, 0.125)
    assert.ok(sqlLatencyMs !== undefined && sqlLatencyMs >= 0)
    const query = client.queries.find(entry => entry.text.includes('compatible_chunks'))
    assert.ok(query)
    assert.ok(!query.text.includes(query.values[0] as string))
    assert.match(query.text, /"embedding" <=> \$1::vector/)
    assert.match(query.text, /state\."sourceUpdatedAt" = article\."updatedAt"/)
    assert.match(query.text, /actual_chunk_count = declared_chunk_count::bigint/)
    assert.match(query.text, /compatible_chunk_count = declared_chunk_count::bigint/)
    assert.match(query.text, /cosine_distance ASC,[\s\S]*source_id ASC,[\s\S]*ordinal ASC,[\s\S]*chunk_id ASC/)
    assert.match(query.text, /LIMIT 40/)
    assert.deepEqual(query.values.slice(1), [
      'article-html-cl100k-v1',
      ACTIVE_EMBEDDING_PROFILE.version,
      ACTIVE_EMBEDDING_PROFILE.provider,
      ACTIVE_EMBEDDING_PROFILE.model,
      ACTIVE_EMBEDDING_PROFILE.dimensions,
      'en',
    ])
    assert.equal((query.values[0] as string).split(',').length, 1536)
  })

  it('Abort 时用 error release owned client 且不返回迟到查询结果', async () => {
    const client = new FakePoolClient({ hangVectorQuery: true })
    const pool = new FakePool(client)
    const repository = new PostgresArticleRetrievalRepository(
      pool,
    )
    const abortController = new AbortController()
    const pending = repository.findVectorChunkCandidates(
      createVector(1),
      { query: 'abort me', limit: 5 },
      createContext(abortController.signal),
    )

    await client.vectorQueryStarted
    abortController.abort()

    await assert.rejects(pending, { name: 'AbortError' })
    assert.deepEqual(pool.cancelledProcessIds, [123])
    assert.equal(client.releaseArguments.length, 1)
    assert.equal(client.releaseArguments[0]?.name, 'AbortError')
  })

  it('拒绝维度错误、非有限数值和零向量', async () => {
    const repository = new PostgresArticleRetrievalRepository(
      new FakePool(new FakePoolClient()),
    )

    for (const vector of [
      [1],
      [...createVector(1).slice(0, -1), Number.NaN],
      createVector(0),
    ]) {
      await assert.rejects(
        repository.findVectorChunkCandidates(
          vector,
          { query: 'invalid vector', limit: 5 },
          createContext(),
        ),
        /query embedding is invalid/,
      )
    }
  })
})

interface FakePoolClientOptions {
  lexicalRows?: Record<string, unknown>[]
  vectorRows?: Record<string, unknown>[]
  hangVectorQuery?: boolean
}

class FakePoolClient implements ArticleRetrievalPoolClient {
  readonly processID = 123
  readonly queries: Array<{ text: string, values: unknown[] }> = []
  readonly releaseArguments: Array<Error | undefined> = []
  readonly vectorQueryStarted: Promise<void>
  private resolveVectorQueryStarted!: () => void

  constructor(private readonly options: FakePoolClientOptions = {}) {
    this.vectorQueryStarted = new Promise((resolve) => {
      this.resolveVectorQueryStarted = resolve
    })
  }

  async query<Row>(
    text: string,
    values: unknown[] = [],
  ): Promise<{ rows: Row[] }> {
    this.queries.push({ text, values })

    if (text.includes('compatible_chunks')) {
      this.resolveVectorQueryStarted()
      if (this.options.hangVectorQuery)
        return await new Promise(() => {})
      return { rows: (this.options.vectorRows ?? []) as Row[] }
    }

    if (text.includes('FROM "Article" AS article'))
      return { rows: (this.options.lexicalRows ?? []) as Row[] }

    return { rows: [] }
  }

  release(error?: Error): void {
    this.releaseArguments.push(error)
  }
}

class FakePool implements ArticleRetrievalPool {
  readonly cancelledProcessIds: number[] = []

  constructor(private readonly client: ArticleRetrievalPoolClient) {}

  async connect(): Promise<ArticleRetrievalPoolClient> {
    return this.client
  }

  async cancel(processId: number): Promise<boolean> {
    this.cancelledProcessIds.push(processId)
    return true
  }

  async query<Row>(): Promise<{ rows: Row[] }> {
    return { rows: [] }
  }

  async end(): Promise<void> {}
}

function createContext(signal = new AbortController().signal) {
  return {
    signal,
    databaseDeadline: {
      deadlineAt: Date.now() + 60_000,
      signal,
      createTimeoutError: () => new Error('test retrieval deadline exceeded'),
    },
  }
}

function createVector(value: number): number[] {
  const vector: number[] = []
  for (let index = 0; index < ACTIVE_EMBEDDING_PROFILE.dimensions; index += 1)
    vector.push(value)
  return vector
}
