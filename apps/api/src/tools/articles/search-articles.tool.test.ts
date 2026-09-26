import type {
  DatabaseOperationDeadline,
  PrismaService,
} from '../../prisma/prisma.service.js'
import type {
  ToolInvocationContext,
  ValidatedToolInvocation,
} from '../core/tool.types.js'
import type { SearchArticlesInput } from './search-articles.tool.js'
import assert from 'node:assert/strict'
import { describe, it } from 'vitest'

import { ToolInvocationService } from '../core/tool-invocation.service.js'
import { ToolRegistryService } from '../core/tool-registry.service.js'
import {
  parseSearchArticlesInput,
  queryArticles,
  searchArticlesDefinition,
  SearchArticlesTool,
  toArticleExcerpt,
} from './search-articles.tool.js'

const FULL_CONTENT = `<p>${'alpha article content '.repeat(30)}</p>`
const ALPHA_ARTICLE: FakeArticleRecord = {
  sourceId: 7,
  slug: 'alpha-article',
  languageCode: 'zh-cn',
  title: 'Alpha Article',
  seoTitle: 'Alpha SEO',
  seoDescription: null,
  content: FULL_CONTENT,
}

describe('search_articles 输入规范化与摘录', () => {
  it('使用唯一规则规范化 query、languageCode 和 limit', () => {
    assert.deepEqual(
      parseSearchArticlesInput({
        query: '  Alpha%_\\  ',
        languageCode: ' ZH-CN ',
        limit: 10,
      }),
      {
        query: 'Alpha%_\\',
        languageCode: 'zh-cn',
        limit: 10,
      },
    )
    assert.deepEqual(
      parseSearchArticlesInput({ query: 'seo' }),
      { query: 'seo', limit: 5 },
    )
  })

  it('拒绝非法查询、语言、limit 和额外字段', () => {
    const invalidInputs = [
      null,
      [],
      {},
      { query: '   ' },
      { query: 'x'.repeat(101) },
      { query: 'seo', languageCode: '   ' },
      { query: 'seo', languageCode: 'x'.repeat(21) },
      { query: 'seo', limit: 0 },
      { query: 'seo', limit: 11 },
      { query: 'seo', limit: 1.5 },
      { query: 'seo', extra: true },
    ]

    for (const input of invalidInputs) {
      assert.throws(
        () => parseSearchArticlesInput(input),
        /invalid search_articles/,
      )
    }
  })

  it('同一规范化函数可直接复核已规范化的 query', () => {
    const query = parseSearchArticlesInput({
      query: '  seo  ',
      languageCode: ' EN ',
    })

    assert.deepEqual(parseSearchArticlesInput(query), query)
  })

  it('生成不含 HTML、压缩空白且 Unicode-safe 的 500 字符 excerpt', () => {
    const excerpt = toArticleExcerpt(
      `<article><h1> 标题 </h1><p>${'内容 🚀\n'.repeat(200)}</p></article>`,
    )

    assert.equal([...excerpt].length, 500)
    assert.doesNotMatch(excerpt, /<article>|<h1>|<p>|\n/)
    assert.doesNotMatch(excerpt, /\s{2,}/)
    assert.ok(excerpt.includes('🚀'), 'excerpt.includes(\'🚀\')')
  })
})

describe('queryArticles', () => {
  it('findMany 后 Abort 时不返回迟到正常结果', async () => {
    const abortController = new AbortController()
    const fakePrisma = new FakePrismaService({
      records: [ALPHA_ARTICLE],
      afterFindMany: () => abortController.abort(),
    })

    await assert.rejects(
      queryArticles(
        fakePrisma as unknown as PrismaService,
        { query: 'seo', limit: 5 },
        createContext(abortController.signal),
      ),
      { name: 'AbortError' },
    )
    assert.deepEqual(fakePrisma.queryOrder, ['count', 'findMany'])
  })
})

