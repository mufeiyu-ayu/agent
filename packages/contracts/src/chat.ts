import type { ReasoningEffort } from './admin-llm.js'
import type { MessageGroundingV1 } from './grounding.js'

/** 前后端共同执行的单次 Chat 用户消息字符上限。 */
export const CHAT_MESSAGE_MAX_CHARS = 64_000

export interface ChatRequest {
  conversationId: string
  message: string
  /** Admin 配置的模型行 id（`ChatModelOption.id`）；省略时用默认模型。 */
  model?: string
  /** 按次覆盖模型行的默认 reasoning_effort；只能取该模型家族的值（`ChatModelOption.reasoningEffortOptions`）。 */
  reasoningEffort?: ReasoningEffort
}

/** 前台模型下拉的一项：只有 Admin 勾选「前台可见」的模型行才会出现。 */
export interface ChatModelOption {
  id: string
  displayName: string
  /** 模型行的默认 reasoning_effort；null 表示不发。 */
  reasoningEffort: ReasoningEffort | null
  /** 该模型家族可选的 reasoning_effort；为空时前台不展示思考强度选择器。 */
  reasoningEffortOptions: readonly ReasoningEffort[]
  /** Admin 设的默认模型，前台初始选中它。 */
  isDefault: boolean
}

/**
 * Chat streaming 统一采用 NDJSON 协议：
 * 后端每行输出一个 JSON 序列化后的 `ChatStreamEvent`，前端通过 fetch + ReadableStream 按行解析。
 */
export type ChatStreamEvent
  = | ChatStreamStartEvent
    | ChatStreamDeltaEvent
    | ChatStreamDoneEvent
    | ChatStreamErrorEvent
    | ChatStreamAbortedEvent

export interface ChatStreamStartEvent {
  type: 'start'
  conversationId: string
  userMessageId: string
  assistantMessageId: string
}

export interface ChatStreamDeltaEvent {
  type: 'delta'
  conversationId: string
  assistantMessageId: string
  contentDelta: string
}

export interface ChatStreamDoneEvent {
  type: 'done'
  conversationId: string
  assistantMessageId: string
  content: string
  generatedAt: string
  /**
   * Evidence-backed 回答的引用事实；普通回答不携带该字段。
   *
   * 与 Messages API 使用同一份 durable safe projection，页面重载后可以得到一致结果。
   * 这里刻意不新增 top-level event type，legacy consumer 忽略未知字段即可继续工作。
   */
  grounding?: MessageGroundingV1
}

export interface ChatStreamErrorEvent {
  type: 'error'
  conversationId: string
  assistantMessageId?: string
  message: string
  /** 用户消息已落库（会话 updatedAt 已更新）之后才失败时为 true；前台据此把会话移到侧栏顶部。 */
  userMessagePersisted?: boolean
}

export interface ChatStreamAbortedEvent {
  type: 'aborted'
  conversationId: string
  assistantMessageId: string
  content: string
}
