import type {
  AdminModelSamplingStep,
  AdminRunDetail,
  AdminRunMessage,
  AdminRunTimelineItem,
} from '@agent/contracts'

import type {
  RunTraceProjection,
  TraceEventType,
  TraceLane,
  TraceOverviewSpan,
  TraceRecord,
  TraceRequestGroup,
} from './run-trace.model'

export function createRunTraceProjection(run: AdminRunDetail): RunTraceProjection {
  const messagesById = new Map(run.messages.map(message => [message.id, message]))
  const records = [...run.timeline]
    .sort(compareTimelineItems)
    .map(item => createTraceRecord(item, messagesById))
  const samplingRecords = records.filter((record): record is TraceRecord & {
    item: AdminModelSamplingStep
  } => record.item.kind === 'known' && record.item.type === 'model_sampling')
  const requestGroups: TraceRequestGroup[] = samplingRecords.map((record, index) => ({
    id: `request:${record.id}`,
    number: index + 1,
    samplingRecordId: record.id,
    sampling: record.item,
    toolRecordIds: [],
    recordIds: [record.id],
    samplingAttemptId: record.item.samplingAttemptId,
  }))
  const groupsBySamplingRecordId = new Map(
    requestGroups.map(group => [group.samplingRecordId, group]),
  )
  const groupsByAttemptId = groupRequestsByAttemptId(requestGroups)

  for (const record of records) {
    if (record.item.kind === 'known' && record.item.type === 'model_sampling') {
      const group = groupsBySamplingRecordId.get(record.id)!
      record.requestId = group.id
      record.requestNumber = group.number
      continue
    }

    if (record.item.kind !== 'known' || record.item.type !== 'tool_execution')
      continue

    const attemptId = normalizeIdentifier(record.item.samplingAttemptId)
    const matchingGroups = attemptId ? groupsByAttemptId.get(attemptId) : undefined
    if (matchingGroups?.length !== 1) {
      record.unlinked = true
      continue
    }

    const group = matchingGroups[0]!
    record.requestId = group.id
    record.requestNumber = group.number
    group.toolRecordIds.push(record.id)
    group.recordIds.push(record.id)
  }

  const overviewSpans = records.flatMap((record) => {
    const lane = toTraceLane(record.item)
    return lane ? [createOverviewSpan(record, lane)] : []
  })
  const timelinePoints = [
    parseTimestamp(run.startedAt),
    parseTimestamp(run.endedAt),
    ...overviewSpans.flatMap(span => [span.startedAtMs, span.endAtMs]),
  ].filter((value): value is number => value !== null)

  return {
    records,
    requestGroups,
    overviewSpans,
    timelineStartMs: timelinePoints.length ? Math.min(...timelinePoints) : null,
    timelineEndMs: timelinePoints.length ? Math.max(...timelinePoints) : null,
    defaultSelectionId: samplingRecords[0]?.id ?? records[0]?.id,
  }
}

export function filterTraceRecords(
  records: readonly TraceRecord[],
  query: string,
): TraceRecord[] {
  const normalizedQuery = normalizeSearchText(query)
  return normalizedQuery
    ? records.filter(record => record.searchText.includes(normalizedQuery))
    : [...records]
}

export function getVisibleTraceRecords(
  projection: RunTraceProjection,
  query: string,
  collapsedRequestIds: ReadonlySet<string>,
): TraceRecord[] {
  const normalizedQuery = normalizeSearchText(query)
  if (normalizedQuery) {
    const matchedIds = new Set(
      filterTraceRecords(projection.records, normalizedQuery).map(record => record.id),
    )

    for (const group of projection.requestGroups) {
      if (group.recordIds.some(id => matchedIds.has(id)))
        matchedIds.add(group.samplingRecordId)
    }

    return projection.records.filter(record => matchedIds.has(record.id))
  }

  const groupsById = new Map(projection.requestGroups.map(group => [group.id, group]))
  return projection.records.filter((record) => {
    if (!record.requestId || !collapsedRequestIds.has(record.requestId))
      return true

    return groupsById.get(record.requestId)?.samplingRecordId === record.id
  })
}

export function resolveTraceSelection(
  projection: RunTraceProjection,
  visibleRecords: readonly TraceRecord[],
  selectedId: string | undefined,
): string | undefined {
  const visibleIds = new Set(visibleRecords.map(record => record.id))
  if (selectedId && visibleIds.has(selectedId))
    return selectedId

  const selectedGroup = projection.requestGroups.find(group => group.id === selectedId)
  if (selectedGroup && visibleIds.has(selectedGroup.samplingRecordId))
    return selectedGroup.samplingRecordId

  const selectedRecord = projection.records.find(record => record.id === selectedId)
  if (selectedRecord?.requestId) {
    const group = projection.requestGroups.find(
      candidate => candidate.id === selectedRecord.requestId,
    )
    if (group && visibleIds.has(group.samplingRecordId))
      return group.samplingRecordId
  }

  if (
    projection.defaultSelectionId
    && visibleIds.has(projection.defaultSelectionId)
  ) {
    return projection.defaultSelectionId
  }

  return visibleRecords[0]?.id
}

