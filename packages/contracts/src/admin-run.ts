import type { LlmProviderFamily } from './admin-llm.js'
import type {
  AgentRunErrorCode,
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

/**
 * 采样快照里的模型，服务端按 modelId 关联模型行得出显示名与家族。
 * 旧采样没有 modelId 时按 wire name 归行；模型行已删除时显示 wire name 并标 deleted。
 */
export interface AdminModelRef {
  /** 旧采样没有记录 modelId 时为 null。 */
  modelId: string | null
  displayName: string
  wireName: string
  /** 模型行所属服务商的家族；旧采样或模型行已删除时为 null。 */
  family: LlmProviderFamily | null
  /** 采样记录了 modelId，但该模型行已被删除。 */
  deleted: boolean
}

export interface AdminRunListItem {
  id: string
  conversationId: string
  status: AgentRunStatus
  /** 失败 / 中断类别；成功、仍在运行或字段上线前的旧 Run 为 null。 */
  errorCode: AgentRunErrorCode | null
  /**
   * 失败 / 中断 Run 在终态时与 Run 一起收口的 Step 的错误文案；更早失败、已回喂模型的工具 Step 不算。
   * 成功 / 运行中的 Run，以及在两个 Step 之间中断（没有 Step 随终态收口）时为 null。
   */
  failureMessage: string | null
  /** 本次 Run 采样使用的模型；没有任何采样记录时为 null。 */
  model: AdminModelRef | null
  questionPreview: string
  /**
   * 真实发出的模型调用次数，与概览同一口径：action sampling Step 与 finalization attempt 中，
   * 有 usage 或以 llm_* 类别失败的才算；估算失败、上下文溢出、请求前取消的不算。
   */
  samplingCount: number
  toolCallCount: number
  /** 上述模型调用中带 usage 的逐项求和；任一调用缺某项则该项为 null，没有带 usage 的调用时全为 null。 */
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

export interface AdminContextInspector {
  /** 无 contextPlan 且无 contextFailureReason 时为 null。 */
  outcome: AdminContextInspectorOutcome | null
  resolvedModel: string | null
  /** 本次 Run 快照的 Provider / 模型行 id；#142 之前的 Run 为 null。 */
  providerId: string | null
  modelId: string | null
  resolvedInputBudgetTokens: number | null
  estimatedInputTokens: number | null
  /** 本轮 planner 选入的历史条数（超预算时从最旧处删减后剩下的）；#149 之后、#152 之前的 Run 没记录，为 null。 */
  historyIncludedCount: number | null
  /** 本次 Run 读入的候选历史条数，取自 load_conversation_history Step（#119 之前的 Run 那里记的是选入条数）；读不出为 null。 */
  historyCandidateCount: number | null
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
  /** 取自工具参数的 `query`；参数未落库的旧 Run 或参数里没有 query 为 null。 */
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
  /** 候选历史条数（按预算裁剪前）；#119 之前的 Run 记的是选入条数。 */
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
  finishReason: AdminModelFinishReason | null
  usage: AdminRunTokenUsage | null
  toolCallCount: number | null
  /**
   * 从发出请求到收到第一个生成事件（正文、reasoning 或 Tool Call 开始）的毫秒数；空正文结束、一个都没收到或旧数据为 null。
   * 包含 SDK 在首个响应头之前的重试与退避。
   */
  firstTokenMs: number | null
  /** 本轮失败 / 中断时与 Run 相同的失败类别；成功或旧数据为 null。 */
  errorCode: AgentRunErrorCode | null
  /**
   * Tool Call 轮随 assistant 消息回填给模型的文本，含 Grounding 模式下没推给用户的那段；
   * 最终回答轮、本轮没有文本或旧数据为 null。
   */
  intermediateText: string | null
  /** Tool Call 轮回填给模型的 reasoning continuation（DeepSeek 家族）；没有或旧数据为 null。 */
  reasoningContent: string | null
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
  /**
   * 回喂给模型的参数 JSON 文本：通过校验时是模型原参数，未校验或被截断时是 `{"arguments": raw}`。
   * 旧数据或 Step 未收口（停止 / deadline）为 null。
   */
  arguments: string | null
  /** 回喂给模型的 observation 正文（已受工具字符上限约束）；属于不可信数据，只能按纯文本展示。旧数据或未收口为 null。 */
  observation: string | null
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
  /** finalization 提示词里的三个服务端标量；旧数据为 null。 */
  registryTruncated: boolean | null
  eligibleToolCallCount: number | null
  eligibleToolFailureCount: number | null
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
