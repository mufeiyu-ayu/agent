import type { AdminOverviewStats } from '@agent/contracts'
import assert from 'node:assert/strict'

import {
  toBalanceText,
  toFailureReasonRows,
  toFailureReasonRunsLocation,
  toOverviewModelRows,
  toOverviewToolRows,
  toOverviewTrend,
} from './overview.model'

const stats = createStats()

// 失败原因：占比按窗口内失败 / 中止 Run 算，未记录一行没有可筛选的类别。
assert.deepEqual(toFailureReasonRows(stats), [
  { key: 'llm_auth', errorCode: 'llm_auth', count: 3, share: 0.75 },
  { key: 'unrecorded', errorCode: null, count: 1, share: 0.25 },
])
assert.deepEqual(toFailureReasonRows({ ...stats, health: { ...stats.health, failureReasons: [] } }), [])

// 下钻：7d / 30d 的首尾桶是上海零点，日期就是窗口首尾两天。
assert.deepEqual(toFailureReasonRunsLocation('llm_auth', stats), {
  name: 'runs',
  query: { errorCode: 'llm_auth', dateFrom: '2026-09-21', dateTo: '2026-09-23' },
})
// 24h：首桶 UTC 06:00 是上海 14:00，仍按所在上海日。
assert.deepEqual(toFailureReasonRunsLocation('deadline', {
  ...stats,
  bucket: 'hour',
  points: [point('2026-09-21T06:00:00.000Z'), point('2026-09-22T06:00:00.000Z')],
}), {
  name: 'runs',
  query: { errorCode: 'deadline', dateFrom: '2026-09-21', dateTo: '2026-09-22' },
})

// 模型：旧采样没有 modelId 按 wire name 出 key；没有家族（旧采样 / 已删除）按 other 显示。
// 快照里没有任何模型信息：显示名为 null，由组件显示「未记录」。
assert.deepEqual(toOverviewModelRows(stats).map(row => [row.key, row.family, row.deleted, row.displayName]), [
  ['model-1', 'deepseek', false, 'DeepSeek V4 Flash'],
  ['model-gone', 'other', true, 'grok-4.6'],
  ['wire:legacy-model', 'other', false, 'legacy-model'],
  ['unrecorded', 'other', false, null],
])

// 工具：unknown_tool 一行单独标出。
assert.deepEqual(toOverviewToolRows(stats).map(row => [row.name, row.unknown, row.failureCodes.length]), [
  ['search_articles', false, 0],
  ['unknown_tool', true, 1],
])

// 趋势：按状态拆成堆叠序列，全零时 hasData 为 false。
const trend = toOverviewTrend(stats)
assert.deepEqual(trend.labels, ['09-21', '09-22', '09-23'])
assert.deepEqual(trend.runsByStatus.COMPLETED, [0, 2, 5])
assert.deepEqual(trend.runsByStatus.FAILED, [0, 1, 3])
assert.deepEqual(trend.totalTokens, [0, 1_200, 3_400])
assert.equal(trend.hasData, true)
assert.equal(toOverviewTrend({ ...stats, points: [point('2026-09-21T16:00:00.000Z')] }).hasData, false)

assert.equal(toBalanceText({ available: true, currency: 'CNY', totalBalance: '12.34' }, '不可用'), '12.34 CNY')
assert.equal(toBalanceText({ available: false, currency: null, totalBalance: null }, '不可用'), '不可用')
assert.equal(toBalanceText(undefined, '不可用'), '不可用')

console.log('overview model checks passed')

function point(bucketStart: string, overrides: Partial<AdminOverviewStats['points'][number]> = {}): AdminOverviewStats['points'][number] {
  return {
    bucketStart,
    label: bucketStart.slice(5, 10),
    statusCounts: { RUNNING: 0, COMPLETED: 0, FAILED: 0, ABORTED: 0 },
    totalTokens: 0,
    ...overrides,
  }
}

function createStats(): AdminOverviewStats {
  return {
    window: '7d',
    bucket: 'day',
    health: {
      runCount: 11,
      statusCounts: { RUNNING: 0, COMPLETED: 7, FAILED: 4, ABORTED: 0 },
      successRate: 7 / 11,
      failureReasons: [
        { errorCode: 'llm_auth', count: 3 },
        { errorCode: null, count: 1 },
      ],
    },
    latency: { runDurationP50Ms: 1_200, runDurationP95Ms: 9_000 },
    usage: { totalTokens: 4_600, avgTokensPerRun: 460, cacheHitRate: 0.5, cacheCoverage: 0.8 },
    points: [
      { ...point('2026-09-20T16:00:00.000Z'), label: '09-21' },
      { ...point('2026-09-21T16:00:00.000Z', { totalTokens: 1_200 }), label: '09-22', statusCounts: { RUNNING: 0, COMPLETED: 2, FAILED: 1, ABORTED: 0 } },
      { ...point('2026-09-22T16:00:00.000Z', { totalTokens: 3_400 }), label: '09-23', statusCounts: { RUNNING: 0, COMPLETED: 5, FAILED: 3, ABORTED: 0 } },
    ],
    models: [
      {
        model: { modelId: 'model-1', displayName: 'DeepSeek V4 Flash', wireName: 'deepseek-v4-flash', family: 'deepseek', deleted: false },
        callCount: 10,
        failureRate: 0.1,
        firstTokenP50Ms: 400,
        samplingDurationP50Ms: 2_000,
        totalTokens: 3_600,
        tokenShare: 3_600 / 4_600,
        cacheHitRate: 0.5,
      },
      {
        model: { modelId: 'model-gone', displayName: 'grok-4.6', wireName: 'grok-4.6', family: null, deleted: true },
        callCount: 2,
        failureRate: 1,
        firstTokenP50Ms: null,
        samplingDurationP50Ms: null,
        totalTokens: 1_000,
        tokenShare: 1_000 / 4_600,
        cacheHitRate: null,
      },
      {
        model: { modelId: null, displayName: 'legacy-model', wireName: 'legacy-model', family: null, deleted: false },
        callCount: 1,
        failureRate: 0,
        firstTokenP50Ms: null,
        samplingDurationP50Ms: null,
        totalTokens: 0,
        tokenShare: 0,
        cacheHitRate: null,
      },
      {
        model: null,
        callCount: 1,
        failureRate: 1,
        firstTokenP50Ms: null,
        samplingDurationP50Ms: null,
        totalTokens: 0,
        tokenShare: 0,
        cacheHitRate: null,
      },
    ],
    tools: [
      { tool: 'search_articles', callCount: 5, failureRate: 0, failureCodes: [], avgDurationMs: 600 },
      { tool: 'unknown_tool', callCount: 2, failureRate: 1, failureCodes: [{ code: 'unknown_tool', count: 2 }], avgDurationMs: 1 },
    ],
  }
}
