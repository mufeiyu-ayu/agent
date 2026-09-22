import type { LlmModelConfigService } from '../llm/llm-model-config.service.js'
import type { LLMService } from '../llm/llm.service.js'
import type { PrismaService } from '../prisma/prisma.service.js'
import assert from 'node:assert/strict'
// 项目使用 Node 原生测试运行器，不为 Admin 查询引入额外测试框架。
// eslint-disable-next-line test/no-import-node-test
import { describe, it } from 'node:test'

import {
  AdminOverviewService,
  bucketStartOf,
  parseProviderBalance,
  resolveWindow,
} from './admin-overview.service.js'

describe('AdminOverviewService stats', () => {
  it('聚合数字卡、每日趋势（上海归日补零）、状态 / 模型 / 工具分布与缓存 / 时长', async () => {
    const now = new Date()
    const service = createService({
      windowRuns: [{ createdAt: now }, { createdAt: now }],
      samplingSteps: [
        {
          createdAt: now,
          status: 'COMPLETED',
          startedAt: new Date(now.getTime() - 1_000),
          endedAt: now,
          input: { initialContext: { resolvedModel: 'deepseek-v4-flash' } },
          output: {
            usage: { inputTokens: 100, outputTokens: 20, totalTokens: 120, promptCacheHitTokens: 80 },
          },
        },
        {
          createdAt: now,
          status: 'COMPLETED',
          startedAt: new Date(now.getTime() - 3_000),
          endedAt: now,
          input: { initialContext: { resolvedModel: 'deepseek-v4-flash' } },
          output: {
            // 没报缓存字段：不进入命中率分子分母。
            usage: { inputTokens: 50, outputTokens: 5, totalTokens: 55 },
          },
        },
        // 失败的采样：recorder 批量补的 endedAt 不是真实响应时间，Token 照算、时长不算。
        {
          createdAt: now,
          status: 'FAILED',
          startedAt: new Date(now.getTime() - 60_000),
          endedAt: now,
          input: { initialContext: { resolvedModel: 'deepseek-v4-flash' } },
          output: {
            usage: { inputTokens: 10, outputTokens: 1, totalTokens: 11 },
          },
        },
        // usage 缺失的 step 不计入 Token，但模型仍计入采样次数；没有时间也不计入时长。
        {
          createdAt: now,
          status: 'COMPLETED',
          startedAt: null,
          endedAt: null,
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

    const stats = await service.getStats('30d', now)

    assert.equal(stats.window, '30d')
    assert.equal(stats.bucket, 'day')
    assert.deepEqual(stats.totals, {
      conversationCount: 3,
      runCount: 7,
      messageCount: 14,
      inputTokens: 160,
      outputTokens: 26,
      cacheHitTokens: 80,
      cacheInputTokens: 100,
    })
    assert.equal(stats.points.length, 30)

    const today = stats.points.at(-1)!
    assert.deepEqual(today, {
      bucketStart: bucketStartOf('day', now),
      label: shanghaiDateKey(now).slice(5),
      runCount: 2,
      inputTokens: 160,
      outputTokens: 26,
    })
    // 其余日期补零。
    assert.equal(stats.points.slice(0, -1).every(point => point.runCount === 0), true)

    assert.deepEqual(stats.statusCounts, {
      RUNNING: 0,
      COMPLETED: 5,
      FAILED: 2,
      ABORTED: 0,
    })
    assert.deepEqual(stats.models, [
      { model: 'deepseek-v4-flash', samplingCount: 3, totalTokens: 186, cacheHitTokens: 80, cacheInputTokens: 100, avgDurationMs: 2_000 },
      { model: 'deepseek-r2', samplingCount: 1, totalTokens: 0, cacheHitTokens: null, cacheInputTokens: null, avgDurationMs: null },
    ])
    assert.deepEqual(stats.tools, [
      { tool: 'searchArticles', count: 2 },
      { tool: 'fetchPage', count: 1 },
    ])
  })

  it('没有任何采样报告缓存字段时，缓存汇总保持 null 不补零', async () => {
    const now = new Date()
    const service = createService({
      samplingSteps: [{
        createdAt: now,
        status: 'COMPLETED',
        startedAt: null,
        endedAt: null,
        input: { initialContext: { resolvedModel: 'deepseek-v4-flash' } },
        output: { usage: { inputTokens: 10, outputTokens: 2, totalTokens: 12 } },
      }],
    })

    const stats = await service.getStats('7d', now)

    assert.equal(stats.totals.cacheHitTokens, null)
    assert.equal(stats.totals.cacheInputTokens, null)
    assert.equal(stats.points.length, 7)
  })

  it('24h 窗口取精确最近 24 小时，按整点分成 25 个桶，零点桶标日期', async () => {
    const now = new Date('2026-09-22T06:30:00.000Z')
    const runAt = new Date('2026-09-22T05:10:00.000Z')
    const calls: Array<Record<string, unknown>> = []
    const service = createService({
      windowRuns: [{ createdAt: runAt }, { createdAt: now }],
      samplingSteps: [{
        createdAt: runAt,
        status: 'COMPLETED',
        startedAt: null,
        endedAt: null,
        input: { initialContext: { resolvedModel: 'deepseek-v4-flash' } },
        output: { usage: { inputTokens: 30, outputTokens: 3, totalTokens: 33 } },
      }],
      groupBySpy: args => calls.push(args),
    })

    const stats = await service.getStats('24h', now)

    assert.equal(stats.bucket, 'hour')
    assert.equal(stats.points.length, 25)
    // 数据下界是精确的 now − 24h，首桶只是半桶。
    assert.equal((calls[0]!.where as { createdAt: { gte: Date } }).createdAt.gte.toISOString(), '2026-09-21T06:30:00.000Z')
    assert.equal(stats.points[0]!.bucketStart, '2026-09-21T06:00:00.000Z')
    assert.equal(stats.points[0]!.label, '14:00')
    // 上海零点（UTC 16:00）的桶用日期标出分界。
    assert.equal(stats.points[10]!.bucketStart, '2026-09-21T16:00:00.000Z')
    assert.equal(stats.points[10]!.label, '09-22')
    assert.deepEqual(stats.points.at(-2), {
      bucketStart: '2026-09-22T05:00:00.000Z',
      label: '13:00',
      runCount: 1,
      inputTokens: 30,
      outputTokens: 3,
    })
    assert.equal(stats.points.at(-1)!.bucketStart, '2026-09-22T06:00:00.000Z')
    assert.equal(stats.points.at(-1)!.runCount, 1)
  })

  it('step 扫描与状态 groupBy 都带 createdAt gte 窗口下界，口径一致且不全表扫描', async () => {
    const calls: Array<Record<string, unknown>> = []
    const service = createService({
      stepFindManySpy: args => calls.push(args),
      groupBySpy: args => calls.push(args),
    })

    await service.getStats('30d')

    assert.equal(calls.length, 3)
    for (const args of calls) {
      const where = args.where as { createdAt?: { gte?: Date } }
      assert.ok(where.createdAt?.gte instanceof Date)
    }
  })
})

describe('resolveWindow', () => {
  it('24h 从精确 24 小时前开始、桶从其整点开始；日窗口从 N−1 天前的上海零点开始', () => {
    const now = new Date('2026-09-22T06:30:00.000Z')
    const hourly = resolveWindow('24h', now)
    assert.equal(hourly.windowStart.toISOString(), '2026-09-21T06:30:00.000Z')
    assert.equal(hourly.pointsStart.toISOString(), '2026-09-21T06:00:00.000Z')
    assert.equal(hourly.bucketCount, 25)
    // 上海 09-22 零点是 UTC 09-21T16:00；7 天窗口起点为上海 09-16 零点。
    const weekly = resolveWindow('7d', now)
    assert.equal(weekly.windowStart.toISOString(), '2026-09-15T16:00:00.000Z')
    assert.equal(weekly.bucketCount, 7)
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

interface SamplingStepFixture {
  createdAt: Date
  status: 'COMPLETED' | 'FAILED' | 'ABORTED'
  startedAt: Date | null
  endedAt: Date | null
  input: unknown
  output: unknown
}

function createService(options: {
  windowRuns?: Array<{ createdAt: Date }>
  samplingSteps?: SamplingStepFixture[]
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

  const llmModelConfig = {
    resolveBalanceProvider: async () => ({
      providerId: 'provider-deepseek',
      apiKey: 'test-key',
      baseUrl: 'https://api.deepseek.com/v1',
    }),
  } as unknown as LlmModelConfigService

  const llmService = {
    getProviderBalance: async () => null,
  } as unknown as LLMService

  return new AdminOverviewService(prisma, llmModelConfig, llmService)
}
