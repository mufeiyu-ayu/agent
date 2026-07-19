export type RunStatus = 'RUNNING' | 'COMPLETED' | 'FAILED' | 'ABORTED'

export type RunStepStatus
  = | 'PENDING'
    | 'RUNNING'
    | 'COMPLETED'
    | 'FAILED'
    | 'ABORTED'

export type RunMessageStatus
  = | 'PENDING'
    | 'STREAMING'
    | 'COMPLETED'
    | 'FAILED'
    | 'ABORTED'

export interface RunListItem {
  id: string
  questionPreview: string
  status: RunStatus
  model: string
  toolCallCount: number
  samplingCount: number
  inputTokens: number | null
  outputTokens: number | null
  totalTokens: number | null
  durationMs: number | null
  startedAt: string
  endedAt: string | null
  createdAt: string
}

export interface RunSummary {
  totalRuns: number
  successRate: number
  avgDurationMs: number
  totalTokens: number
}

export interface RunMessageItem {
  id: string
  role: 'USER' | 'ASSISTANT'
  status: RunMessageStatus
  contentPreview: string
  createdAt: string
  updatedAt: string
}

interface RunTimelineItemBase {
  id: string
  title: string
  status: RunStepStatus
  startedAt: string
  endedAt: string | null
  durationMs: number | null
}

interface DurableRunTimelineItemBase extends RunTimelineItemBase {
  kind: 'durable_step'
  sequence: number
}

export interface DerivedRunLifecycleItem extends RunTimelineItemBase {
  kind: 'derived_lifecycle'
  type: 'run_lifecycle'
  sequence: null
  event: 'run_started' | 'run_completed' | 'run_failed' | 'run_aborted'
  summary: string
}

export interface ReceiveUserMessageItem extends DurableRunTimelineItemBase {
  kind: 'durable_step'
  type: 'receive_user_message'
  messageId: string
  contentPreview: string
  contentLength: number
  createdAt: string
}

export interface LoadConversationHistoryItem extends DurableRunTimelineItemBase {
  kind: 'durable_step'
  type: 'load_conversation_history'
  historyLimit: number
  messageCount: number
  truncated: boolean
}

export type RunFinishReason
  = | 'stop'
    | 'tool_calls'
    | 'length'
    | 'content_filter'
    | 'unknown'
    | null

export interface ModelSamplingItem extends DurableRunTimelineItemBase {
  kind: 'durable_step'
  type: 'model_sampling'
  samplingIndex: number
  samplingAttemptId: string
  requestedModel: string
  messageCount: number
  toolCount: number
  finishReason: RunFinishReason
  inputTokens: number | null
  outputTokens: number | null
  totalTokens: number | null
  textChars: number
  inputSummary: string
  outputSummary: string
}

export interface ToolExecutionItem extends DurableRunTimelineItemBase {
  kind: 'durable_step'
  type: 'tool_execution'
  callId: string
  toolName: string
  toolVersion: string | null
  samplingAttemptId: string
  executionAttempt: number
  validation: 'accepted' | 'rejected'
  ok: boolean | null
  code: string | null
  retryable: boolean | null
  rawArgumentsChars: number
  observationChars: number
  truncated: boolean
  inputSummary: string
  outputSummary: string
}

export interface AssistantOutputItem extends DurableRunTimelineItemBase {
  kind: 'durable_step'
  type: 'assistant_output'
  assistantMessageId: string
  contentLength: number | null
  contentPreview: string | null
  completedAt: string | null
}

export type RunTimelineItem
  = | DerivedRunLifecycleItem
    | ReceiveUserMessageItem
    | LoadConversationHistoryItem
    | ModelSamplingItem
    | ToolExecutionItem
    | AssistantOutputItem

export interface RunSafeStepProjection {
  id: string
  sequence: number
  type: Exclude<RunTimelineItem['type'], 'run_lifecycle'>
  title: string
  status: RunStepStatus
  startedAt: string
  endedAt: string | null
  inputSummary: string | null
  outputSummary: string | null
  errorMessage: string | null
}

export interface RunSafeRawData {
  notice: string
  agentRun: {
    id: string
    conversationId: string
    userMessageId: string
    assistantMessageId: string | null
    status: RunStatus
    startedAt: string
    endedAt: string | null
    createdAt: string
    updatedAt: string
  }
  agentSteps: RunSafeStepProjection[]
}

export interface RunDetail extends RunListItem {
  conversationId: string
  userMessageId: string
  assistantMessageId: string | null
  updatedAt: string
  timeline: RunTimelineItem[]
  messages: RunMessageItem[]
  safeRawData: RunSafeRawData
}

export interface RunFilters {
  query: string
  status: RunStatus | undefined
  model: string | undefined
  dateFrom: string
  dateTo: string
}
