import type { AgentRunStatus } from './agent-run.js'

export interface AdminOverviewTotals {
  conversationCount: number
  runCount: number
  messageCount: number
  /** 统计窗口内可证明的 Token 汇总；无任何采样数据时为 0。 */
  inputTokens: number
  outputTokens: number
}

/** 单日（Asia/Shanghai 归日）聚合点；date 为 YYYY-MM-DD。 */
export interface AdminOverviewDailyPoint {
  date: string
  runCount: number
  inputTokens: number
  outputTokens: number
}

export interface AdminOverviewModelUsageItem {
  model: string
  samplingCount: number
  totalTokens: number
}

export interface AdminOverviewToolUsageItem {
  tool: string
  count: number
}

export interface AdminOverviewStats {
  totals: AdminOverviewTotals
  /** 长度固定为 windowDays，缺数据的日期补零。 */
  daily: AdminOverviewDailyPoint[]
  statusCounts: Record<AgentRunStatus, number>
  models: AdminOverviewModelUsageItem[]
  tools: AdminOverviewToolUsageItem[]
  windowDays: number
}

/** Provider 余额投影；上游查询失败时 available=false 且金额为 null。 */
export interface AdminProviderBalance {
  available: boolean
  currency: string | null
  totalBalance: string | null
}
