import type { Prisma } from '../generated/prisma/client.js'
import type { LlmModelConfigService } from '../llm/llm-model-config.service.js'
import type { LLMService } from '../llm/llm.service.js'
import type { PrismaService } from '../prisma/prisma.service.js'
import type {
  CallBucketRow,
  ModelCallRow,
  RunBucketRow,
} from './admin-overview.service.js'
import assert from 'node:assert/strict'
// 项目使用 Node 原生测试运行器，不为 Admin 查询引入额外测试框架。
// eslint-disable-next-line test/no-import-node-test
import { describe, it } from 'node:test'

import {
  AdminOverviewService,
  buildOverviewStats,
  parseProviderBalance,
  resolveWindow,
} from './admin-overview.service.js'

const NOW = new Date('2026-09-22T06:30:00.000Z')
const HOUR_MS = 3_600_000
const DAY_MS = 86_400_000
const SHANGHAI_OFFSET_MS = 8 * HOUR_MS

describe('buildOverviewStats', () => {
  it('健康：状态按桶补零、成功率只算终态、失败原因把非法值并入未记录后按次数降序', () => {
    const resolved = resolveWindow('30d', NOW)
    const today = bucketStartOf('day', NOW)
    const stats = buildOverviewStats(emptyRows({
      resolved,
      runBuckets: [
        { bucketStart: today, status: 'COMPLETED', runCount: 6 },
        { bucketStart: today, status: 'FAILED', runCount: 2 },
        { bucketStart: today, status: 'RUNNING', runCount: 1 },
        { bucketStart: resolved.windowStart.toISOString(), status: 'ABORTED', runCount: 2 },
      ],
      failureReasons: [
        { errorCode: 'llm_auth', runCount: 1 },
        { errorCode: null, runCount: 1 },
        { errorCode: 'not_a_code', runCount: 1 },
        { errorCode: 'aborted', runCount: 1 },
      ],
    }))

    assert.equal(stats.health.runCount, 11)
    assert.deepEqual(stats.health.statusCounts, { RUNNING: 1, COMPLETED: 6, FAILED: 2, ABORTED: 2 })
    // RUNNING 不进分母：6 ÷ (6 + 2 + 2)。
    assert.equal(stats.health.successRate, 0.6)
    assert.deepEqual(stats.health.failureReasons, [
      { errorCode: null, count: 2 },
      { errorCode: 'llm_auth', count: 1 },
      { errorCode: 'aborted', count: 1 },
    ])
    assert.equal(stats.points.length, 30)
    assert.deepEqual(stats.points.at(-1)!.statusCounts, { RUNNING: 1, COMPLETED: 6, FAILED: 2, ABORTED: 0 })
    assert.deepEqual(stats.points[0]!.statusCounts, { RUNNING: 0, COMPLETED: 0, FAILED: 0, ABORTED: 2 })
    assert.equal(stats.points.slice(1, -1).every(point => Object.values(point.statusCounts).every(count => count === 0)), true)
  })

  it('没有终态 Run 时成功率与时长分位为 null', () => {
    const stats = buildOverviewStats(emptyRows({
      runBuckets: [{ bucketStart: bucketStartOf('day', NOW), status: 'RUNNING', runCount: 1 }],
    }))

    assert.equal(stats.health.successRate, null)
    assert.deepEqual(stats.latency, { runDurationP50Ms: null, runDurationP95Ms: null })
    assert.deepEqual(stats.usage, { totalTokens: 0, avgTokensPerRun: null, cacheHitRate: null, cacheCoverage: null })
  })

  it('用量：Token 按桶累加，均单只除有 Token 的 Run，命中率只算上报缓存的调用，覆盖率按全部输入', () => {
    const today = bucketStartOf('day', NOW)
    const yesterday = bucketStartOf('day', new Date(NOW.getTime() - 86_400_000))
    const callBuckets: CallBucketRow[] = [
      { bucketStart: today, totalTokens: 1_000, inputTokens: 800, cacheHitTokens: 300, cacheInputTokens: 600, runsWithTokens: 2 },
      // 这一天没有调用上报缓存字段：两项都是 null，不按 0 计入命中率。
      { bucketStart: yesterday, totalTokens: 500, inputTokens: 200, cacheHitTokens: null, cacheInputTokens: null, runsWithTokens: 1 },
    ]
    const stats = buildOverviewStats(emptyRows({
      callBuckets,
      latency: { p50Ms: 1_234.4, p95Ms: 9_876.6 },
    }))

    assert.equal(stats.usage.totalTokens, 1_500)
    assert.equal(stats.usage.avgTokensPerRun, 500)
    assert.equal(stats.usage.cacheHitRate, 300 / 600)
    assert.equal(stats.usage.cacheCoverage, 600 / 1_000)
    assert.deepEqual(stats.latency, { runDurationP50Ms: 1_234, runDurationP95Ms: 9_877 })
    assert.equal(stats.points.at(-1)!.totalTokens, 1_000)
    assert.equal(stats.points.at(-2)!.totalTokens, 500)
  })

  it('没有任何调用上报缓存字段：命中率 null，覆盖率 0', () => {
    const stats = buildOverviewStats(emptyRows({
      callBuckets: [{ bucketStart: bucketStartOf('day', NOW), totalTokens: 12, inputTokens: 10, cacheHitTokens: null, cacheInputTokens: null, runsWithTokens: 1 }],
    }))

    assert.equal(stats.usage.cacheHitRate, null)
    assert.equal(stats.usage.cacheCoverage, 0)
  })

  it('模型：Token 降序、占比与失败率、分位取整；Token 之和等于用量总量', () => {
    const modelRows: Array<ModelCallRow & { model: ReturnType<typeof modelRef> | null }> = [
      modelRow({ modelId: 'model-small', totalTokens: 250, callCount: 4, failedCount: 1, cacheHitTokens: null, cacheInputTokens: null }),
      modelRow({ modelId: 'model-big', totalTokens: 750, callCount: 2, failedCount: 0, firstTokenP50Ms: 401.6, samplingDurationP50Ms: 2_000.2, cacheHitTokens: 80, cacheInputTokens: 100 }),
    ]
    const stats = buildOverviewStats(emptyRows({
      callBuckets: [{ bucketStart: bucketStartOf('day', NOW), totalTokens: 1_000, inputTokens: 900, cacheHitTokens: 80, cacheInputTokens: 100, runsWithTokens: 3 }],
      modelRows,
    }))

    assert.deepEqual(stats.models.map(model => model.model?.modelId), ['model-big', 'model-small'])
    assert.deepEqual(stats.models[0], {
      model: modelRef('model-big'),
      callCount: 2,
      failureRate: 0,
      firstTokenP50Ms: 402,
      samplingDurationP50Ms: 2_000,
      totalTokens: 750,
      tokenShare: 0.75,
      cacheHitRate: 0.8,
    })
    assert.equal(stats.models[1]!.failureRate, 0.25)
    assert.equal(stats.models[1]!.cacheHitRate, null)
    assert.equal(stats.models.reduce((total, model) => total + model.totalTokens, 0), stats.usage.totalTokens)
  })

  it('快照里没有任何模型信息的调用照样计入，模型为 null', () => {
    const stats = buildOverviewStats(emptyRows({
      modelRows: [{ ...modelRow({ modelId: 'unused', totalTokens: 10 }), modelId: null, resolvedModel: null, model: null }],
    }))

    assert.equal(stats.models[0]!.model, null)
    assert.equal(stats.models[0]!.tokenShare, 1)
  })

  it('工具：按调用数降序，失败码按次数降序、非法码并入 null', () => {
    const stats = buildOverviewStats(emptyRows({
      toolRows: [
        { tool: 'unknown_tool', callCount: 2, failedCount: 2, avgDurationMs: 1.4 },
        { tool: 'search_articles', callCount: 5, failedCount: 4, avgDurationMs: null },
      ],
      toolFailureRows: [
        { tool: 'unknown_tool', code: 'unknown_tool', failedCount: 2 },
        { tool: 'search_articles', code: 'timeout', failedCount: 1 },
        { tool: 'search_articles', code: null, failedCount: 2 },
        { tool: 'search_articles', code: 'provider_secret', failedCount: 1 },
      ],
    }))

    assert.deepEqual(stats.tools, [
      {
        tool: 'search_articles',
        callCount: 5,
        failureRate: 0.8,
        failureCodes: [
          { code: null, count: 3 },
          { code: 'timeout', count: 1 },
        ],
        avgDurationMs: null,
      },
      {
        tool: 'unknown_tool',
        callCount: 2,
        failureRate: 1,
        failureCodes: [{ code: 'unknown_tool', count: 2 }],
        avgDurationMs: 1,
      },
    ])
  })
})

