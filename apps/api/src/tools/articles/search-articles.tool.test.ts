import type {
  DatabaseOperationDeadline,
  PrismaService,
} from '../../prisma/prisma.service.js'
import type {
  ToolExecutionContext,
  ValidatedToolInvocation,
} from '../core/tool.types.js'
import type {
  SearchArticlesInput,
  SearchArticlesOutput,
} from './search-articles.tool.js'
import assert from 'node:assert/strict'
// 项目本轮使用 Node 原生测试运行器，不引入额外测试框架。
// eslint-disable-next-line test/no-import-node-test
import { describe, it } from 'node:test'

import { PrismaArticleRetriever } from '../../retrieval/retrievers/prisma-article-retriever.js'
import { toModelToolSpec } from '../core/model-tool-spec.mapper.js'
import { ToolInvocationService } from '../core/tool-invocation.service.js'
import { ToolRegistryService } from '../core/tool-registry.service.js'
import {
  searchArticlesDefinition,
  SearchArticlesTool,
} from './search-articles.tool.js'

const FULL_CONTENT = `<p>${'alpha article content '.repeat(30)}</p>`

describe('search_articles', () => {
  it('注册模型可见定义，并保持低风险只读边界', () => {
    const { registry } = createTools()
    const definition = registry.require('search_articles').definition

    assert.deepEqual(
      registry.listDefinitions().map(item => item.name),
      ['search_articles'],
    )
    assert.equal(definition, searchArticlesDefinition)
    assert.deepEqual(definition.risk, {
      level: 'low',
      sideEffect: 'none',
      network: 'none',
    })
    assert.equal(definition.requiresApproval, false)
    assert.equal(definition.idempotent, true)
    assert.equal(definition.timeoutMs, 5_000)
    assert.equal(definition.maxObservationChars, 16_000)
    // 关键词发现结果永远不是回答证据，不进入 Run Evidence Registry。
    assert.equal(definition.evidencePolicy, 'discovery_only')
    assert.deepEqual(toModelToolSpec(definition), {
      name: 'search_articles',
      description: definition.description,
      inputSchema: definition.input.schema,
    })
  })

  it('校验并规范化参数，查询总数和受控精简结果', async () => {
    const fakePrisma = new FakePrismaService({
      total: 12,
      records: [{
        sourceId: 7,
        slug: 'alpha-article',
        languageCode: 'zh-cn',
        title: 'Alpha Article',
        seoTitle: 'Alpha SEO',
        seoDescription: null,
        content: FULL_CONTENT,
      }],
    })
    const { invocationService } = createTools(fakePrisma)
    const context = createContext()

    const result = await invocationService.invoke(
      createEnvelope({ query: '  Alpha%_\\  ', languageCode: ' ZH-CN ', limit: 10 }),
      context,
    )

    assert.equal(result.ok, true)
    assert.equal(fakePrisma.transactionDeadlines.length, 1)
    assert.ok(
      fakePrisma.transactionDeadlines[0]!.deadlineAt
      < context.databaseDeadline.deadlineAt,
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

    const data = result.data as SearchArticlesOutput

    assert.equal(data.query, 'Alpha%_\\')
    assert.equal(data.total, 12)
    assert.deepEqual(data.articles.map(({ excerpt, ...article }) => article), [{
      sourceId: 7,
      slug: 'alpha-article',
      languageCode: 'zh-cn',
      title: 'Alpha Article',
      seoTitle: 'Alpha SEO',
      seoDescription: null,
    }])
    assert.equal(data.articles[0]?.excerpt.length, 500)
    assert.equal(Object.hasOwn(data.articles[0] ?? {}, 'content'), false)
    assert.equal(
      result.modelContent,
      `共找到 12 篇匹配文章，以下是 1 条精简结果：\n${JSON.stringify(data.articles)}`,
    )
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
      const result = await invocationService.invoke(
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

    const result = await invocationService.invoke(
      createEnvelope({ query: 'missing' }),
      createContext(),
    )

    assert.equal(fakePrisma.findManyArguments[0]?.take, 5)
    assert.deepEqual(result, {
      ok: true,
      data: {
        query: 'missing',
        total: 0,
        articles: [],
      },
      modelContent: '没有找到与“missing”匹配的文章。',
    })
  })

  it('Executor 在 transaction acquisition 前响应已触发的 Tool signal', async () => {
    const fakePrisma = new FakePrismaService()
    const tool = new SearchArticlesTool(createRetriever(fakePrisma))
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
    const tool = new SearchArticlesTool(createRetriever(fakePrisma))
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
    const tool = new SearchArticlesTool(createRetriever(fakePrisma))

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
    createRetriever(fakePrisma),
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

function createRetriever(fakePrisma: FakePrismaService): PrismaArticleRetriever {
  return new PrismaArticleRetriever(fakePrisma as unknown as PrismaService)
}

function createEnvelope(input: Record<string, unknown>) {
  return {
    callId: 'call-search-1',
    toolName: 'search_articles',
    rawArgumentsJson: JSON.stringify(input),
    samplingAttemptId: 'sampling-1',
  }
}

function createValidatedInvocation(
  input: SearchArticlesInput,
): ValidatedToolInvocation<SearchArticlesInput> {
  return {
    callId: 'call-search-1',
    toolName: 'search_articles',
    toolVersion: '1',
    samplingAttemptId: 'sampling-1',
    input,
  }
}

function createContext(
  signal = new AbortController().signal,
): ToolExecutionContext {
  return {
    runId: 'run-1',
    conversationId: 'conversation-1',
    databaseDeadline: createDatabaseDeadline(signal),
    signal,
    executionAttempt: 1,
  }
}

function createDatabaseDeadline(signal: AbortSignal): DatabaseOperationDeadline {
  return {
    deadlineAt: Date.now() + 60_000,
    signal,
    createTimeoutError: () => new Error('test database deadline exceeded'),
  }
}
