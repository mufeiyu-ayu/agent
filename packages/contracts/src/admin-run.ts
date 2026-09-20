import type {
  AgentRunStatus,
  AgentStepStatus,
} from './agent-run.js'
import type {
  MessageRole,
  MessageStatus,
} from './conversation.js'
import type {
  MessageEvidenceAvailability,
  MessageGroundingOutcome,
} from './grounding.js'

export interface AdminRunTokenUsage {
  inputTokens: number | null
  outputTokens: number | null
  totalTokens: number | null
  reasoningTokens: number | null
  promptCacheHitTokens: number | null
  promptCacheMissTokens: number | null
}

export interface AdminRunListItem {
  id: string
  conversationId: string
  status: AgentRunStatus
  questionPreview: string
  samplingCount: number
  toolCallCount: number
  /** 全部模型调用（action sampling + finalization attempt）的逐项求和；任一调用缺某项则该项为 null。 */
  usage: AdminRunTokenUsage
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

export const ADMIN_MODEL_FINISH_REASONS = [
  'stop',
  'tool_calls',
  'length',
  'content_filter',
  'unknown',
] as const

export type AdminModelFinishReason = typeof ADMIN_MODEL_FINISH_REASONS[number]

export const ADMIN_TOOL_RESULT_CODES = [
  'execution_failed',
  'invalid_arguments',
  'timeout',
  // 模型输出达到长度限制、arguments 不完整，本次未执行。
  'truncated_arguments',
  'unknown_tool',
] as const

export type AdminToolResultCode = typeof ADMIN_TOOL_RESULT_CODES[number]

export type AdminContextInspectorOutcome
  = | 'success'
    | 'minimum_context_overflow'
    | 'estimator_failure'

/** 按 Tool Exchange 顺序逐条投影；单条里读不出的字段为 null，位置不丢。 */
export interface AdminContextObservationSummary {
  originalChars: number | null
  toolCeilingChars: number | null
  finalChars: number | null
}

export interface AdminContextInspector {
  /** 无 contextPlan 且无 contextFailureReason 时为 null。 */
  outcome: AdminContextInspectorOutcome | null
  resolvedModel: string | null
  /** 本次 Run 快照的 Provider / 模型行 id；#142 之前的 Run 为 null。 */
  providerId: string | null
  modelId: string | null
  resolvedInputBudgetTokens: number | null
  estimatedInputTokens: number | null
  historyCandidateCount: number | null
  historyIncludedCount: number | null
  /** `initialContext.historyIncludedCount − contextPlan.historyIncludedCount`；任一侧缺失为 null。 */
  samplingHistoryExcludedCount: number | null
  observations: AdminContextObservationSummary[] | null
}

/** 检索策略标识；只保留名称与版本。 */
export interface AdminRetrievalStrategy {
  name: string
  version: string
}

/** Retrieval call 提交的来源身份；不含 excerpt、rank、distance 或正文。 */
export interface AdminRetrievalSourceRef {
  sourceId: number
  /** article 粒度证据为 null。 */
  chunkId: string | null
}

/** evidence-eligible Tool Step 的检索摘要；工具身份与执行结果按 `stepId` 到 timeline 取。 */
export interface AdminRetrievalCallSummary {
  stepId: string
  query: string | null
  strategy: AdminRetrievalStrategy | null
  sourceCount: number | null
  chunkEvidenceCount: number | null
  refs: AdminRetrievalSourceRef[]
}

/** finalization 未能收口的安全大类；不携带 stack 或 Provider payload。 */
export const ADMIN_GROUNDED_FINALIZATION_FAILURE_REASONS = [
  'validation_failed',
  'sampling_incomplete',
  'finalization_incomplete',
] as const

export type AdminGroundedFinalizationFailureReason
  = typeof ADMIN_GROUNDED_FINALIZATION_FAILURE_REASONS[number]

/** 模型终态输出被拒绝的安全类别。 */
export const ADMIN_GROUNDED_ANSWER_REJECTION_CODES = [
  'answer_empty',
  'answer_too_long',
  'arguments_too_large',
  'citation_key_invalid',
  'citation_keys_too_many',
  'citation_required_for_answered',
  'citations_not_allowed_without_evidence',
  'conflicting_requires_two_sources',
  'malformed_json',
  'outcome_not_allowed_for_availability',
  'schema_invalid',
  // 模型以纯文本正常 stop 结束、未调用提交工具（模型不服从）。
  'submission_missing',
  'unknown_citation_key',
] as const

export type AdminGroundedAnswerRejectionCode
  = typeof ADMIN_GROUNDED_ANSWER_REJECTION_CODES[number]

/** 终态采样流未完整结束的安全类别；与「模型说错了」是两类问题。 */
export const ADMIN_GROUNDED_FINALIZATION_SAMPLING_FAILURES = [
  'missing_response_completed',
  'multiple_submissions',
  'stream_failed',
  'unexpected_finish_reason',
  'unknown_tool_call',
] as const

export type AdminGroundedFinalizationSamplingFailure
  = typeof ADMIN_GROUNDED_FINALIZATION_SAMPLING_FAILURES[number]

export interface AdminGroundedCitationSummary {
  /** 服务端签发的公开 ID；与内部 citationKey 无关且不由它派生。 */
  citationId: string
  sourceId: number
  chunkId: string | null
  title: string
  sectionPath: string | null
  languageCode: string
  strategy: AdminRetrievalStrategy
  /** refs 中出现相同 `sourceId:chunkId` 的 evidence-eligible call 的 `callId`。 */
  matchedCallIds: string[]
}

/** Run 级 Retrieval / Grounding 投影：只读取已持久化的 typed metadata，不解析正文。 */
export interface AdminRetrievalInspector {
  retrievalCalls: AdminRetrievalCallSummary[]
  /** 只有 COMPLETED 助手消息上的合法 Grounding 才会有值；缺失或损坏为 null。 */
  citations: AdminGroundedCitationSummary[] | null
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
  hasError: boolean
}

/** 已知 `type` 的 Step 共有字段；projector 先算好这一段，再按 `type` 补各自的字段。 */
export interface AdminRunKnownTimelineItemBase extends AdminRunTimelineItemBase {
  kind: 'known'
}

export interface AdminLoadConversationHistoryStep extends AdminRunKnownTimelineItemBase {
  type: 'load_conversation_history'
  messageCount: number | null
}

/**
 * debug 捕获的模型 I/O 原始 JSON 信封。
 *
 * 仅在 AGENT_DEBUG_CAPTURE_MODEL_IO 开启时产生；value 为 provider 原始 JSON，
 * 只用于观测展示，不参与任何业务逻辑。超过截断上限时只保留 preview 字符串。
 */
export type AdminDebugModelIOCapture
  = | { truncated: false, value: unknown }
    | { truncated: true, preview: string }

/** Response 专用信封：旧捕获由 projector 安全映射为 complete。 */
export type AdminDebugModelResponseCapture
  = | ({ state: 'complete' | 'partial' } & AdminDebugModelIOCapture)
    | { state: 'empty' }

export interface AdminModelSamplingStep extends AdminRunKnownTimelineItemBase {
  type: 'model_sampling'
  samplingIndex: number | null
  samplingAttemptId: string | null
  /** 最终 Provider-facing ModelInputItem 数量；Plan 失败为 0，未记录为 null。 */
  providerItemCount: number | null
  finishReason: AdminModelFinishReason | null
  usage: AdminRunTokenUsage | null
  toolCallCount: number | null
  contextInspector: AdminContextInspector
  /** debug 捕获：实际发给 provider 的请求体；未开启捕获或数据缺失为 null。 */
  debugRequestBody: AdminDebugModelIOCapture | null
  /** debug 捕获：完整、部分或空的 provider 响应事实；未捕获为 null。 */
  debugRawResponse: AdminDebugModelResponseCapture | null
}

export interface AdminToolExecutionStep extends AdminRunKnownTimelineItemBase {
  type: 'tool_execution'
  callId: string | null
  toolName: string | null
  samplingAttemptId: string | null
  ok: boolean | null
  code: AdminToolResultCode | null
  originalChars: number | null
  observationChars: number | null
  truncated: boolean | null
}

export interface AdminGroundedFinalizationStep extends AdminRunKnownTimelineItemBase {
  type: 'grounded_finalization'
  evidenceAvailability: MessageEvidenceAvailability | null
  outcome: MessageGroundingOutcome | null
  attemptCount: number | null
  registryRefCount: number | null
  failureReason: AdminGroundedFinalizationFailureReason | null
  rejectionCode: AdminGroundedAnswerRejectionCode | null
  samplingFailure: AdminGroundedFinalizationSamplingFailure | null
  /** 全部 attempt 的 Token 求和；attempts 缺失为 null，某项缺失则该项为 null。 */
  usage: AdminRunTokenUsage | null
}

export interface AdminAssistantOutputStep extends AdminRunKnownTimelineItemBase {
  type: 'assistant_output'
  assistantMessageId: string | null
}

/** 未知 `type` 的 Step（含旧库的 receive_user_message）。 */
export interface AdminGenericStep extends AdminRunTimelineItemBase {
  kind: 'generic'
}

export type AdminRunTimelineItem
  = | AdminLoadConversationHistoryStep
    | AdminModelSamplingStep
    | AdminToolExecutionStep
    | AdminGroundedFinalizationStep
    | AdminAssistantOutputStep
    | AdminGenericStep

export interface AdminRunDetail extends AdminRunListItem {
  assistantMessageId: string | null
  updatedAt: string
  messages: AdminRunMessage[]
  timeline: AdminRunTimelineItem[]
  retrievalInspector: AdminRetrievalInspector
}