describe('AdminOverviewService stats', () => {
  it('SQL 只取需要的 JSON 路径、不读 debug 捕获，窗口下界与工具清单作为参数传入', async () => {
    const queries: Prisma.Sql[] = []
    const prisma = {
      async $queryRaw(query: Prisma.Sql) {
        queries.push(query)
        return []
      },
      llmModel: {
        async findMany() {
          return []
        },
      },
    } as unknown as PrismaService
    const service = new AdminOverviewService(prisma, {} as LlmModelConfigService, {} as LLMService)

    const stats = await service.getStats('24h', NOW)

    assert.equal(queries.length, 7)
    // SQL 输出的桶起点必须与预建桶的 toISOString 同格式，否则按字符串对不上、趋势全零。
    const bucketQueries = queries.filter(query => query.sql.includes('to_char('))
    assert.equal(bucketQueries.length, 2)
    for (const query of bucketQueries)
      assert.ok(query.sql.includes(`'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'`))
    for (const query of queries) {
      assert.doesNotMatch(query.sql, /debug/i)
      // 整列只能出现在 `->` 左边（取路径）或作为别名，不能被原样选出。
      assert.doesNotMatch(query.sql, /(?<!AS )"(input|output)"(?!\s*->)/)
      assert.ok(query.values.includes('2026-09-21T06:30:00.000Z'))
    }
    const toolQueries = queries.filter(query => query.values.includes('unknown_tool'))
    assert.equal(toolQueries.length, 2)
    for (const query of toolQueries) {
      assert.ok(query.values.includes('search_articles'))
      assert.ok(query.values.includes('retrieve_article_context'))
    }

    assert.equal(stats.bucket, 'hour')
    assert.equal(stats.points.length, 25)
    assert.deepEqual(stats.latency, { runDurationP50Ms: null, runDurationP95Ms: null })
  })
})

