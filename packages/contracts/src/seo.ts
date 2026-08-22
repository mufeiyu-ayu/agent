import type { MessageGroundingV1 } from './grounding.js'

/** 前后端共同执行的单次 SEO Chat 用户消息字符上限。 */
export const SEO_CHAT_MESSAGE_MAX_CHARS = 64_000

/** DeepSeek Thinking Mode 对外开放的单次请求思考强度。 */
export const DEEPSEEK_REASONING_EFFORTS = ['low', 'high', 'max'] as const

export type DeepSeekReasoningEffort = typeof DEEPSEEK_REASONING_EFFORTS[number]

export const DEFAULT_DEEPSEEK_REASONING_EFFORT: DeepSeekReasoningEffort = 'high'

export interface SeoChatRequest {
  conversationId: string
  message: string
  model?: string
  reasoningEffort?: DeepSeekReasoningEffort
}

export interface SeoChatResponse {
  reply: string
  generatedAt: string
}

/**
 * Chat streaming 统一采用 NDJSON 协议：
 * 后端每行输出一个 JSON 序列化后的 `ChatStreamEvent`，前端通过 fetch + ReadableStream 按行解析。
 */
export type ChatStreamProtocol = 'ndjson'

export type ChatStreamEvent
  = | ChatStreamStartEvent
    | ChatStreamDeltaEvent
    | ChatStreamDoneEvent
    | ChatStreamErrorEvent
    | ChatStreamAbortedEvent

export type ChatStreamEventType = ChatStreamEvent['type']

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
}

export interface ChatStreamAbortedEvent {
  type: 'aborted'
  conversationId: string
  assistantMessageId: string
  content: string
}
