export type GenerationStatus = 'empty' | 'idle' | 'thinking' | 'generating' | 'done' | 'error' | 'aborted'

export type ConversationTurnStatus = 'thinking' | 'generating' | 'success' | 'error' | 'aborted'

export interface ConversationTurn {
  id: string
  userMessage: string
  status: ConversationTurnStatus
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
