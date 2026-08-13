import type {
  AgentRunStatus,
  AgentStepStatus,
} from './agent-run.js'
import type {
  MessageRole,
  MessageStatus,
} from './conversation.js'

export interface AdminRunListItem {
  id: string
  conversationId: string
  status: AgentRunStatus
  questionPreview: string
  requestedModel: string | null
  samplingCount: number
  toolCallCount: number
  inputTokens: number | null
  outputTokens: number | null
  totalTokens: number | null
  durationMs: number | null
  startedAt: string
  endedAt: string | null
  createdAt: string
}

export interface AdminRunPagination {
  page: number
  pageSize: number
  totalItems: number
  totalPages: number
}

export interface AdminRunSummary {
  totalRuns: number
  statusCounts: Record<AgentRunStatus, number>
}

export interface AdminRunListResponse {
  items: AdminRunListItem[]
  pagination: AdminRunPagination
  summary: AdminRunSummary
}

export interface AdminRunMessage {
  id: string
  role: MessageRole
  status: MessageStatus
  contentPreview: string
  createdAt: string
  updatedAt: string
}

export interface AdminRunTokenUsage {
  inputTokens: number | null
  outputTokens: number | null
  totalTokens: number | null
}

export type AdminModelFinishReason
  = | 'stop'
    | 'tool_calls'
    | 'length'
    | 'content_filter'
    | 'unknown'

export type AdminToolResultCode
  = | 'execution_failed'
    | 'invalid_arguments'
    | 'timeout'
    | 'unknown_tool'

export type AdminContextInspectorAvailability
  = | 'available'
    | 'partial'
    | 'unavailable'

export type AdminContextInspectorOutcome
  = | 'success'
    | 'minimum_context_overflow'
    | 'estimator_failure'
    | 'unavailable'

export type AdminInitialHistoryExcludedReason
  = | 'budget'
    | 'candidate_cap'

export interface AdminContextObservationSummary {
  exchangeIndex: number
  originalChars: number
  toolCeilingChars: number
  finalChars: number
  toolCeilingTruncated: boolean
  contextBudgetTruncated: boolean
}

export interface AdminContextInspector {
  availability: AdminContextInspectorAvailability
  outcome: AdminContextInspectorOutcome
  resolvedModel: string | null
  requestedModel: string | null
  estimatorStrategyId: string | null
  contextWindowTokens: number | null
  applicationInputCapTokens: number | null
  outputReserveTokens: number | null
  safetyMarginTokens: number | null
  resolvedInputBudgetTokens: number | null
  estimatedInputTokens: number | null
  budgetUsageRatio: number | null
  prePlanItemCount: number | null
  providerItemCount: number | null
  historyCandidateCount: number | null
  historyIncludedCount: number | null
  historyExcludedCount: number | null
  initialHistoryExcludedReason: AdminInitialHistoryExcludedReason | null
  samplingHistoryExcludedCount: number | null
  toolExchangeCount: number | null
  observations: AdminContextObservationSummary[] | null
}

interface AdminRunTimelineItemBase {
  id: string
  sequence: number
  type: string
  title: string
  status: AgentStepStatus
  startedAt: string | null
  endedAt: string | null
  durationMs: number | null
  inputSummary: string | null
  outputSummary: string | null
  hasError: boolean
}

interface AdminRunKnownTimelineItemBase extends AdminRunTimelineItemBase {
  kind: 'known'
}

export interface AdminReceiveUserMessageStep extends AdminRunKnownTimelineItemBase {
  type: 'receive_user_message'
  messageId: string | null
  messageLength: number | null
}

export interface AdminLoadConversationHistoryStep extends AdminRunKnownTimelineItemBase {
  type: 'load_conversation_history'
  historyLimit: number | null
  messageCount: number | null
}

export interface AdminModelSamplingStep extends AdminRunKnownTimelineItemBase {
  type: 'model_sampling'
  samplingIndex: number | null
  samplingAttemptId: string | null
  requestedModel: string | null
  /** 最终 Provider-facing ModelInputItem 数量；Plan 失败为 0，未记录为 null。 */
  providerItemCount: number | null
  toolCount: number | null
  finishReason: AdminModelFinishReason | null
  usage: AdminRunTokenUsage | null
  toolCallCount: number | null
  textChars: number | null
  intermediateTextChars: number | null
  recordedDurationMs: number | null
  contextInspector: AdminContextInspector
}

export interface AdminToolExecutionStep extends AdminRunKnownTimelineItemBase {
  type: 'tool_execution'
  callId: string | null
  toolName: string | null
  toolVersion: string | null
  samplingAttemptId: string | null
  executionAttempt: number | null
  rawArgumentsChars: number | null
  ok: boolean | null
  code: AdminToolResultCode | null
  retryable: boolean | null
  originalChars: number | null
  observationChars: number | null
  truncated: boolean | null
  recordedDurationMs: number | null
}

export interface AdminAssistantOutputStep extends AdminRunKnownTimelineItemBase {
  type: 'assistant_output'
  assistantMessageId: string | null
  contentLength: number | null
}

export interface AdminGenericStep extends AdminRunTimelineItemBase {
  kind: 'generic'
}

export type AdminRunTimelineItem
  = | AdminReceiveUserMessageStep
    | AdminLoadConversationHistoryStep
    | AdminModelSamplingStep
    | AdminToolExecutionStep
    | AdminAssistantOutputStep
    | AdminGenericStep

export interface AdminRunSafeStepProjection {
  id: string
  sequence: number
  type: string
  title: string
  status: AgentStepStatus
  startedAt: string | null
  endedAt: string | null
  inputSummary: string | null
  outputSummary: string | null
  hasError: boolean
}

export interface AdminRunSafeRawData {
  agentRun: {
    id: string
    conversationId: string
    userMessageId: string
    assistantMessageId: string | null
    status: AgentRunStatus
    startedAt: string
    endedAt: string | null
    createdAt: string
    updatedAt: string
  }
  agentSteps: AdminRunSafeStepProjection[]
}

export interface AdminRunDetail extends AdminRunListItem {
  userMessageId: string
  assistantMessageId: string | null
  updatedAt: string
  messages: AdminRunMessage[]
  timeline: AdminRunTimelineItem[]
  safeRawData: AdminRunSafeRawData
}
