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
   * 服务商报超长、强制压缩又失败的 Run（#220）取最后一次以同一类别失败的采样。
   * 成功 / 运行中的 Run，以及在两个 Step 之间中断（没有 Step 随终态收口）时为 null。
   */
  failureMessage: string | null
  /** 本次 Run 采样使用的模型；没有任何采样记录时为 null。 */
  model: AdminModelRef | null
  questionPreview: string
  /**
   * 真实发出的模型调用次数，与概览同一口径：有 usage 或以 llm_* 类别失败的 action sampling Step
   * 才算；估算失败、上下文溢出、请求前取消的不算。
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

/**
 * 新 Run（#220 起）按采样的失败类别得出：服务商报输入超长为 llm_context_overflow，其余有 contextPlan 的为 success；
 * minimum_context_overflow 与 estimator_failure 只出现在旧 Run（按 overflowReason / contextFailureReason 读）。
 */
export type AdminContextInspectorOutcome
  = | 'success'
    | 'llm_context_overflow'
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
  /**
   * 本轮原文发出的历史 Message 条数：#220 起是未被历史压缩记录覆盖的部分，之前是 planner 按预算选入的条数；
   * #149 之后、#152 之前的 Run 没记录，为 null。
   */
  historyIncludedCount: number | null
  /**
   * #220 之前按预算选入历史的 Run 才有：「选入 X / 候选 Y」的候选条数，取自 load_conversation_history Step
   * （#119 之前的 Run 那里记的是选入条数）；#220 起与读不出都为 null。
   */
  historyCandidateCount: number | null
  /** 本轮基于的历史压缩记录（摘要在 AdminRunDetail.compactions）；没有或 #220 之前的 Run 为 null。 */
  compactionId: string | null
  /** 本轮基于的本轮压缩 Step（前缀摘要在那条 context_compaction Step 上）；没有或 #220 之前的 Run 为 null。 */
  turnCompactionStepId: string | null
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
  /** 读到的历史条数（含被压缩记录覆盖的）；#119 之前的 Run 记的是选入条数。 */
  messageCount: number | null
}

/**
 * debug 捕获的模型 I/O 原始 JSON 信封。
 *
 * 仅在管理台「运行配置」打开「抓取模型原始请求」时产生；value 为 provider 原始 JSON，
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
  /** Tool Call 轮随 assistant 消息回填给模型的文本；最终回答轮、本轮没有文本或旧数据为 null。 */
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

export interface AdminAssistantOutputStep extends AdminRunKnownTimelineItemBase {
  type: 'assistant_output'
  assistantMessageId: string | null
}

/** 上下文压缩（#220）：调模型前超触发线或服务商报超长时，在 Run 内把内容写成摘要的一次尝试。 */
export interface AdminContextCompactionStep extends AdminRunKnownTimelineItemBase {
  type: 'context_compaction'
  /** 哪一层（Step 的 input.kind）：history 把较早的问答写成历史摘要，turn 把本 Run 前面的工具轮写成前缀摘要。读不出为 null。 */
  layer: 'history' | 'turn' | null
  /** 触发这次压缩的估算输入 Token。 */
  tokensBefore: number | null
  /** 这次摘要调用的用量；失败前没收到用量为 null。 */
  usage: AdminRunTokenUsage | null
  /** 失败原因（runtime 写的安全文案）；成功为 null。 */
  errorMessage: string | null
  /** 历史压缩写成的记录，摘要在 AdminRunDetail.compactions；失败或本轮压缩为 null。 */
  compactionId: string | null
  /** 本轮压缩：从这一轮采样起保留原文。 */
  keptFromSamplingAttemptId: string | null
  /** 本轮压缩的前缀摘要；失败或历史压缩为 null。 */
  summary: string | null
}

/** 未知 `type` 的 Step（含旧库里已下线的 Step 类型，如 receive_user_message）。 */
export interface AdminGenericStep extends AdminRunTimelineItemBase {
  kind: 'generic'
}

export type AdminRunTimelineItem
  = | AdminLoadConversationHistoryStep
    | AdminModelSamplingStep
    | AdminToolExecutionStep
    | AdminAssistantOutputStep
    | AdminContextCompactionStep
    | AdminGenericStep

/** 历史压缩记录（#220）：较早的问答写成的摘要，每条自成完整。 */
export interface AdminConversationCompaction {
  id: string
  /** 写它的 Run；Run 已删除为 null。 */
  runId: string | null
  /** threshold：调模型前超触发线；overflow：服务商报超长；after_run：问答结束后在后台预压。读不出为 null。 */
  reason: 'threshold' | 'overflow' | 'after_run' | null
  summary: string
  /** 累计被摘要覆盖的问答组数。 */
  coveredGroupCount: number
  tokensBefore: number
  usage: AdminRunTokenUsage | null
  createdAt: string
}

export interface AdminRunDetail extends AdminRunListItem {
  assistantMessageId: string | null
  updatedAt: string
  messages: AdminRunMessage[]
  timeline: AdminRunTimelineItem[]
  /** 本 Run 写的（Run 内与问答结束后的后台预压）与本 Run 各次采样基于的历史压缩记录，按写入先后。 */
  compactions: AdminConversationCompaction[]
}
