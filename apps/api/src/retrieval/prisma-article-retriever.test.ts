import type {
  DatabaseOperationDeadline,
  PrismaService,
} from '../prisma/prisma.service.js'
import type {
  ArticleRetriever,
  DatabaseArticleRetrievalExecutionContext,
} from './article-retrieval.js'
import assert from 'node:assert/strict'
// 项目本轮使用 Node 原生测试运行器，不引入额外测试框架。
// eslint-disable-next-line test/no-import-node-test
import { describe, it } from 'node:test'

import { PrismaArticleRetriever } from './prisma-article-retriever.js'

const FULL_CONTENT = `<p>${'alpha article content 🚀 '.repeat(30)}</p>`

describe('PrismaArticleRetriever', () => {
  it('在编译期符合包含 databaseDeadline 的 Retrieval Contract', () => {
    const retriever = new PrismaArticleRetriever(
      new FakePrismaService() as unknown as PrismaService,
    )
    const contract: ArticleRetriever<DatabaseArticleRetrievalExecutionContext> = retriever

    // @ts-expect-error 生产 Retriever 的 context 必须包含 databaseDeadline。
    const missingDeadline: Parameters<typeof contract.retrieve>[1] = {
      signal: new AbortController().signal,
    }

    assert.equal(contract, retriever)
    assert.ok(missingDeadline.signal)
  })

  it('保持 lexical 查询条件、顺序、deadline、excerpt 和稳定 rank', async () => {
    const fakePrisma = new FakePrismaService({
      total: 12,
      records: [
        createRecord(7, FULL_CONTENT),
        createRecord(9, '<p>second result</p>'),
      ],
    })
    const retriever = new PrismaArticleRetriever(
      fakePrisma as unknown as PrismaService,
    )
    const context = createContext()

    const result = await retriever.retrieve({
      query: '  Alpha%_\\  ',
      languageCode: ' ZH-CN ',
      limit: 10,
    }, context)

    assert.deepEqual(fakePrisma.transactionDeadlines, [context.databaseDeadline])
    assert.equal(fakePrisma.executeCount, 2)
    assert.deepEqual(fakePrisma.queryOrder, ['count', 'findMany'])
    assert.equal(fakePrisma.findManyStartedBeforeCountCompleted, false)
    assert.deepEqual(
      fakePrisma.countArguments[0]?.where,
      fakePrisma.findManyArguments[0]?.where,
    )
    assert.equal(fakePrisma.findManyArguments[0]?.take, 10)
    assert.deepEqual(fakePrisma.findManyArguments[0]?.where, {
      languageCode: 'zh-cn',
      OR: [
        { title: { contains: 'Alpha\\%\\_\\\\', mode: 'insensitive' } },
        { slug: { contains: 'Alpha\\%\\_\\\\', mode: 'insensitive' } },
        { seoTitle: { contains: 'Alpha\\%\\_\\\\', mode: 'insensitive' } },
        { seoDescription: { contains: 'Alpha\\%\\_\\\\', mode: 'insensitive' } },
        { content: { contains: 'Alpha\\%\\_\\\\', mode: 'insensitive' } },
      ],
    })
    assert.deepEqual(fakePrisma.findManyArguments[0]?.select, {
      sourceId: true,
      slug: true,
      languageCode: true,
      title: true,
      seoTitle: true,
      seoDescription: true,
      content: true,
    })
    assert.deepEqual(fakePrisma.findManyArguments[0]?.orderBy, [
      { updatedAt: 'desc' },
      { sourceId: 'asc' },
    ])
    assert.deepEqual(result.query, {
      query: 'Alpha%_\\',
      languageCode: 'zh-cn',
      limit: 10,
    })
    assert.deepEqual(result.strategy, {
      name: 'prisma_lexical',
      version: '1',
    })
    assert.equal(result.total, 12)
    assert.deepEqual(result.hits.map(hit => hit.rank), [1, 2])
    assert.equal([...result.hits[0]!.excerpt].length, 500)
    assert.equal(Object.hasOwn(result.hits[0] ?? {}, 'content'), false)
  })

  it('在 transaction acquisition 前响应已触发的 AbortSignal', async () => {
    const fakePrisma = new FakePrismaService()
    const retriever = new PrismaArticleRetriever(
      fakePrisma as unknown as PrismaService,
    )
    const abortController = new AbortController()
    abortController.abort()

    await assert.rejects(
      retriever.retrieve(
        { query: 'seo', limit: 5 },
        createContext(abortController.signal),
      ),
      { name: 'AbortError' },
    )
    assert.deepEqual(fakePrisma.transactionDeadlines, [])
    assert.deepEqual(fakePrisma.queryOrder, [])
  })

  it('late transaction start 后不开始 count', async () => {
    const abortController = new AbortController()
    const fakePrisma = new FakePrismaService({
      beforeTransactionCallback: () => abortController.abort(),
    })
    const retriever = new PrismaArticleRetriever(
      fakePrisma as unknown as PrismaService,
    )
    const context = createContext(abortController.signal)

    await assert.rejects(
      retriever.retrieve({ query: 'seo', limit: 5 }, context),
      { name: 'AbortError' },
    )
    assert.deepEqual(fakePrisma.transactionDeadlines, [context.databaseDeadline])
    assert.equal(fakePrisma.executeCount, 0)
  })

  it('count 后 Abort 时不开始 findMany', async () => {
    const abortController = new AbortController()
    const fakePrisma = new FakePrismaService({
      afterCount: () => abortController.abort(),
    })
    const retriever = new PrismaArticleRetriever(
      fakePrisma as unknown as PrismaService,
    )

    await assert.rejects(
      retriever.retrieve(
        { query: 'seo', limit: 5 },
        createContext(abortController.signal),
      ),
      { name: 'AbortError' },
    )
    assert.deepEqual(fakePrisma.queryOrder, ['count'])
  })

  it('findMany 后 Abort 时不返回迟到正常结果', async () => {
    const abortController = new AbortController()
    const fakePrisma = new FakePrismaService({
      records: [createRecord(7, FULL_CONTENT)],
      afterFindMany: () => abortController.abort(),
    })
    const retriever = new PrismaArticleRetriever(
      fakePrisma as unknown as PrismaService,
    )

    await assert.rejects(
      retriever.retrieve(
        { query: 'seo', limit: 5 },
        createContext(abortController.signal),
      ),
      { name: 'AbortError' },
    )
    assert.deepEqual(fakePrisma.queryOrder, ['count', 'findMany'])
  })
})

