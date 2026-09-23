import type {
  AdminOverviewStats,
  AdminProviderBalance,
  AdminToolResultCode,
  AgentRunErrorCode,
  AgentRunStatus,
  LlmProviderFamily,
} from '@agent/contracts'
import type { RouteLocationRaw } from 'vue-router'

import { ADMIN_OVERVIEW_UNKNOWN_TOOL } from '@agent/contracts'

const SHANGHAI_OFFSET_MS = 8 * 3_600_000

/** 趋势图按状态堆叠的顺序：成功垫底，失败与中断叠在上面最显眼。 */
export const TREND_STATUSES: AgentRunStatus[] = ['COMPLETED', 'FAILED', 'ABORTED', 'RUNNING']

export interface OverviewFailureReasonRow {
  key: string
  /** null 是字段上线前的旧 Run，没有可筛选的类别。 */
  errorCode: AgentRunErrorCode | null
  count: number
  /** 占窗口内失败 / 中断 Run 的比例，0–1。 */
  share: number
}

export interface OverviewModelRow {
  key: string
  /** 采样快照里没有任何模型信息时为 null，显示「未记录」。 */
  displayName: string | null
  wireName: string | null
  /** 旧采样或模型行已删除时没有家族，logo 按 other 显示。 */
  family: LlmProviderFamily
  deleted: boolean
  callCount: number
  failureRate: number
  firstTokenP50Ms: number | null
  samplingDurationP50Ms: number | null
  totalTokens: number
  tokenShare: number
  cacheHitRate: number | null
}

export interface OverviewToolRow {
  name: string
  /** 模型编造、不在服务端工具清单里的名字合并出来的一行。 */
  unknown: boolean
  callCount: number
  failureRate: number
  failureCodes: Array<{ code: AdminToolResultCode | null, count: number }>
  avgDurationMs: number | null
}

export interface OverviewTrend {
  labels: string[]
  bucketStarts: string[]
  runsByStatus: Record<AgentRunStatus, number[]>
  totalTokens: number[]
  hasData: boolean
}

export function toFailureReasonRows(stats: AdminOverviewStats): OverviewFailureReasonRow[] {
  const total = stats.health.failureReasons.reduce((sum, reason) => sum + reason.count, 0)

  return stats.health.failureReasons.map(reason => ({
    key: reason.errorCode ?? 'unrecorded',
    errorCode: reason.errorCode,
    count: reason.count,
    share: total === 0 ? 0 : reason.count / total,
  }))
}

/**
 * 失败原因跳到运行列表：按类别筛选，日期取窗口首尾桶所在的上海日。
 * 运行列表按天筛选，7d / 30d 的窗口起点就是上海零点，与概览完全同一批 Run；
 * 24h 窗口起点不在零点，列表会多出起点当天更早的 Run。
 */
export function toFailureReasonRunsLocation(
  errorCode: AgentRunErrorCode,
  stats: AdminOverviewStats,
): RouteLocationRaw {
  const first = stats.points.at(0)?.bucketStart
  const last = stats.points.at(-1)?.bucketStart

  return {
    name: 'runs',
    query: {
      errorCode,
      ...(first && last ? { dateFrom: toShanghaiDate(first), dateTo: toShanghaiDate(last) } : {}),
    },
  }
}

export function toOverviewModelRows(stats: AdminOverviewStats): OverviewModelRow[] {
  return stats.models.map(item => ({
    // 旧采样没有 modelId，按 wire name 归行，三种 key 不会撞。
    key: item.model ? (item.model.modelId ?? `wire:${item.model.wireName}`) : 'unrecorded',
    displayName: item.model?.displayName ?? null,
    wireName: item.model?.wireName ?? null,
    family: item.model?.family ?? 'other',
    deleted: item.model?.deleted ?? false,
    callCount: item.callCount,
    failureRate: item.failureRate,
    firstTokenP50Ms: item.firstTokenP50Ms,
    samplingDurationP50Ms: item.samplingDurationP50Ms,
    totalTokens: item.totalTokens,
    tokenShare: item.tokenShare,
    cacheHitRate: item.cacheHitRate,
  }))
}

export function toOverviewToolRows(stats: AdminOverviewStats): OverviewToolRow[] {
  return stats.tools.map(item => ({
    name: item.tool,
    unknown: item.tool === ADMIN_OVERVIEW_UNKNOWN_TOOL,
    callCount: item.callCount,
    failureRate: item.failureRate,
    failureCodes: item.failureCodes,
    avgDurationMs: item.avgDurationMs,
  }))
}

export function toOverviewTrend(stats: AdminOverviewStats): OverviewTrend {
  const runsByStatus = Object.fromEntries(
    TREND_STATUSES.map(status => [status, stats.points.map(point => point.statusCounts[status])]),
  ) as Record<AgentRunStatus, number[]>

  return {
    labels: stats.points.map(point => point.label),
    bucketStarts: stats.points.map(point => point.bucketStart),
    runsByStatus,
    totalTokens: stats.points.map(point => point.totalTokens),
    hasData: stats.points.some(point => point.totalTokens > 0 || TREND_STATUSES.some(status => point.statusCounts[status] > 0)),
  }
}

export function toBalanceText(balance: AdminProviderBalance | undefined, unavailableText: string): string {
  if (!balance?.available || !balance.totalBalance)
    return unavailableText
  return `${balance.totalBalance} ${balance.currency ?? ''}`.trim()
}

/** ISO 时间所在的 Asia/Shanghai 日期（YYYY-MM-DD），运行列表的日期筛选按这个口径。 */
function toShanghaiDate(iso: string): string {
  return new Date(Date.parse(iso) + SHANGHAI_OFFSET_MS).toISOString().slice(0, 10)
}
