import type {
  AgentRunStatus,
  AgentStepStatus,
} from './agent-run.js'
import type {
  MessageRole,
  MessageStatus,
} from './conversation.js'
import type {
  MessageCitationGranularity,
  MessageEvidenceAvailability,
  MessageGroundingOutcome,
} from './grounding.js'

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

/**
 * Retrieval Inspector 自身的审计数据完整度。
 *
 * 刻意与 `MessageEvidenceAvailability` 分层：前者回答「后台能不能可信地审计这次
 * Run」，后者回答「这次 Run 到底有没有可用证据」。zero-hit 与 Tool 故障只要审计
 * 事实完整，Inspector 仍然是 `available`。
 *
 * - `available`：审计事实完整且各层一致；
 * - `partial`：已有部分可信事实，但链路未完成、correlation 缺失或投影被截断；
 * - `unavailable`：本应可审计，但可信数据缺失或损坏；
 * - `not_applicable`：本次 Run 从未进入 evidence-eligible Retrieval / Grounding 链路。
 */
export type AdminRetrievalInspectorAvailability
  = | 'available'
    | 'partial'
    | 'unavailable'
    | 'not_applicable'

/** 检索策略标识；只保留可审计的名称与版本。 */
export interface AdminRetrievalStrategy {
  name: string
  version: string
}

/** Retrieval call 提交的安全来源身份；不含 excerpt、rank、distance 或正文。 */
export interface AdminRetrievalSourceRef {
  sourceId: number
  /** article 粒度证据为 null。 */
  chunkId: string | null
}

export interface AdminRetrievalCallSummary {
  stepId: string
  sequence: number
  status: AgentStepStatus
  callId: string | null
  toolName: string | null
  toolVersion: string | null
  samplingAttemptId: string | null
  /** 只有存在明确 typed bounded metadata 时才有值；不得从 raw arguments 反解析。 */
  query: string | null
  strategy: AdminRetrievalStrategy | null
  ok: boolean | null
  code: AdminToolResultCode | null
  /** Tool 声明的候选数量；没有可信 summary 时为 null。 */
  sourceCount: number | null
  /** 其中带 chunk evidence 的候选数量。 */
  chunkEvidenceCount: number | null
  /** summary 中可投影的来源身份数量；与 `refs.length` 不等时说明发生了截断。 */
  evidenceRefCount: number | null
  originalChars: number | null
  observationChars: number | null
  truncated: boolean | null
  recordedDurationMs: number | null
  durationMs: number | null
  refs: AdminRetrievalSourceRef[]
  refsTruncated: boolean
  /** call 的审计 summary 是否完整可信；false 时计数与 refs 不足以判定证据链。 */
  metadataTrusted: boolean
}

/** finalization 校验的三态结论；`unavailable` 表示 metadata 不可信。 */
export type AdminGroundedFinalizationValidation
  = | 'passed'
    | 'failed'
    | 'pending'
    | 'unavailable'

/** finalization 未能收口的安全大类；不携带 stack 或 Provider payload。 */
export type AdminGroundedFinalizationFailureReason
  = | 'validation_failed'
    | 'sampling_incomplete'
    | 'finalization_incomplete'

/** 模型终态输出被拒绝的安全类别。 */
export type AdminGroundedAnswerRejectionCode
  = | 'answer_empty'
    | 'answer_too_long'
    | 'arguments_too_large'
    | 'citation_key_invalid'
    | 'citation_keys_too_many'
    | 'citation_required_for_answered'
    | 'citations_not_allowed_without_evidence'
    | 'conflicting_requires_two_sources'
    | 'malformed_json'
    | 'outcome_not_allowed_for_availability'
    | 'schema_invalid'
    // 模型以纯文本正常 stop 结束、未调用提交工具（模型不服从）。
    | 'submission_missing'
    | 'unknown_citation_key'

