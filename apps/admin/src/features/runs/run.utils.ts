import type { RunFilters } from './run.model'

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
  load_conversation_history: 'timeline.titles.loadConversationHistory',
  model_sampling: 'timeline.titles.modelSampling',
  receive_user_message: 'timeline.titles.receiveUserMessage',
  tool_execution: 'timeline.titles.toolExecution',
} as const

export const knownTimelineInspectorKeys = {
  assistant_output: 'timeline.inspectors.assistantOutput',
  load_conversation_history: 'timeline.inspectors.loadConversationHistory',
  model_sampling: 'timeline.inspectors.modelSampling',
  receive_user_message: 'timeline.inspectors.receiveUserMessage',
  tool_execution: 'timeline.inspectors.toolExecution',
} as const

export const defaultRunFilters: RunFilters = {
  query: '',
  status: undefined,
  dateFrom: '',
  dateTo: '',
}

export function formatRequestedModel(model: string | null, fallback = 'Default request'): string {
  return model ?? fallback
}

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
