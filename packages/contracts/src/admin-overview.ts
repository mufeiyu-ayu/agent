import type { AgentRunStatus } from './agent-run.js'

/** 统计窗口：24h 取精确的最近 24 小时按整点分桶（25 个桶，首尾半桶），7d / 30d 按 Asia/Shanghai 归日。 */
export const ADMIN_OVERVIEW_WINDOWS = ['24h', '7d', '30d'] as const

export type AdminOverviewWindow = typeof ADMIN_OVERVIEW_WINDOWS[number]

export type AdminOverviewBucket = 'hour' | 'day'

export interface AdminOverviewTotals {
  /** 三个计数是全量，不受窗口影响。 */
  conversationCount: number
  runCount: number
  messageCount: number
  /** 统计窗口内可证明的 Token 汇总；无任何采样数据时为 0。 */
  inputTokens: number
  outputTokens: number
  /**
   * 窗口内报告了缓存字段的采样：命中 Token 之和与同口径的输入 Token 之和，命中率 = hit / input。
   * 没有任何采样报告缓存字段时两者都为 null，不补零。
   */
  cacheHitTokens: number | null
  cacheInputTokens: number | null
}

/** 一个时间桶的聚合点；bucketStart 为 ISO 时间，label 按 Asia/Shanghai 给图表看（HH:00 或 MM-DD）。 */
export interface AdminOverviewPoint {
  bucketStart: string
  label: string
  runCount: number
  inputTokens: number
  outputTokens: number
}

export interface AdminOverviewModelUsageItem {
  model: string
  samplingCount: number
  totalTokens: number
  /** 与 totals 同口径的每模型缓存汇总。 */
  cacheHitTokens: number | null
  cacheInputTokens: number | null
  /** 有 startedAt / endedAt 的采样的平均时长；一个都没有时为 null。 */
  avgDurationMs: number | null
}

export interface AdminOverviewToolUsageItem {
  tool: string
  count: number
}

export interface AdminOverviewStats {
  window: AdminOverviewWindow
  bucket: AdminOverviewBucket
  totals: AdminOverviewTotals
  /** 长度固定为窗口桶数（25 / 7 / 30），缺数据的桶补零。 */
  points: AdminOverviewPoint[]
  statusCounts: Record<AgentRunStatus, number>
  models: AdminOverviewModelUsageItem[]
  tools: AdminOverviewToolUsageItem[]
}

/** Provider 余额投影；上游查询失败时 available=false 且金额为 null。 */
export interface AdminProviderBalance {
  available: boolean
  currency: string | null
  totalBalance: string | null
}
