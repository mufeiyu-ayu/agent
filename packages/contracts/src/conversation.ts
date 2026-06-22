export interface Conversation {
  id: string
  title: string
  createdAt: string
  updatedAt: string
}

export interface CreateConversationRequest {
  title?: string
}

export interface DeleteConversationResponse {
  deleted: boolean
  id: string
}

export type MessageRole = 'USER' | 'ASSISTANT'

export type MessageStatus = 'PENDING' | 'STREAMING' | 'COMPLETED' | 'FAILED'

export interface ConversationMessage {
  id: string
  conversationId: string
  role: MessageRole
  content: string
  status: MessageStatus
  createdAt: string
  updatedAt: string
}

export interface CreateConversationMessageRequest {
  content: string
}