describe('resolveWindow', () => {
  it('24h 从精确 24 小时前开始、桶从其整点开始；日窗口从 N−1 天前的上海零点开始', () => {
    const hourly = resolveWindow('24h', NOW)
    assert.equal(hourly.windowStart.toISOString(), '2026-09-21T06:30:00.000Z')
    assert.equal(hourly.pointsStart.toISOString(), '2026-09-21T06:00:00.000Z')
    assert.equal(hourly.bucketCount, 25)
    // 上海 09-22 零点是 UTC 09-21T16:00；7 天窗口起点为上海 09-16 零点。
    const weekly = resolveWindow('7d', NOW)
    assert.equal(weekly.windowStart.toISOString(), '2026-09-15T16:00:00.000Z')
    assert.equal(weekly.bucketCount, 7)
  })

  it('小时桶首尾半桶，上海零点桶用日期标出分界', () => {
    const stats = buildOverviewStats(emptyRows({ resolved: resolveWindow('24h', NOW) }))

    assert.equal(stats.points[0]!.bucketStart, '2026-09-21T06:00:00.000Z')
    assert.equal(stats.points[0]!.label, '14:00')
    assert.equal(stats.points[10]!.bucketStart, '2026-09-21T16:00:00.000Z')
    assert.equal(stats.points[10]!.label, '09-22')
    assert.equal(stats.points.at(-1)!.bucketStart, bucketStartOf('hour', NOW))
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

type OverviewRows = Parameters<typeof buildOverviewStats>[0]

function emptyRows(overrides: Partial<OverviewRows> = {}): OverviewRows {
  return {
    window: '30d',
    resolved: resolveWindow('30d', NOW),
    runBuckets: [] as RunBucketRow[],
    failureReasons: [],
    latency: { p50Ms: null, p95Ms: null },
    callBuckets: [],
    modelRows: [],
    toolRows: [],
    toolFailureRows: [],
    ...overrides,
  }
}

/** 与 SQL 的 bucketStartSql 同一规则：整点按 UTC，日桶为上海零点。 */
function bucketStartOf(bucket: 'hour' | 'day', date: Date): string {
  if (bucket === 'hour')
    return new Date(Math.floor(date.getTime() / HOUR_MS) * HOUR_MS).toISOString()
  const dayStartShanghai = Math.floor((date.getTime() + SHANGHAI_OFFSET_MS) / DAY_MS) * DAY_MS
  return new Date(dayStartShanghai - SHANGHAI_OFFSET_MS).toISOString()
}

function modelRef(modelId: string) {
  return { modelId, displayName: modelId, wireName: modelId, family: 'deepseek' as const, deleted: false }
}

function modelRow(
  overrides: Partial<ModelCallRow> & { modelId: string },
): ModelCallRow & { model: ReturnType<typeof modelRef> | null } {
  return {
    resolvedModel: overrides.modelId,
    callCount: 1,
    failedCount: 0,
    firstTokenP50Ms: null,
    samplingDurationP50Ms: null,
    totalTokens: 0,
    cacheHitTokens: null,
    cacheInputTokens: null,
    ...overrides,
    model: modelRef(overrides.modelId),
  }
}
