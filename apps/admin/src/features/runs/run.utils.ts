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
  load_conversation_history: 'timeline.titles.loadConversationHistory',
  model_sampling: 'timeline.titles.modelSampling',
  tool_execution: 'timeline.titles.toolExecution',
} as const

export const knownTimelineInspectorKeys = {
  assistant_output: 'timeline.inspectors.assistantOutput',
  load_conversation_history: 'timeline.inspectors.loadConversationHistory',
  model_sampling: 'timeline.inspectors.modelSampling',
  tool_execution: 'timeline.inspectors.toolExecution',
} as const

/**
 * 把合法 JSON 文本按两格缩进排版，只改字符串之外的空白：数字、转义与键序原样保留
 * （parse 再 stringify 会把大数、1e999、\u 转义改写成别的样子，排障时看到的就不是模型发的了）。
 * 不是合法 JSON 时原样返回。
 */
export function formatJsonText(text: string): string {
  try {
    JSON.parse(text)
  }
  catch {
    return text
  }

  const indent = (depth: number) => `\n${'  '.repeat(depth)}`
  let formatted = ''
  let depth = 0
  let inString = false
  let escaped = false

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]!

    if (inString) {
      formatted += char
      if (escaped)
        escaped = false
      else if (char === '\\')
        escaped = true
      else if (char === '"')
        inString = false
      continue
    }

    switch (char) {
      case '"':
        inString = true
        formatted += char
        break
      case '{':
      case '[': {
        let next = index + 1

        while (next < text.length && /\s/.test(text[next]!))
          next += 1

        // 空容器保持 {} / []，不拆成两行。
        if (text[next] === (char === '{' ? '}' : ']')) {
          formatted += `${char}${text[next]}`
          index = next
          break
        }
        depth += 1
        formatted += `${char}${indent(depth)}`
        break
      }
      case '}':
      case ']':
        depth -= 1
        formatted += `${indent(depth)}${char}`
        break
      case ',':
        formatted += `,${indent(depth)}`
        break
      case ':':
        formatted += ': '
        break
      default:
        if (!/\s/.test(char))
          formatted += char
    }
  }

  return formatted
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
