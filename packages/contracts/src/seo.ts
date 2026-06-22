export interface SeoChatRequest {
  conversationId: string
  message: string
  model?: string
}

export interface SeoChatResponse {
  reply: string
  generatedAt: string
}
