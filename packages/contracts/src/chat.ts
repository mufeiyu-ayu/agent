import type { ReasoningEffort } from './admin-llm.js'

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
    | ChatStreamToolStartedEvent
    | ChatStreamToolFinishedEvent
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

/**
 * 工具开始执行（#208）：只给界面显示进度，不落库、不进模型上下文。
 * `query` / `url` 是模型给的参数，仅供展示：尽力取出、按长度截断，取不到就没有；前台一律按纯文本渲染。
 */
export interface ChatStreamToolStartedEvent {
  type: 'tool_started'
  conversationId: string
  assistantMessageId: string
  callId: string
  /** 模型给的工具名，原样。 */
  toolName: string
  /** web_search 的查询词，最多 200 字符。 */
  query?: string
  /** web_fetch 的网址，最多 2048 字符。 */
  url?: string
}

/** 工具执行结束（#208）：用户停止或到 deadline 时不发，由随后的 aborted / error 收尾。 */
export interface ChatStreamToolFinishedEvent {
  type: 'tool_finished'
  conversationId: string
  assistantMessageId: string
  callId: string
  ok: boolean
  /** ok 为 false 时：timeout 是工具超时，其余（截断、未知工具、参数无效、执行失败）都是 failed。 */
  failure?: 'timeout' | 'failed'
  /** web_search 成功：来源列表，最多 10 条。 */
  results?: Array<{ title: string, url: string }>
  /** web_fetch 成功：重定向后的最终地址。 */
  finalUrl?: string
  /** web_fetch 成功：网页标题。 */
  title?: string
  /** web_fetch 成功：正文字数。 */
  chars?: number
}

export interface ChatStreamDoneEvent {
  type: 'done'
  conversationId: string
  assistantMessageId: string
  content: string
  generatedAt: string
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