interface FakeArticleRecord {
  sourceId: number
  slug: string
  languageCode: string
  title: string
  seoTitle: string | null
  seoDescription: string | null
  content: string
}

interface FakePrismaOptions {
  total?: number
  records?: FakeArticleRecord[]
  beforeTransactionCallback?: () => void
  afterCount?: () => void
  afterFindMany?: () => void
}

class FakePrismaService {
  readonly countArguments: FakeCountArguments[] = []
  readonly findManyArguments: FakeFindManyArguments[] = []
  readonly queryOrder: Array<'count' | 'findMany'> = []
  readonly transactionDeadlines: DatabaseOperationDeadline[] = []
  executeCount = 0
  findManyStartedBeforeCountCompleted = false
  private countCompleted = false
  private readonly transactionClient: FakeTransactionClient = {
    article: {
      count: async (arguments_: FakeCountArguments) => {
        this.queryOrder.push('count')
        this.countArguments.push(arguments_)
        await Promise.resolve()
        this.countCompleted = true
        this.options.afterCount?.()
        return this.options.total ?? 0
      },
      findMany: async (arguments_: FakeFindManyArguments) => {
        this.queryOrder.push('findMany')
        this.findManyStartedBeforeCountCompleted = !this.countCompleted
        this.findManyArguments.push(arguments_)
        this.options.afterFindMany?.()
        return this.options.records ?? []
      },
    },
  }

  private readonly transaction = {
    execute: async <T>(
      operation: (prisma: FakeTransactionClient) => Promise<T>,
    ): Promise<T> => {
      this.executeCount += 1
      return await operation(this.transactionClient)
    },
  }

  constructor(private readonly options: FakePrismaOptions = {}) {}

  async withDeadlineTransaction<T>(
    deadline: DatabaseOperationDeadline,
    callback: (transaction: typeof this.transaction) => Promise<T>,
  ): Promise<T> {
    this.transactionDeadlines.push(deadline)
    this.options.beforeTransactionCallback?.()
    return await callback(this.transaction)
  }
}

interface FakeTransactionClient {
  article: {
    count: (arguments_: FakeCountArguments) => Promise<number>
    findMany: (arguments_: FakeFindManyArguments) => Promise<FakeArticleRecord[]>
  }
}

interface FakeCountArguments {
  where: Record<string, unknown>
}

interface FakeFindManyArguments {
  where: Record<string, unknown>
  take: number
  [key: string]: unknown
}

function createContext(
  signal = new AbortController().signal,
) {
  return {
    databaseDeadline: createDatabaseDeadline(signal),
    signal,
  }
}

function createDatabaseDeadline(signal: AbortSignal): DatabaseOperationDeadline {
  return {
    deadlineAt: Date.now() + 60_000,
    signal,
    createTimeoutError: () => new Error('test database deadline exceeded'),
  }
}

function createRecord(sourceId: number, content: string): FakeArticleRecord {
  return {
    sourceId,
    slug: `article-${sourceId}`,
    languageCode: 'zh-cn',
    title: `Alpha Article ${sourceId}`,
    seoTitle: 'Alpha SEO',
    seoDescription: null,
    content,
  }
}
