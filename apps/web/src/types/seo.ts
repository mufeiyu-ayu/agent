export type GenerationStatus = 'empty' | 'loading' | 'success' | 'error'

export type SeoConversationTurnStatus = 'loading' | 'success' | 'error'

export interface SeoChatRequest {
  message: string
  model?: string
}

export interface SeoChatResponse {
  reply: string
  generatedAt: string
}

export interface SeoConversationTurn {
  id: string
  userMessage: string
  status: SeoConversationTurnStatus
  createdAt: string
  reply?: string
  generatedAt?: string
  errorMessage?: string
}

export type AppMessageType = 'error' | 'success' | 'info'

export interface AppMessageState {
  visible: boolean
  type: AppMessageType
  text: string
}
