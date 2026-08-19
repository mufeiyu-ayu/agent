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

  it('存在 stale 排除时经节流告警，无 stale 时静默', async () => {
    const staleQueryValues: unknown[][] = []
    let staleCount = 2
    // owned 查询每次 connect 需要全新 client（release 是一次性的）；
    // stale observability 走 pool.query 直查，不经过连接所有权机器。
    const pool: ArticleRetrievalPool = {
      connect: async () => new FakePoolClient({ vectorRows: [] }),
      cancel: async () => true,
      query: async () => ({ rows: [] }),
      auxiliaryQuery: (async (text: string, values: unknown[] = []) => {
        assert.match(text, /stale_article_count/)
        staleQueryValues.push(values)
        return { rows: [{ stale_article_count: staleCount }] }
      }) as ArticleRetrievalPool['auxiliaryQuery'],
      end: async () => {},
    }

    const repository = new PostgresArticleRetrievalRepository(pool)
    const warnings: string[] = []

    ;(repository as unknown as {
      logger: { warn: (message: string) => void }
    }).logger = { warn: message => warnings.push(message) }

    const retrieve = async () => repository.findVectorChunkCandidates(
      createVector(0.5),
      { query: 'stale check', limit: 5 },
      createContext(),
    )

    await retrieve()
    await nextMacrotask()

    assert.equal(staleQueryValues.length, 1)
    assert.deepEqual(staleQueryValues[0], [
      'article-html-cl100k-v1',
      ACTIVE_EMBEDDING_PROFILE.version,
      ACTIVE_EMBEDDING_PROFILE.provider,
      ACTIVE_EMBEDDING_PROFILE.model,
      ACTIVE_EMBEDDING_PROFILE.dimensions,
    ])
    assert.equal(warnings.length, 1)
    assert.match(warnings[0]!, /2 篇已索引文章.*不可被向量检索/)

    // 节流窗口内的第二次检索不再触发 observability 查询。
    staleCount = 0
    await retrieve()
    await nextMacrotask()

    assert.equal(staleQueryValues.length, 1)
    assert.equal(warnings.length, 1)

    // 无 stale 时不产生任何告警。
    ;(repository as unknown as { lastStaleCheckAt: number }).lastStaleCheckAt = 0
    await retrieve()
    await nextMacrotask()

    assert.equal(staleQueryValues.length, 2)
    assert.equal(warnings.length, 1)
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

  describe('连接获取阶段的 client 所有权', () => {
    it('connection 已 fulfilled 但成功 reaction 执行前 Abort 时只 release 一次', async () => {
      const client = new FakePoolClient()
      const connection = Promise.resolve<ArticleRetrievalPoolClient>(client)
      const pool = new FakePool(connection)
      const abortController = new AbortController()
      // 在 helper 注册 connection reaction 之前排入一条 microtask，
      // 让 Abort 精确落在“connection 已 fulfilled、成功回调尚未执行”的窗口里。
      void connection.then(() => abortController.abort())

      await expectNoUnhandledRejection(async () => {
        await assert.rejects(
          new PostgresArticleRetrievalRepository(pool).findLexicalCandidates(
            { query: 'connection race', limit: 10 },
            createContext(abortController.signal),
          ),
          { name: 'AbortError' },
        )
      })

      assert.equal(client.releaseArguments.length, 1)
      assert.equal(client.releaseArguments[0]?.name, 'AbortError')
      assert.deepEqual(pool.cancelledProcessIds, [])
    })

    it('pending connect 期间 Abort 后，迟到 client 用同一个 abort error release 一次', async () => {
      const client = new FakePoolClient()
      const connection = createDeferredConnection()
      const pool = new FakePool(connection.promise)
      const abortController = new AbortController()

      const pending = new PostgresArticleRetrievalRepository(pool).findLexicalCandidates(
        { query: 'abort while connecting', limit: 10 },
        createContext(abortController.signal),
      )
      abortController.abort()
      connection.resolve(client)

      const abortError = await pending.then(
        () => assert.fail('连接被 Abort 时调用不应成功'),
        (error: unknown) => error,
      )
      assert.equal((abortError as Error).name, 'AbortError')
      assert.equal(client.releaseArguments.length, 1)
      assert.strictEqual(client.releaseArguments[0], abortError)
      assert.deepEqual(pool.cancelledProcessIds, [])
    })

    it('连接正常移交后 helper 不 release，late Abort 也不改变释放结果', async () => {
      const client = new FakePoolClient()
      const pool = new FakePool(client)
      const abortController = new AbortController()

      await new PostgresArticleRetrievalRepository(pool).findLexicalCandidates(
        { query: 'owned transfer', limit: 10 },
        createContext(abortController.signal),
      )

      abortController.abort()
      await nextMacrotask()
      // helper release 0 次，唯一一次无错误 release 来自 runOwnedReadQuery 的成功收尾。
      assert.deepEqual(client.releaseArguments, [undefined])
      assert.equal(pool.connectCalls, 1)
    })

    it('connection 先失败时保留原始连接错误，late Abort 不改变结果', async () => {
      const connection = createDeferredConnection()
      const pool = new FakePool(connection.promise)
      const abortController = new AbortController()

      const pending = new PostgresArticleRetrievalRepository(pool).findLexicalCandidates(
        { query: 'connect failure', limit: 10 },
        createContext(abortController.signal),
      )
      connection.reject(new Error('pool connect failed'))

      await assert.rejects(pending, /pool connect failed/)
      // listener 已在失败分支移除：迟到的 Abort 不会再产生任何释放或取消动作。
      abortController.abort()
      await nextMacrotask()
      assert.deepEqual(pool.cancelledProcessIds, [])
    })

    it('Abort 先赢时迟到的 connection rejection 被安全观察且不产生 release', async () => {
      const connection = createDeferredConnection()
      const pool = new FakePool(connection.promise)
      const abortController = new AbortController()

      await expectNoUnhandledRejection(async () => {
        const pending = new PostgresArticleRetrievalRepository(pool).findLexicalCandidates(
          { query: 'abort then connect failure', limit: 10 },
          createContext(abortController.signal),
        )
        abortController.abort()
        connection.reject(new Error('pool connect failed after abort'))

        await assert.rejects(pending, { name: 'AbortError' })
      })

      assert.deepEqual(pool.cancelledProcessIds, [])
    })

    it('signal 在调用前已 Abort 时不调用 pool.connect', async () => {
      const pool = new FakePool(new FakePoolClient())
      const abortController = new AbortController()
      abortController.abort()

      await assert.rejects(
        new PostgresArticleRetrievalRepository(pool).findLexicalCandidates(
          { query: 'pre aborted', limit: 10 },
          createContext(abortController.signal),
        ),
        { name: 'AbortError' },
      )

      assert.equal(pool.connectCalls, 0)
    })
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
    // 复刻 pg-pool `_releaseOnce()` 的一次性语义，double-release 必须在测试里立刻暴露。
    if (this.releaseArguments.length > 1)
      throw new Error('Release called on client which has already been released to the pool.')
  }
}

class FakePool implements ArticleRetrievalPool {
  readonly cancelledProcessIds: number[] = []
  connectCalls = 0

  constructor(
    private readonly connection:
      | ArticleRetrievalPoolClient
      | Promise<ArticleRetrievalPoolClient>,
  ) {}

  connect(): Promise<ArticleRetrievalPoolClient> {
    this.connectCalls += 1
    // Promise.resolve 对原生 Promise 返回同一实例，保留“connection 已 fulfilled”这一竞态前提。
    return Promise.resolve(this.connection)
  }

  async cancel(processId: number): Promise<boolean> {
    this.cancelledProcessIds.push(processId)
    return true
  }

  async query<Row>(): Promise<{ rows: Row[] }> {
    return { rows: [] }
  }

  async auxiliaryQuery<Row>(): Promise<{ rows: Row[] }> {
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

function createDeferredConnection(): {
  promise: Promise<ArticleRetrievalPoolClient>
  resolve: (client: ArticleRetrievalPoolClient) => void
  reject: (error: Error) => void
} {
  let resolve!: (client: ArticleRetrievalPoolClient) => void
  let reject!: (error: Error) => void
  const promise = new Promise<ArticleRetrievalPoolClient>((resolveFn, rejectFn) => {
    resolve = resolveFn
    reject = rejectFn
  })
  return { promise, resolve, reject }
}

// unhandledRejection 在当前 turn 结束后才派发，需要跨一次 macrotask 才能观察到。
async function nextMacrotask(): Promise<void> {
  await new Promise<void>(resolve => setImmediate(resolve))
}

async function expectNoUnhandledRejection(run: () => Promise<void>): Promise<void> {
  const unhandledReasons: unknown[] = []
  const onUnhandledRejection = (reason: unknown): number => unhandledReasons.push(reason)
  process.on('unhandledRejection', onUnhandledRejection)

  try {
    await run()
    await nextMacrotask()
    assert.deepEqual(unhandledReasons, [])
  }
  finally {
    process.off('unhandledRejection', onUnhandledRejection)
  }
}

function createVector(value: number): number[] {
  const vector: number[] = []
  for (let index = 0; index < ACTIVE_EMBEDDING_PROFILE.dimensions; index += 1)
    vector.push(value)
  return vector
}
