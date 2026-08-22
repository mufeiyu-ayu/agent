import type { LLMRuntimeConfigService } from '../llm/llm-runtime-config.js'
import type { PrismaService } from '../prisma/prisma.service.js'
import assert from 'node:assert/strict'
// 项目使用 Node 原生测试运行器，不为 Admin 查询引入额外测试框架。
// eslint-disable-next-line test/no-import-node-test
import { describe, it } from 'node:test'

import { AdminOverviewService, parseProviderBalance } from './admin-overview.service.js'

describe('AdminOverviewService stats', () => {
  it('聚合数字卡、每日趋势（上海归日补零）、状态 / 模型 / 工具分布', async () => {
    const now = new Date()
    const service = createService({
      windowRuns: [{ createdAt: now }, { createdAt: now }],
      samplingSteps: [
        {
          createdAt: now,
          input: { initialContext: { resolvedModel: 'deepseek-v4-flash' } },
          output: {
            usage: { inputTokens: 100, outputTokens: 20, totalTokens: 120 },
          },
        },
        {
          createdAt: now,
          input: { initialContext: { resolvedModel: 'deepseek-v4-flash' } },
          output: {
            usage: { inputTokens: 50, outputTokens: 5, totalTokens: 55 },
          },
        },
        // usage 缺失的 step 不计入 Token，但模型仍计入采样次数。
        {
          createdAt: now,
          input: { initialContext: { resolvedModel: 'deepseek-r2' } },
          output: {},
        },
      ],
      toolSteps: [
        { input: { toolName: 'searchArticles' } },
        { input: { toolName: 'searchArticles' } },
        { input: { toolName: 'fetchPage' } },
        { input: {} },
      ],
    })

    const stats = await service.getStats()

    assert.deepEqual(stats.totals, {
      conversationCount: 3,
      runCount: 7,
      messageCount: 14,
      inputTokens: 150,
      outputTokens: 25,
    })
    assert.equal(stats.windowDays, 30)
    assert.equal(stats.daily.length, 30)

    const today = stats.daily.at(-1)!
    assert.deepEqual(today, {
      date: shanghaiDateKey(now),
      runCount: 2,
      inputTokens: 150,
      outputTokens: 25,
    })
    // 其余日期补零。
    assert.equal(stats.daily.slice(0, -1).every(point => point.runCount === 0), true)

    assert.deepEqual(stats.statusCounts, {
      RUNNING: 0,
      COMPLETED: 5,
      FAILED: 2,
      ABORTED: 0,
    })
    assert.deepEqual(stats.models, [
      { model: 'deepseek-v4-flash', samplingCount: 2, totalTokens: 175 },
      { model: 'deepseek-r2', samplingCount: 1, totalTokens: 0 },
    ])
    assert.deepEqual(stats.tools, [
      { tool: 'searchArticles', count: 2 },
      { tool: 'fetchPage', count: 1 },
    ])
  })

  it('step 扫描与状态 groupBy 都带 createdAt gte 窗口下界，口径一致且不全表扫描', async () => {
    const calls: Array<Record<string, unknown>> = []
    const service = createService({
      stepFindManySpy: args => calls.push(args),
      groupBySpy: args => calls.push(args),
    })

    await service.getStats()

    assert.equal(calls.length, 3)
    for (const args of calls) {
      const where = args.where as { createdAt?: { gte?: Date } }
      assert.ok(where.createdAt?.gte instanceof Date)
    }
  })
})

describe('parseProviderBalance', () => {
  it('解析 DeepSeek 余额载荷', () => {
    assert.deepEqual(
      parseProviderBalance({
        is_available: true,
        balance_infos: [{ currency: 'CNY', total_balance: '12.34' }],
      }),
      { available: true, currency: 'CNY', totalBalance: '12.34' },
    )
  })

  it('结构不符时降级为不可用而不是抛错', () => {
    for (const payload of [null, {}, { is_available: 'yes' }, { is_available: true }]) {
      const parsed = parseProviderBalance(payload)
      assert.equal(parsed.currency === null || parsed.available, true)
      assert.doesNotThrow(() => parseProviderBalance(payload))
    }
    assert.deepEqual(parseProviderBalance({ is_available: true, balance_infos: [] }), {
      available: true,
      currency: null,
      totalBalance: null,
    })
  })
})

const SHANGHAI_OFFSET_MS = 8 * 3_600_000

function shanghaiDateKey(date: Date): string {
  return new Date(date.getTime() + SHANGHAI_OFFSET_MS).toISOString().slice(0, 10)
}

function createService(options: {
  windowRuns?: Array<{ createdAt: Date }>
  samplingSteps?: Array<{ createdAt: Date, input: unknown, output: unknown }>
  toolSteps?: Array<{ input: unknown }>
  stepFindManySpy?: (args: Record<string, unknown>) => void
  groupBySpy?: (args: Record<string, unknown>) => void
} = {}): AdminOverviewService {
  const prisma = {
    conversation: {
      async count() {
        return 3
      },
    },
    message: {
      async count() {
        return 14
      },
    },
    agentRun: {
      async count() {
        return 7
      },
      async groupBy(args: Record<string, unknown>) {
        options.groupBySpy?.(args)
        return [
          { status: 'COMPLETED', _count: { _all: 5 } },
          { status: 'FAILED', _count: { _all: 2 } },
        ]
      },
      async findMany() {
        return options.windowRuns ?? []
      },
    },
    agentStep: {
      async findMany(args: Record<string, unknown>) {
        options.stepFindManySpy?.(args)
        const where = args.where as { type?: string }
        return where.type === 'model_sampling'
          ? (options.samplingSteps ?? [])
          : (options.toolSteps ?? [])
      },
    },
  } as unknown as PrismaService

  const llmConfig = {
    value: { apiKey: 'test-key', baseUrl: 'https://api.deepseek.com/v1' },
  } as unknown as LLMRuntimeConfigService

  return new AdminOverviewService(prisma, llmConfig)
}
