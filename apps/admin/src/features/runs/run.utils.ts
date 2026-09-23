import type { AgentRunErrorCode } from '@agent/contracts'
import type { LocationQuery } from 'vue-router'

import { AGENT_RUN_ERROR_CODES } from '@agent/contracts'

const dateTimeOptions: Intl.DateTimeFormatOptions = {
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
}

const shortDateTimeOptions: Intl.DateTimeFormatOptions = {
  timeZone: 'Asia/Shanghai',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
}

const timeOptions: Intl.DateTimeFormatOptions = {
  timeZone: 'Asia/Shanghai',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
}

export const knownTimelineTitleKeys = {
  assistant_output: 'timeline.titles.assistantOutput',
  grounded_finalization: 'timeline.titles.groundedFinalization',
  load_conversation_history: 'timeline.titles.loadConversationHistory',
  model_sampling: 'timeline.titles.modelSampling',
  tool_execution: 'timeline.titles.toolExecution',
} as const

export const knownTimelineInspectorKeys = {
  assistant_output: 'timeline.inspectors.assistantOutput',
  grounded_finalization: 'timeline.inspectors.groundedFinalization',
  load_conversation_history: 'timeline.inspectors.loadConversationHistory',
  model_sampling: 'timeline.inspectors.modelSampling',
  tool_execution: 'timeline.inspectors.toolExecution',
} as const

export function formatDuration(durationMs: number | null): string {
  if (durationMs === null)
    return '—'

  if (durationMs < 1_000)
    return `${durationMs}ms`

  const digits = durationMs < 10_000 ? 2 : 1
  return `${(durationMs / 1_000).toFixed(digits).replace(/\.0+$/, '')}s`
}

export function formatTokens(tokens: number | null, locale = 'en-US'): string {
  if (tokens === null)
    return '—'

  if (tokens >= 1_000_000)
    return `${formatCompact(tokens / 1_000_000)}M`

  if (tokens >= 1_000)
    return `${formatCompact(tokens / 1_000)}K`

  return tokens.toLocaleString(locale)
}

export function formatPercentage(value: number | null, locale = 'en-US'): string {
  return value === null
    ? '—'
    : new Intl.NumberFormat(locale, {
        style: 'percent',
        maximumFractionDigits: 1,
      }).format(value)
}

export function formatDateTime(value: string | null, locale = 'zh-CN'): string {
  return value ? new Intl.DateTimeFormat(locale, dateTimeOptions).format(new Date(value)) : '—'
}

export function formatShortDateTime(value: string, locale = 'zh-CN'): string {
  return new Intl.DateTimeFormat(locale, shortDateTimeOptions).format(new Date(value))
}

export function formatTime(value: string | null, locale = 'zh-CN'): string {
  return value ? new Intl.DateTimeFormat(locale, timeOptions).format(new Date(value)) : '—'
}

function formatCompact(value: number): string {
  return value.toFixed(value >= 10 ? 1 : 2).replace(/\.0+$|(?<=\.\d)0$/, '')
}

/** 概览「失败原因」跳到运行列表时带的筛选；只认合法的 errorCode 与 YYYY-MM-DD 日期。 */
export interface RunFailureDrilldown {
  errorCode: AgentRunErrorCode
  dateRange: [string, string] | undefined
}

export function readRunFailureDrilldown(query: LocationQuery): RunFailureDrilldown | null {
  const errorCode = query.errorCode
  if (typeof errorCode !== 'string' || !(AGENT_RUN_ERROR_CODES as readonly string[]).includes(errorCode))
    return null

  const { dateFrom, dateTo } = query

  return {
    errorCode: errorCode as AgentRunErrorCode,
    // 手改的 URL 可能带非法日期：日期不成立或先后颠倒时只按类别筛，避免列表请求在序列化时抛错。
    dateRange: isCalendarDate(dateFrom) && isCalendarDate(dateTo) && dateFrom <= dateTo
      ? [dateFrom, dateTo]
      : undefined,
  }
}

function isCalendarDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    return false

  // 月份 13、日期 32 这类值是 Invalid Date，toISOString 会抛错，先排除。
  const parsed = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}
