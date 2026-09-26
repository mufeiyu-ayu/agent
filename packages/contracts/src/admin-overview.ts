import type { AdminModelRef, AdminToolResultCode } from './admin-run.js'
import type { AgentRunErrorCode, AgentRunStatus } from './agent-run.js'

/** 统计窗口：24h 取精确的最近 24 小时按整点分桶（25 个桶，首尾半桶），7d / 30d 按 Asia/Shanghai 归日。 */
export const ADMIN_OVERVIEW_WINDOWS = ['24h', '7d', '30d'] as const

export type AdminOverviewWindow = typeof ADMIN_OVERVIEW_WINDOWS[number]

export type AdminOverviewBucket = 'hour' | 'day'

/** 不在当前服务端工具清单里的工具名（模型编造，或工具已下线 / 改名）合并成这一行。 */
export const ADMIN_OVERVIEW_UNKNOWN_TOOL = 'unknown_tool'

/**
 * 全部统计都以「窗口内创建的 Run」为单位：Run 按 createdAt 进窗口，它的 Step 跟着 Run 走，
 * 所以概览与运行列表按同一日期范围筛出来的是同一批 Run。
 */
export interface AdminOverviewHealth {
  runCount: number
  statusCounts: Record<AgentRunStatus, number>
  /** COMPLETED ÷ 已终态 Run，0–1；没有终态 Run 时为 null。 */
  successRate: number | null
  /** FAILED / ABORTED Run 按 errorCode 计数，次数降序；errorCode 为 null 是字段上线前的旧 Run（未记录）。 */
  failureReasons: AdminOverviewFailureReason[]
}

export interface AdminOverviewFailureReason {
  errorCode: AgentRunErrorCode | null
  count: number
}

export interface AdminOverviewLatency {
  /** 已终态 Run 的 endedAt − startedAt 分位（毫秒）；没有终态 Run 时为 null。 */
  runDurationP50Ms: number | null
  runDurationP95Ms: number | null
}

/**
 * 模型调用 = 有 usage 或以 llm_* 类别失败的 action sampling Step；
 * 估算失败、上下文溢出、请求前取消的采样从未发出请求，不算调用。
 */
export interface AdminOverviewUsage {
  /** 全部模型调用的 totalTokens 之和。 */
  totalTokens: number
  /** totalTokens ÷ 有 Token 的 Run 数；没有时为 null。 */
  avgTokensPerRun: number | null
  /** 上报了缓存字段的调用：命中 Token ÷ 它们的输入 Token，0–1；没有任何调用上报时为 null。 */
  cacheHitRate: number | null
  /** 上报了缓存字段的调用的输入 Token ÷ 全部输入 Token，0–1；没有输入 Token 时为 null。 */
  cacheCoverage: number | null
}

/** 一个时间桶；bucketStart 为 ISO 时间，label 按 Asia/Shanghai 给图表看（HH:00 或 MM-DD）。 */
export interface AdminOverviewPoint {
  bucketStart: string
  label: string
  statusCounts: Record<AgentRunStatus, number>
  totalTokens: number
}

export interface AdminOverviewModelItem {
  /** 采样快照里既没有 modelId 也没有 wire name 时为 null（未记录）。 */
  model: AdminModelRef | null
  callCount: number
  /** 以 llm_* 类别失败的调用 ÷ callCount，0–1。 */
  failureRate: number
  /** action sampling 的首 token 时间 p50（毫秒）；没有记录时为 null。 */
  firstTokenP50Ms: number | null
  /** 成功的 action sampling 的 endedAt − startedAt p50（毫秒）；没有时为 null。 */
  samplingDurationP50Ms: number | null
  totalTokens: number
  /** totalTokens ÷ 全部模型 totalTokens，0–1；总量为 0 时为 0。 */
  tokenShare: number
  /** 与 usage.cacheHitRate 同口径。 */
  cacheHitRate: number | null
}

export interface AdminOverviewToolItem {
  /** 服务端工具清单里的名字，或 ADMIN_OVERVIEW_UNKNOWN_TOOL。 */
  tool: string
  callCount: number
  /** FAILED Step ÷ callCount，0–1。 */
  failureRate: number
  /** 失败按 output.code 计数，次数降序；执行中抛错没有 code，记为 null。 */
  failureCodes: Array<{ code: AdminToolResultCode | null, count: number }>
  /** 已结束（COMPLETED / FAILED）Step 的平均耗时；没有时为 null。 */
  avgDurationMs: number | null
}

export interface AdminOverviewStats {
  window: AdminOverviewWindow
  bucket: AdminOverviewBucket
  health: AdminOverviewHealth
  latency: AdminOverviewLatency
  usage: AdminOverviewUsage
  /** 长度固定为窗口桶数（25 / 7 / 30），缺数据的桶补零。 */
  points: AdminOverviewPoint[]
  /** totalTokens 降序。 */
  models: AdminOverviewModelItem[]
  /** callCount 降序。 */
  tools: AdminOverviewToolItem[]
}

/** Provider 余额投影；上游查询失败时 available=false 且金额为 null。 */
export interface AdminProviderBalance {
  available: boolean
  currency: string | null
  totalBalance: string | null
}
