import type {
  AdminModelSamplingStep,
  AdminRunTimelineItem,
  AgentStepStatus,
} from '@agent/contracts'

export type TraceEventType = 'USER' | 'HISTORY' | 'MODEL' | 'TOOL' | 'OUTPUT' | 'GENERIC'
export type TraceLane = 'input' | 'model' | 'tools'

export interface TraceRecord {
  id: string
  item: AdminRunTimelineItem
  eventType: TraceEventType
  content: string
  messagePreview: string | null
  searchText: string
  requestId: string | null
  requestNumber: number | null
  unlinked: boolean
}

export interface TraceRequestGroup {
  id: string
  number: number
  samplingRecordId: string
  sampling: AdminModelSamplingStep
  toolRecordIds: string[]
  recordIds: string[]
  samplingAttemptId: string | null
}

export interface TraceOverviewSpan {
  recordId: string
  lane: TraceLane
  startedAtMs: number | null
  endAtMs: number | null
  durationMs: number | null
  marker: boolean
  status: AgentStepStatus
  hasError: boolean
}

export interface RunTraceProjection {
  records: TraceRecord[]
  requestGroups: TraceRequestGroup[]
  overviewSpans: TraceOverviewSpan[]
  timelineStartMs: number | null
  timelineEndMs: number | null
  defaultSelectionId: string | undefined
}
