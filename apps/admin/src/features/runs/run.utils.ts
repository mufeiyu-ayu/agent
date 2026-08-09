import type { RunFilters, RunTimelineItem } from './run.model'

const dateTimeFormatter = new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
})

const shortDateTimeFormatter = new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'Asia/Shanghai',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})

const timeFormatter = new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'Asia/Shanghai',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
})

export const defaultRunFilters: RunFilters = {
  query: '',
  status: undefined,
  dateFrom: '',
  dateTo: '',
}

export function getDefaultTimelineItem(items: RunTimelineItem[]): RunTimelineItem | undefined {
  return items.find(item => item.kind === 'known' && item.type === 'model_sampling')
    ?? items[0]
}

export function getTimelineInspectorLabel(item: RunTimelineItem | undefined): string {
  if (!item || item.kind === 'generic')
    return 'Generic Inspector'

  return ({
    assistant_output: 'Assistant Output Inspector',
    load_conversation_history: 'Conversation History Inspector',
    model_sampling: 'Model Sampling Inspector',
    receive_user_message: 'User Message Inspector',
    tool_execution: 'Tool Execution Inspector',
  })[item.type]
}

export function formatRequestedModel(model: string | null): string {
  return model ?? 'Default request'
}

export function formatDuration(durationMs: number | null): string {
  if (durationMs === null)
    return '—'

  if (durationMs < 1_000)
    return `${durationMs}ms`

  const digits = durationMs < 10_000 ? 2 : 1
  return `${(durationMs / 1_000).toFixed(digits).replace(/\.0+$/, '')}s`
}

export function formatTokens(tokens: number | null): string {
  if (tokens === null)
    return '—'

  if (tokens >= 1_000_000)
    return `${formatCompact(tokens / 1_000_000)}M`

  if (tokens >= 1_000)
    return `${formatCompact(tokens / 1_000)}K`

  return tokens.toLocaleString('en-US')
}

export function formatDateTime(value: string | null): string {
  return value ? dateTimeFormatter.format(new Date(value)) : '—'
}

export function formatShortDateTime(value: string): string {
  return shortDateTimeFormatter.format(new Date(value))
}

export function formatTime(value: string | null): string {
  return value ? timeFormatter.format(new Date(value)) : '—'
}

function formatCompact(value: number): string {
  return value.toFixed(value >= 10 ? 1 : 2).replace(/\.0+$|(?<=\.\d)0$/, '')
}
