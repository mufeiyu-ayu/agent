export interface SeoChatRequest {
  conversationId: string
  message: string
  model?: string
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
