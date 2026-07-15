import type { PrismaService } from '../prisma/prisma.service.js'
import type { SearchArticlesOutput } from './search-articles.tool.js'
import type { ToolExecutionContext } from './tool.types.js'
import assert from 'node:assert/strict'
// 项目本轮使用 Node 原生测试运行器，不引入额外测试框架。
// eslint-disable-next-line test/no-import-node-test
import { describe, it } from 'node:test'

import { toModelToolSpec } from './model-tool-spec.mapper.js'
import {
  searchArticlesDefinition,
  SearchArticlesTool,
} from './search-articles.tool.js'
import { ToolInvocationService } from './tool-invocation.service.js'
import { ToolRegistryService } from './tool-registry.service.js'
import { ToolsModule } from './tools.module.js'

const FULL_CONTENT = `<p>${'alpha article content '.repeat(20)}</p>`

describe('search_articles', () => {
  it('注册模型可见定义，并保持低风险只读边界', () => {
    const { registry, toolsModule } = createTools()
    const definition = registry.require('search_articles').definition

    assert.ok(toolsModule)
    assert.deepEqual(
      registry.listDefinitions().map(item => item.name),
      ['search_articles'],
    )
    assert.equal(definition, searchArticlesDefinition)
    assert.deepEqual(definition.risk, {
      level: 'low',
      sideEffect: 'none',
      network: false,
    })
    assert.equal(definition.requiresApproval, false)
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

    const result = await invocationService.invoke(
      createEnvelope({ query: '  Alpha  ', languageCode: ' ZH-CN ', limit: 3 }),
      createContext(),
    )

    assert.equal(result.ok, true)
    assert.deepEqual(
      fakePrisma.countArguments[0]?.where,
      fakePrisma.findManyArguments[0]?.where,
    )
    assert.equal(fakePrisma.findManyArguments[0]?.take, 3)
    assert.equal(fakePrisma.findManyArguments[0]?.where.languageCode, 'zh-cn')

    if (!result.ok)
      return

    const data = result.data as SearchArticlesOutput

    assert.equal(data.total, 12)
    assert.deepEqual(data.articles.map(({ excerpt, ...article }) => article), [{
      sourceId: 7,
      slug: 'alpha-article',
      languageCode: 'zh-cn',
      title: 'Alpha Article',
      seoTitle: 'Alpha SEO',
      seoDescription: null,
    }])
    assert.equal(data.articles[0]?.excerpt.length, 200)
    assert.equal(Object.hasOwn(data.articles[0] ?? {}, 'content'), false)
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
}

class FakePrismaService {
  readonly countArguments: FakeCountArguments[] = []
  readonly findManyArguments: FakeFindManyArguments[] = []
  readonly article = {
    count: async (arguments_: FakeCountArguments) => {
      this.countArguments.push(arguments_)
      return this.options.total ?? 0
    },
    findMany: async (arguments_: FakeFindManyArguments) => {
      this.findManyArguments.push(arguments_)
      return this.options.records ?? []
    },
  }

  constructor(private readonly options: FakePrismaOptions = {}) {}
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
  const toolsModule = new ToolsModule(registry, searchArticlesTool)

  return {
    registry,
    toolsModule,
    invocationService: new ToolInvocationService(registry),
  }
}

function createEnvelope(input: Record<string, unknown>) {
  return {
    callId: 'call-search-1',
    toolName: 'search_articles',
    rawArgumentsJson: JSON.stringify(input),
    samplingAttemptId: 'sampling-1',
  }
}

function createContext(): ToolExecutionContext {
  return {
    runId: 'run-1',
    conversationId: 'conversation-1',
    signal: new AbortController().signal,
    executionAttempt: 1,
  }
}
