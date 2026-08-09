import type {
  DatabaseOperationDeadline,
  PrismaService,
} from '../../prisma/prisma.service.js'
import type {
  ToolExecutionContext,
  ValidatedToolInvocation,
} from '../core/tool.types.js'
import type { GetArticleDetailInput } from './get-article-detail.tool.js'
import assert from 'node:assert/strict'
// 项目本轮使用 Node 原生测试运行器，不引入额外测试框架。
// eslint-disable-next-line test/no-import-node-test
import { describe, it } from 'node:test'

import { toModelToolSpec } from '../core/model-tool-spec.mapper.js'
import { ToolInvocationService } from '../core/tool-invocation.service.js'
import { ToolRegistryService } from '../core/tool-registry.service.js'
import {
  getArticleDetailDefinition,
  GetArticleDetailTool,
} from './get-article-detail.tool.js'

const LONG_CONTENT = `<article>${'完整正文包含 emoji 🚀 和换行\n'.repeat(500)}</article>`

describe('get_article_detail', () => {
  it('注册模型可见定义，并保持低风险只读边界', () => {
    const { registry } = createTools()
    const definition = registry.require('get_article_detail').definition

    assert.deepEqual(
      registry.listDefinitions().map(item => item.name),
      ['get_article_detail'],
    )
    assert.equal(definition, getArticleDetailDefinition)
    assert.deepEqual(definition.risk, {
      level: 'low',
      sideEffect: 'none',
      network: false,
    })
    assert.equal(definition.requiresApproval, false)
    assert.equal(definition.idempotent, true)
    assert.equal(definition.timeoutMs, 5_000)
    assert.equal(definition.maxObservationChars, 64_000)
    assert.deepEqual(toModelToolSpec(definition), {
      name: 'get_article_detail',
      description: definition.description,
      inputSchema: definition.input.schema,
    })
  })

  it('按 sourceId 查询并返回完整的受控文章详情', async () => {
    const createdAt = new Date('2026-01-02T03:04:05.000Z')
    const updatedAt = new Date('2026-06-07T08:09:10.000Z')
    const fakePrisma = new FakePrismaService({
      record: {
        id: 'internal-database-id',
        sourceId: 25,
        slug: 'complete-article',
        languageCode: 'zh-cn',
        title: '完整文章',
        content: LONG_CONTENT,
        seoTitle: '受控 SEO 标题',
        seoDescription: null,
        createdAt,
        updatedAt,
        internalSecret: 'database password: secret',
      },
    })
    const { invocationService } = createTools(fakePrisma)
    const context = createContext()

    const result = await invocationService.invoke(
      createEnvelope({ sourceId: 25 }),
      context,
    )

    assert.deepEqual(fakePrisma.transactionDeadlines, [context.databaseDeadline])
    assert.equal(fakePrisma.executeCount, 1)
    assert.deepEqual(fakePrisma.findUniqueArguments, [{
      where: { sourceId: 25 },
      select: {
        sourceId: true,
        slug: true,
        languageCode: true,
        title: true,
        content: true,
        seoTitle: true,
        seoDescription: true,
        createdAt: true,
        updatedAt: true,
      },
    }])
    assert.deepEqual(result, {
      ok: true,
      data: {
        sourceId: 25,
        found: true,
        article: {
          sourceId: 25,
          slug: 'complete-article',
          languageCode: 'zh-cn',
          title: '完整文章',
          content: LONG_CONTENT,
          seoTitle: '受控 SEO 标题',
          seoDescription: null,
          createdAt: createdAt.toISOString(),
          updatedAt: updatedAt.toISOString(),
        },
      },
      modelContent: JSON.stringify({
        sourceId: 25,
        found: true,
        article: {
          sourceId: 25,
          slug: 'complete-article',
          languageCode: 'zh-cn',
          title: '完整文章',
          content: LONG_CONTENT,
          seoTitle: '受控 SEO 标题',
          seoDescription: null,
          createdAt: createdAt.toISOString(),
          updatedAt: updatedAt.toISOString(),
        },
      }),
    })
    const modelData = JSON.parse(result.modelContent) as {
      article: { content: string }
    }

    assert.equal(modelData.article.content, LONG_CONTENT)
    assert.doesNotMatch(result.modelContent, /internal-database-id|password|secret/)
  })

  it('文章不存在时返回成功的 found false 业务结果', async () => {
    const fakePrisma = new FakePrismaService()
    const { invocationService } = createTools(fakePrisma)

    const result = await invocationService.invoke(
      createEnvelope({ sourceId: 404 }),
      createContext(),
    )

    assert.deepEqual(result, {
      ok: true,
      data: {
        sourceId: 404,
        found: false,
        article: null,
      },
      modelContent: JSON.stringify({
        sourceId: 404,
        found: false,
        article: null,
      }),
    })
    assert.equal(fakePrisma.findUniqueArguments.length, 1)
  })

  it('拒绝无效输入、额外字段和 NaN，且不查询数据库', async () => {
    const fakePrisma = new FakePrismaService()
    const { invocationService } = createTools(fakePrisma)
    const invalidInputs = [
      null,
      [],
      {},
      { sourceId: null },
      { sourceId: '25' },
      { sourceId: true },
      { sourceId: 0 },
      { sourceId: -1 },
      { sourceId: 1.5 },
      { sourceId: 25, extra: true },
    ]

    for (const input of invalidInputs) {
      const result = await invocationService.invoke(
        createEnvelope(input),
        createContext(),
      )

      assert.equal(result.ok, false)
      assert.equal(result.ok ? undefined : result.code, 'invalid_arguments')
    }

    assert.throws(
      () => getArticleDetailDefinition.input.parse({ sourceId: Number.NaN }),
      /invalid get_article_detail sourceId/,
    )
    assert.equal(fakePrisma.transactionDeadlines.length, 0)
    assert.equal(fakePrisma.findUniqueArguments.length, 0)
  })

  it('数据库异常由统一 Invocation 转换为不泄漏细节的失败', async () => {
    const fakePrisma = new FakePrismaService({
      error: new Error('database password: secret\nstack: internal-driver'),
    })
    const { invocationService } = createTools(fakePrisma)

    const result = await invocationService.invoke(
      createEnvelope({ sourceId: 25 }),
      createContext(),
    )

    assert.deepEqual(result, {
      ok: false,
      code: 'execution_failed',
      modelContent: '工具 get_article_detail 执行失败。',
      retryable: false,
    })
    assert.doesNotMatch(result.modelContent, /database|password|secret|stack|driver/)
  })

  it('Executor 在查询前响应已触发的 AbortSignal', async () => {
    const fakePrisma = new FakePrismaService()
    const tool = new GetArticleDetailTool(
      fakePrisma as unknown as PrismaService,
    )
    const abortController = new AbortController()
    abortController.abort()

    await assert.rejects(
      tool.execute(
        createValidatedInvocation({ sourceId: 25 }),
        createContext(abortController.signal),
      ),
      { name: 'AbortError' },
    )
    assert.equal(fakePrisma.transactionDeadlines.length, 0)
    assert.equal(fakePrisma.findUniqueArguments.length, 0)
  })

  it('late transaction start 后重新检查 Tool signal，且不开始详情查询', async () => {
    const abortController = new AbortController()
    const fakePrisma = new FakePrismaService({
      beforeTransactionCallback: () => abortController.abort(),
    })
    const tool = new GetArticleDetailTool(fakePrisma as unknown as PrismaService)
    const context = createContext(abortController.signal)

    await assert.rejects(
      tool.execute(
        createValidatedInvocation({ sourceId: 25 }),
        context,
      ),
      { name: 'AbortError' },
    )
    assert.deepEqual(fakePrisma.transactionDeadlines, [context.databaseDeadline])
    assert.equal(fakePrisma.executeCount, 0)
    assert.equal(fakePrisma.findUniqueArguments.length, 0)
  })

  it('详情查询返回后重新检查 Tool signal，不返回迟到正常结果', async () => {
    const abortController = new AbortController()
    const fakePrisma = new FakePrismaService({
      record: createFakeArticleRecord(),
      afterFindUnique: () => abortController.abort(),
    })
    const tool = new GetArticleDetailTool(fakePrisma as unknown as PrismaService)

    await assert.rejects(
      tool.execute(
        createValidatedInvocation({ sourceId: 25 }),
        createContext(abortController.signal),
      ),
      { name: 'AbortError' },
    )
    assert.equal(fakePrisma.executeCount, 1)
    assert.equal(fakePrisma.findUniqueArguments.length, 1)
  })
})

