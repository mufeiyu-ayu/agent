import type {
  AdminLlmModel,
  AdminLlmProvider,
  AdminOverviewStats,
  AdminProviderBalance,
  LlmProviderFamily,
} from '@agent/contracts'

/** 统计窗口；24h / 7d 由后端按小时 / 按日聚合，接入前只有 30d 可选。 */
export type OverviewWindow = '24h' | '7d' | '30d'

export interface OverviewKpi {
  runCount: number
  completedRuns: number
  failedRuns: number
  abortedRuns: number
  /** 0–100；窗口内没有终态 Run 时为 null。 */
  successRate: number | null
  inputTokens: number
  outputTokens: number
  totalTokens: number
  avgTokensPerRun: number | null
  /** 0–100；后端提供缓存汇总前为 null。 */
  cacheHitRate: number | null
  toolCallCount: number
  conversationCount: number
  messageCount: number
}

export interface OverviewTrendPoint {
  label: string
  runCount: number
  inputTokens: number
  outputTokens: number
}

export interface OverviewModelRow {
  key: string
  wireName: string
  displayName: string
  family: LlmProviderFamily
  providerNote: string
  samplingCount: number
  totalTokens: number
  /** 占窗口内全部模型 Token 的比例，0–100。 */
  share: number
  /** 后端提供每模型汇总前为 null。 */
  avgDurationMs: number | null
  cacheHitRate: number | null
  lastProbeOk: boolean | null
  lastProbedAt: string | null
  visible: boolean
  isDefault: boolean
}

export interface OverviewToolRow {
  name: string
  count: number
  /** 0–100。 */
  share: number
  color: string
}

export const TOOL_COLORS = ['#10b981', '#3b82f6', '#f59e0b', '#ec4899', '#8b5cf6', '#14b8a6', '#ef4444'] as const

export function toOverviewKpi(stats: AdminOverviewStats, toolCallCount: number): OverviewKpi {
  const { COMPLETED, FAILED, ABORTED } = stats.statusCounts
  const settled = COMPLETED + FAILED + ABORTED
  const windowRunCount = stats.daily.reduce((total, point) => total + point.runCount, 0)
  const totalTokens = stats.totals.inputTokens + stats.totals.outputTokens

  return {
    runCount: windowRunCount,
    completedRuns: COMPLETED,
    failedRuns: FAILED,
    abortedRuns: ABORTED,
    successRate: settled === 0 ? null : (COMPLETED / settled) * 100,
    inputTokens: stats.totals.inputTokens,
    outputTokens: stats.totals.outputTokens,
    totalTokens,
    avgTokensPerRun: windowRunCount === 0 ? null : Math.round(totalTokens / windowRunCount),
    cacheHitRate: null,
    toolCallCount,
    conversationCount: stats.totals.conversationCount,
    messageCount: stats.totals.messageCount,
  }
}

export function toOverviewTrend(stats: AdminOverviewStats): OverviewTrendPoint[] {
  return stats.daily.map(point => ({
    label: point.date.slice(5),
    runCount: point.runCount,
    inputTokens: point.inputTokens,
    outputTokens: point.outputTokens,
  }))
}

/**
 * 统计只有 wire name；显示名、家族、探活状态从模型接入配置按 wireName 关联。
 * 同名模型跨 Provider（DeepSeek 直连 / 中转）时取第一条，用量本身就是按 wire name 汇总的。
 * 已接入但窗口内没用过的模型也列出来，用量为 0。
 */
export function toOverviewModelRows(
  stats: AdminOverviewStats,
  models: AdminLlmModel[],
  providers: AdminLlmProvider[],
): OverviewModelRow[] {
  const providerById = new Map(providers.map(provider => [provider.id, provider]))
  const modelByWireName = new Map<string, AdminLlmModel>()
  for (const model of models) {
    if (!modelByWireName.has(model.wireName))
      modelByWireName.set(model.wireName, model)
  }

  const usageByWireName = new Map(stats.models.map(item => [item.model, item]))
  const wireNames = [...new Set([...usageByWireName.keys(), ...modelByWireName.keys()])]
  const tokenTotal = stats.models.reduce((total, item) => total + item.totalTokens, 0)

  return wireNames
    .map((wireName): OverviewModelRow => {
      const usage = usageByWireName.get(wireName)
      const model = modelByWireName.get(wireName)
      const provider = model ? providerById.get(model.providerId) : undefined
      const totalTokens = usage?.totalTokens ?? 0

      return {
        key: wireName,
        wireName,
        displayName: model?.displayName ?? wireName,
        family: provider?.family ?? 'other',
        providerNote: provider?.note ?? '',
        samplingCount: usage?.samplingCount ?? 0,
        totalTokens,
        share: tokenTotal === 0 ? 0 : (totalTokens / tokenTotal) * 100,
        avgDurationMs: null,
        cacheHitRate: null,
        lastProbeOk: model?.lastProbeOk ?? null,
        lastProbedAt: model?.lastProbedAt ?? null,
        visible: model?.visible ?? false,
        isDefault: model?.isDefault ?? false,
      }
    })
    .sort((left, right) => right.totalTokens - left.totalTokens || right.samplingCount - left.samplingCount)
}

export function toOverviewToolRows(stats: AdminOverviewStats): OverviewToolRow[] {
  const total = stats.tools.reduce((sum, item) => sum + item.count, 0)

  return stats.tools.map((item, index) => ({
    name: item.tool,
    count: item.count,
    share: total === 0 ? 0 : (item.count / total) * 100,
    color: TOOL_COLORS[index % TOOL_COLORS.length]!,
  }))
}

export function toBalanceText(balance: AdminProviderBalance | undefined, unavailableText: string): string {
  if (!balance?.available || !balance.totalBalance)
    return unavailableText
  return `${balance.totalBalance} ${balance.currency ?? ''}`.trim()
}
