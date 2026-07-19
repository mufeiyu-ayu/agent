import type {
  RunDetail,
  RunFilters,
  RunListItem,
  RunSafeRawData,
  RunSafeStepProjection,
  RunSummary,
  RunTimelineItem,
} from './run.model'

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
  model: undefined,
  dateFrom: '',
  dateTo: '',
}

export function computeRunSummary(runs: RunListItem[]): RunSummary {
  const finishedDurations = runs
    .map(run => run.durationMs)
    .filter((duration): duration is number => duration !== null)

  return {
    totalRuns: runs.length,
    successRate: runs.length === 0
      ? 0
      : roundToOneDecimal(
          runs.filter(run => run.status === 'COMPLETED').length / runs.length * 100,
        ),
    avgDurationMs: finishedDurations.length === 0
      ? 0
      : Math.round(
          finishedDurations.reduce((total, duration) => total + duration, 0)
          / finishedDurations.length,
        ),
    totalTokens: runs.reduce((total, run) => total + (run.totalTokens ?? 0), 0),
  }
}

export function filterRuns(runs: RunListItem[], filters: RunFilters): RunListItem[] {
  const query = filters.query.trim().toLocaleLowerCase()

  return runs.filter((run) => {
    if (
      query
      && !run.id.toLocaleLowerCase().includes(query)
      && !run.questionPreview.toLocaleLowerCase().includes(query)
    ) {
      return false
    }

    if (filters.status && run.status !== filters.status)
      return false

    if (filters.model && run.model !== filters.model)
      return false

    const createdDate = toShanghaiDateKey(run.createdAt)

    if (filters.dateFrom && createdDate < filters.dateFrom)
      return false

    return !(filters.dateTo && createdDate > filters.dateTo)
  })
}

export function paginateRuns(
  runs: RunListItem[],
  page: number,
  pageSize: number,
): RunListItem[] {
  const start = Math.max(0, page - 1) * pageSize
  return runs.slice(start, start + pageSize)
}

export function getDefaultTimelineItem(items: RunTimelineItem[]): RunTimelineItem | undefined {
  return items.find(item => item.type === 'model_sampling')
    ?? items.find(item => item.kind === 'durable_step')
    ?? items[0]
}

export function toRunListItem(detail: RunDetail): RunListItem {
  return {
    id: detail.id,
    questionPreview: detail.questionPreview,
    status: detail.status,
    model: detail.model,
    toolCallCount: detail.toolCallCount,
    samplingCount: detail.samplingCount,
    inputTokens: detail.inputTokens,
    outputTokens: detail.outputTokens,
    totalTokens: detail.totalTokens,
    durationMs: detail.durationMs,
    startedAt: detail.startedAt,
    endedAt: detail.endedAt,
    createdAt: detail.createdAt,
  }
}

export function createSafeRawData(
  run: Omit<RunDetail, 'safeRawData'>,
): RunSafeRawData {
  return {
    notice: 'Demo allowlist projection；不包含 provider raw payload、完整 prompt、完整工具参数、完整 Tool Result、Observation、stack、secret 或 chain-of-thought。',
    agentRun: {
      id: run.id,
      conversationId: run.conversationId,
      userMessageId: run.userMessageId,
      assistantMessageId: run.assistantMessageId,
      status: run.status,
      startedAt: run.startedAt,
      endedAt: run.endedAt,
      createdAt: run.createdAt,
      updatedAt: run.updatedAt,
    },
    agentSteps: run.timeline
      .filter((item): item is Exclude<RunTimelineItem, { kind: 'derived_lifecycle' }> => (
        item.kind === 'durable_step'
      ))
      .map(toSafeStepProjection),
  }
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

function toSafeStepProjection(
  item: Exclude<RunTimelineItem, { kind: 'derived_lifecycle' }>,
): RunSafeStepProjection {
  const summaries = getSafeSummaries(item)

  return {
    id: item.id,
    sequence: item.sequence,
    type: item.type,
    title: item.title,
    status: item.status,
    startedAt: item.startedAt,
    endedAt: item.endedAt,
    inputSummary: summaries.input,
    outputSummary: summaries.output,
    errorMessage: item.status === 'FAILED'
      ? '演示错误摘要（不含 stack 与 provider 原始响应）'
      : item.status === 'ABORTED'
        ? '用户中断运行'
        : null,
  }
}

function getSafeSummaries(
  item: Exclude<RunTimelineItem, { kind: 'derived_lifecycle' }>,
): { input: string | null, output: string | null } {
  switch (item.type) {
    case 'receive_user_message':
      return {
        input: `用户消息 ${item.messageId}，${item.contentLength} 字符`,
        output: '消息已关联到本次 Run',
      }
    case 'load_conversation_history':
      return {
        input: `historyLimit=${item.historyLimit}`,
        output: `${item.messageCount} 条消息，truncated=${item.truncated}`,
      }
    case 'model_sampling':
      return {
        input: item.inputSummary,
        output: item.outputSummary,
      }
    case 'tool_execution':
      return {
        input: item.inputSummary,
        output: item.outputSummary,
      }
    case 'assistant_output':
      return {
        input: `assistantMessageId=${item.assistantMessageId}`,
        output: item.contentLength === null
          ? '尚无终态 output payload；局部内容仅在 Messages 中可见'
          : `${item.contentLength} 字符的用户可见回答`,
      }
  }
}

function toShanghaiDateKey(value: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(value))
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]))

  return `${values.year}-${values.month}-${values.day}`
}

function roundToOneDecimal(value: number): number {
  return Math.round(value * 10) / 10
}

function formatCompact(value: number): string {
  return value.toFixed(value >= 10 ? 1 : 2).replace(/\.0+$|(?<=\.\d)0$/, '')
}
