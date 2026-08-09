import type { AgentRunStatus } from '@agent/contracts'

export type {
  AdminRunDetail as RunDetail,
  AdminRunListItem as RunListItem,
  AdminRunMessage as RunMessageItem,
  MessageStatus as RunMessageStatus,
  AdminRunSafeRawData as RunSafeRawData,
  AdminRunSafeStepProjection as RunSafeStepProjection,
  AgentRunStatus as RunStatus,
  AgentStepStatus as RunStepStatus,
  AdminRunSummary as RunSummary,
  AdminRunTimelineItem as RunTimelineItem,
} from '@agent/contracts'

export interface RunFilters {
  query: string
  status: AgentRunStatus | undefined
  dateFrom: string
  dateTo: string
}