describe('search_articles', () => {
  it('校验并规范化参数，查询总数和受控精简结果', async () => {
    const fakePrisma = new FakePrismaService({
      total: 12,
      records: [ALPHA_ARTICLE],
    })
    const { invocationService } = createTools(fakePrisma)
    const context = createContext()

    const { result } = await invocationService.invoke(
      createEnvelope({ query: '  Alpha%_\\  ', languageCode: ' ZH-CN ', limit: 10 }),
      context,
    )

    assert.equal(result.ok, true)
    assert.equal(fakePrisma.transactionDeadlines.length, 1)
    assert.ok(
      fakePrisma.transactionDeadlines[0]!.deadlineAt
      < context.databaseDeadline.deadlineAt,
      'fakePrisma.transactionDeadlines[0]!.deadlineAt < context.databaseDeadline.deadlineAt',
    )
    assert.notEqual(
      fakePrisma.transactionDeadlines[0]!.signal,
      context.databaseDeadline.signal,
    )
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

    if (!result.ok)
      return

    // 精简结果只通过 modelContent 交给模型：第一行是总数说明，第二行是 JSON。
    const [headline, serializedArticles] = result.modelContent.split('\n')
    const articles = JSON.parse(serializedArticles!) as Array<Record<string, unknown>>

    assert.equal(headline, '共找到 12 篇匹配文章，以下是 1 条精简结果：')
    assert.deepEqual(articles.map(({ excerpt: _excerpt, ...article }) => article), [{
      sourceId: 7,
      slug: 'alpha-article',
      languageCode: 'zh-cn',
      title: 'Alpha Article',
      seoTitle: 'Alpha SEO',
      seoDescription: null,
    }])
    assert.equal((articles[0]?.excerpt as string).length, 500)
    assert.equal(Object.hasOwn(articles[0] ?? {}, 'content'), false)
    assert.doesNotMatch(result.modelContent, new RegExp(FULL_CONTENT))
    assert.doesNotMatch(result.modelContent, /<p>|<\/p>/)
  })

  it('拒绝空 query、超限 limit 和额外字段，且不查询数据库', async () => {
    const fakePrisma = new FakePrismaService()
    const { invocationService } = createTools(fakePrisma)
    const invalidInputs = [
      { query: '   ' },
      { query: 'alpha', limit: 11 },
      { query: 'alpha', extra: true },
    ]

    for (const input of invalidInputs) {
      const { result } = await invocationService.invoke(
        createEnvelope(input),
        createContext(),
      )

      assert.equal(result.ok, false)
      assert.equal(result.ok ? undefined : result.code, 'invalid_arguments')
    }

    assert.equal(fakePrisma.countArguments.length, 0)
    assert.equal(fakePrisma.findManyArguments.length, 0)
  })

  it('无结果时返回成功、空列表和可用于 Observation 的说明', async () => {
    const fakePrisma = new FakePrismaService()
    const { invocationService } = createTools(fakePrisma)

    const { result } = await invocationService.invoke(
      createEnvelope({ query: 'missing' }),
      createContext(),
    )

    assert.equal(fakePrisma.findManyArguments[0]?.take, 5)
    assert.deepEqual(result, {
      ok: true,
      modelContent: '没有找到与“missing”匹配的文章。',
    })
  })

  it('Executor 在 transaction acquisition 前响应已触发的 Tool signal', async () => {
    const fakePrisma = new FakePrismaService()
    const tool = new SearchArticlesTool(fakePrisma as unknown as PrismaService)
    const abortController = new AbortController()

    abortController.abort()

    await assert.rejects(
      tool.execute(
        createValidatedInvocation({ query: 'seo', limit: 5 }),
        createContext(abortController.signal),
      ),
      { name: 'AbortError' },
    )
    assert.equal(fakePrisma.transactionDeadlines.length, 0)
    assert.deepEqual(fakePrisma.queryOrder, [])
  })

  it('late transaction start 后重新检查 Tool signal，且不开始第一条查询', async () => {
    const abortController = new AbortController()
    const fakePrisma = new FakePrismaService({
      beforeTransactionCallback: () => abortController.abort(),
    })
    const tool = new SearchArticlesTool(fakePrisma as unknown as PrismaService)
    const context = createContext(abortController.signal)

    await assert.rejects(
      tool.execute(
        createValidatedInvocation({ query: 'seo', limit: 5 }),
        context,
      ),
      { name: 'AbortError' },
    )
    assert.deepEqual(fakePrisma.transactionDeadlines, [context.databaseDeadline])
    assert.equal(fakePrisma.executeCount, 0)
    assert.deepEqual(fakePrisma.queryOrder, [])
  })

  it('第一条查询返回后重新检查 Tool signal，且不开始第二条查询', async () => {
    const abortController = new AbortController()
    const fakePrisma = new FakePrismaService({
      afterCount: () => abortController.abort(),
    })
    const tool = new SearchArticlesTool(fakePrisma as unknown as PrismaService)

    await assert.rejects(
      tool.execute(
        createValidatedInvocation({ query: 'seo', limit: 5 }),
        createContext(abortController.signal),
      ),
      { name: 'AbortError' },
    )
    assert.equal(fakePrisma.executeCount, 1)
    assert.deepEqual(fakePrisma.queryOrder, ['count'])
    assert.equal(fakePrisma.findManyArguments.length, 0)
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

interface FakeWhere {
  languageCode?: string
  [key: string]: unknown
}

interface FakeCountArguments {
  where: FakeWhere
}

interface FakeFindManyArguments {
  where: FakeWhere
  take: number
  [key: string]: unknown
}

function createTools(fakePrisma = new FakePrismaService()) {
  const registry = new ToolRegistryService()
  const searchArticlesTool = new SearchArticlesTool(
    fakePrisma as unknown as PrismaService,
  )
  registry.register({
    definition: searchArticlesDefinition,
    executor: searchArticlesTool,
  })

  return {
    registry,
    invocationService: new ToolInvocationService(registry),
  }
}

function createEnvelope(input: Record<string, unknown>) {
  return {
    callId: 'call-search-1',
    toolName: 'search_articles',
    rawArgumentsJson: JSON.stringify(input),
  }
}

function createValidatedInvocation(
  input: SearchArticlesInput,
): ValidatedToolInvocation<SearchArticlesInput> {
  return {
    toolName: 'search_articles',
    input,
  }
}

function createContext(
  signal = new AbortController().signal,
): ToolInvocationContext {
  return {
    databaseDeadline: createDatabaseDeadline(signal),
    signal,
    argumentsTruncated: false,
  }
}

function createDatabaseDeadline(signal: AbortSignal): DatabaseOperationDeadline {
  return {
    deadlineAt: Date.now() + 60_000,
    signal,
    createTimeoutError: () => new Error('test database deadline exceeded'),
  }
}