interface FakeArticleRecord {
  id: string
  sourceId: number
  slug: string
  languageCode: string
  title: string
  content: string
  seoTitle: string | null
  seoDescription: string | null
  createdAt: Date
  updatedAt: Date
  internalSecret: string
}

interface FakePrismaOptions {
  record?: FakeArticleRecord
  error?: Error
  beforeTransactionCallback?: () => void
  afterFindUnique?: () => void
}

class FakePrismaService {
  readonly findUniqueArguments: FakeFindUniqueArguments[] = []
  readonly transactionDeadlines: DatabaseOperationDeadline[] = []
  executeCount = 0
  private readonly transactionClient: FakeTransactionClient = {
    article: {
      findUnique: async (arguments_: FakeFindUniqueArguments) => {
        this.findUniqueArguments.push(arguments_)

        if (this.options.error)
          throw this.options.error

        this.options.afterFindUnique?.()
        return this.options.record ?? null
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
    findUnique: (
      arguments_: FakeFindUniqueArguments,
    ) => Promise<FakeArticleRecord | null>
  }
}

interface FakeFindUniqueArguments {
  where: { sourceId: number }
  select: Record<string, boolean>
}

function createTools(fakePrisma = new FakePrismaService()) {
  const registry = new ToolRegistryService()
  const getArticleDetailTool = new GetArticleDetailTool(
    fakePrisma as unknown as PrismaService,
  )
  registry.register({
    definition: getArticleDetailDefinition,
    executor: getArticleDetailTool,
  })

  return {
    registry,
    invocationService: new ToolInvocationService(registry),
  }
}

function createEnvelope(input: unknown) {
  return {
    callId: 'call-detail-1',
    toolName: 'get_article_detail',
    rawArgumentsJson: JSON.stringify(input)!,
    samplingAttemptId: 'sampling-1',
  }
}

function createValidatedInvocation(
  input: GetArticleDetailInput,
): ValidatedToolInvocation<GetArticleDetailInput> {
  return {
    callId: 'call-detail-1',
    toolName: 'get_article_detail',
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

function createFakeArticleRecord(): FakeArticleRecord {
  return {
    id: 'internal-database-id',
    sourceId: 25,
    slug: 'complete-article',
    languageCode: 'zh-cn',
    title: '完整文章',
    content: LONG_CONTENT,
    seoTitle: '受控 SEO 标题',
    seoDescription: null,
    createdAt: new Date('2026-01-02T03:04:05.000Z'),
    updatedAt: new Date('2026-06-07T08:09:10.000Z'),
    internalSecret: 'database password: secret',
  }
}