function createTraceRecord(
  item: AdminRunTimelineItem,
  messagesById: ReadonlyMap<string, AdminRunMessage>,
): TraceRecord {
  const eventType = toTraceEventType(item)
  const messagePreview = getMessagePreview(item, messagesById)
  const content = createRecordContent(item, messagePreview)

  return {
    id: item.id,
    item,
    eventType,
    content,
    messagePreview,
    searchText: createSearchText(item, eventType, messagePreview),
    requestId: null,
    requestNumber: null,
    unlinked: false,
  }
}

function toTraceEventType(item: AdminRunTimelineItem): TraceEventType {
  if (item.kind === 'generic')
    return 'GENERIC'

  return {
    receive_user_message: 'USER',
    load_conversation_history: 'HISTORY',
    model_sampling: 'MODEL',
    tool_execution: 'TOOL',
    assistant_output: 'OUTPUT',
  }[item.type] as TraceEventType
}

function getMessagePreview(
  item: AdminRunTimelineItem,
  messagesById: ReadonlyMap<string, AdminRunMessage>,
): string | null {
  if (item.kind === 'generic')
    return null

  if (item.type === 'receive_user_message') {
    const message = item.messageId ? messagesById.get(item.messageId) : undefined
    return message?.role === 'USER' ? message.contentPreview : null
  }

  if (item.type === 'assistant_output') {
    const message = item.assistantMessageId
      ? messagesById.get(item.assistantMessageId)
      : undefined
    return message?.role === 'ASSISTANT' ? message.contentPreview : null
  }

  return null
}

function createRecordContent(
  item: AdminRunTimelineItem,
  messagePreview: string | null,
): string {
  if (messagePreview)
    return messagePreview

  if (item.kind === 'generic')
    return joinContent(item.title, item.inputSummary, item.outputSummary)

  switch (item.type) {
    case 'receive_user_message':
      return joinContent(item.inputSummary, item.title)
    case 'load_conversation_history':
      return joinContent(item.outputSummary, item.inputSummary, item.title)
    case 'model_sampling':
      return joinContent(
        item.contextInspector.resolvedModel,
        item.requestedModel,
        item.finishReason,
        item.outputSummary,
        item.inputSummary,
        item.title,
      )
    case 'tool_execution':
      return joinContent(
        item.toolName,
        item.code,
        item.outputSummary,
        item.inputSummary,
        item.title,
      )
    case 'assistant_output':
      return joinContent(item.outputSummary, item.inputSummary, item.title)
  }
}

function createSearchText(
  item: AdminRunTimelineItem,
  eventType: TraceEventType,
  messagePreview: string | null,
): string {
  const values: Array<string | number | null> = [
    eventType,
    item.type,
    item.title,
    item.sequence,
    item.status,
    item.inputSummary,
    item.outputSummary,
    messagePreview,
  ]

  if (item.kind === 'known' && item.type === 'model_sampling') {
    values.push(
      item.requestedModel,
      item.contextInspector.requestedModel,
      item.contextInspector.resolvedModel,
    )
  }
  else if (item.kind === 'known' && item.type === 'tool_execution') {
    values.push(item.toolName)
  }

  return normalizeSearchText(values.filter(value => value !== null).join(' '))
}

function groupRequestsByAttemptId(
  groups: TraceRequestGroup[],
): Map<string, TraceRequestGroup[]> {
  const grouped = new Map<string, TraceRequestGroup[]>()

  for (const group of groups) {
    const attemptId = normalizeIdentifier(group.samplingAttemptId)
    if (!attemptId)
      continue

    const matches = grouped.get(attemptId) ?? []
    matches.push(group)
    grouped.set(attemptId, matches)
  }

  return grouped
}

function createOverviewSpan(
  record: TraceRecord,
  lane: TraceLane,
): TraceOverviewSpan {
  const startedAtMs = parseTimestamp(record.item.startedAt)
  const parsedEndAtMs = parseTimestamp(record.item.endedAt)
  const invalidRange = startedAtMs !== null
    && parsedEndAtMs !== null
    && parsedEndAtMs < startedAtMs
  const endAtMs = invalidRange ? null : parsedEndAtMs

  return {
    recordId: record.id,
    lane,
    startedAtMs: invalidRange ? null : startedAtMs,
    endAtMs,
    durationMs: record.item.durationMs,
    marker: !invalidRange
      && startedAtMs !== null
      && (
        endAtMs === null
        || endAtMs === startedAtMs
        || record.item.durationMs === 0
      ),
    status: record.item.status,
    hasError: record.item.hasError,
  }
}

function toTraceLane(item: AdminRunTimelineItem): TraceLane | null {
  if (item.kind === 'generic')
    return null

  switch (item.type) {
    case 'receive_user_message':
    case 'load_conversation_history':
      return 'input'
    case 'model_sampling':
      return 'model'
    case 'tool_execution':
      return 'tools'
    case 'assistant_output':
      return null
  }
}

function compareTimelineItems(
  left: AdminRunTimelineItem,
  right: AdminRunTimelineItem,
): number {
  return left.sequence - right.sequence || left.id.localeCompare(right.id)
}

function parseTimestamp(value: string | null): number | null {
  if (!value)
    return null

  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) ? timestamp : null
}

function normalizeIdentifier(value: string | null): string | null {
  const normalized = value?.trim()
  return normalized || null
}

function normalizeSearchText(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLowerCase()
}

function joinContent(...values: Array<string | null>): string {
  const parts = [...new Set(values.map(value => value?.trim()).filter(Boolean))]
  return parts.length ? parts.join(' · ') : '—'
}
