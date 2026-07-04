import type { ChatMessage } from '../llm/llm.types.js'

export interface RunTurnStreamInput {
  conversationId: string
  userContent: string
  model?: string
  signal?: AbortSignal
  historyLimit: number
  temperature: number
  maxTokens: number
  buildModelMessages: (historyMessages: ChatMessage[]) => ChatMessage[]
}
