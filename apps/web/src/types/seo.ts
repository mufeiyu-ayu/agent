export type GenerationStatus = 'empty' | 'loading' | 'success' | 'error'

export type CopyableSeoField = 'title' | 'description'

export type SeoConversationTurnStatus = 'loading' | 'success' | 'error'

export interface GenerateSeoRequest {
  pageTopic: string
  language: string
  keywords: string[]
  model?: string
}

export interface GenerateSeoResponse {
  title: string
  description: string
  suggestions: string[]
  generatedAt: string
}

export interface SeoConversationTurn {
  id: string
  request: GenerateSeoRequest
  status: SeoConversationTurnStatus
  createdAt: string
  instruction?: string
  result?: GenerateSeoResponse
  progressMessage?: string
  errorMessage?: string
}

export type SeoStreamEvent
  = | {
    type: 'started'
    message: string
  }
  | {
    type: 'progress'
    message: string
  }
  | {
    type: 'result'
    data: GenerateSeoResponse
  }
  | {
    type: 'error'
    message: string
  }
  | {
    type: 'done'
  }

export interface SeoInputValidationErrors {
  instruction?: string
  pageTopic?: string
  keywords?: string
}

export type AppMessageType = 'error' | 'success' | 'info'

export interface AppMessageState {
  visible: boolean
  type: AppMessageType
  text: string
}