/** 终态采样流未完整结束的安全类别；与「模型说错了」是两类问题。 */
export type AdminGroundedFinalizationSamplingFailure
  = | 'extra_event_after_completion'
    | 'missing_response_completed'
    | 'missing_submission'
    | 'multiple_submissions'
    | 'stream_failed'
    | 'unexpected_finish_reason'
    | 'unknown_tool_call'

export interface AdminGroundedFinalizationSummary {
  stepId: string
  sequence: number
  status: AgentStepStatus
  schemaVersion: number | null
  evidenceAvailability: MessageEvidenceAvailability | null
  outcome: MessageGroundingOutcome | null
  attemptCount: number | null
  /** finalization 独立于 action loop 的 attempt 预算。 */
  maxAttempts: number
  registryRefCount: number | null
  registryTruncated: boolean | null
  eligibleToolCallCount: number | null
  eligibleToolFailureCount: number | null
  validation: AdminGroundedFinalizationValidation
  failureReason: AdminGroundedFinalizationFailureReason | null
  rejectionCode: AdminGroundedAnswerRejectionCode | null
  samplingFailure: AdminGroundedFinalizationSamplingFailure | null
  citationCount: number | null
  citationIntegrity: 'validated' | null
  faithfulnessStatus: 'not_evaluated' | null
  /** 全部 attempt 的 Token 汇总；任一 attempt 不可信时整体为 null。 */
  usage: AdminRunTokenUsage | null
  /** 各 attempt 记录耗时之和；不完整时为 null。 */
  recordedDurationMs: number | null
  /** finalization Step 的实际墙钟耗时。 */
  durationMs: number | null
  metadataTrusted: boolean
}

/** 最终 Citation 能否关联回本 Run 的安全 evidence 身份。 */
export type AdminGroundedCitationCorrelation = 'matched' | 'unmatched'

export interface AdminGroundedCitationSummary {
  /** 展示序号，从 1 开始。 */
  sequence: number
  /** 服务端签发的公开 ID；与内部 citationKey 无关且不由它派生。 */
  citationId: string
  sourceId: number
  chunkId: string | null
  granularity: MessageCitationGranularity
  title: string
  sectionPath: string | null
  languageCode: string
  strategy: AdminRetrievalStrategy
  correlation: AdminGroundedCitationCorrelation
  /** 关联到的 evidence-eligible call 的 `callId`；unmatched 时为空数组。 */
  matchedCallIds: string[]
}

/**
 * Run 级 Retrieval / Grounding 审计投影。
 *
 * 只由服务端严格 projector 产生：前端不得解析 `inputSummary`、`outputSummary`
 * 或 `safeRawData` 重建这些事实。
 */
export interface AdminRetrievalInspector {
  availability: AdminRetrievalInspectorAvailability
  retrievalCalls: AdminRetrievalCallSummary[]
  callsTruncated: boolean
  /** 全部可信 call 声明的候选总数；存在不可信或无法分类的 Tool Step 时为 null。 */
  candidateCount: number | null
  /** 去重后的可投影 evidence 身份数量；存在不可信或无法分类的 Tool Step 时为 null。 */
  evidenceRefCount: number | null
  finalization: AdminGroundedFinalizationSummary | null
  /** 只有 COMPLETED 助手消息上的合法 Grounding 才会有值；损坏时为 null。 */
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

export interface AdminGroundedFinalizationStep extends AdminRunKnownTimelineItemBase {
  type: 'grounded_finalization'
  assistantMessageId: string | null
  evidenceAvailability: MessageEvidenceAvailability | null
  outcome: MessageGroundingOutcome | null
  attemptCount: number | null
  maxAttempts: number
  registryRefCount: number | null
  registryTruncated: boolean | null
  citationCount: number | null
  validation: AdminGroundedFinalizationValidation
  failureReason: AdminGroundedFinalizationFailureReason | null
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
    | AdminGroundedFinalizationStep
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
  retrievalInspector: AdminRetrievalInspector
  safeRawData: AdminRunSafeRawData
}
