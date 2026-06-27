export type GenerationStatus = 'empty' | 'idle' | 'thinking' | 'generating' | 'done' | 'error' | 'aborted'

export type SeoConversationTurnStatus = 'thinking' | 'generating' | 'success' | 'error' | 'aborted'

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
