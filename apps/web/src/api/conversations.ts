import type {
  Conversation,
  ConversationMessage,
  CreateConversationMessagePayload,
  CreateConversationPayload,
  DeleteConversationResult,
} from '../types/conversation'

import { http } from './http'

export async function listConversations(): Promise<Conversation[]> {
  const response = await http.get<Conversation[]>('/api/conversations')

  return response.data ?? []
}

export async function createConversation(payload: CreateConversationPayload = {}): Promise<Conversation> {
  const response = await http.post<Conversation>('/api/conversations', payload)

  return response.data
}

export async function deleteConversation(conversationId: string): Promise<DeleteConversationResult> {
  const response = await http.delete<DeleteConversationResult>(`/api/conversations/${conversationId}`)

  return response.data
}

export async function listConversationMessages(conversationId: string): Promise<ConversationMessage[]> {
  const response = await http.get<ConversationMessage[]>(`/api/conversations/${conversationId}/messages`)

  return response.data ?? []
}

export async function createUserMessage(
  conversationId: string,
  payload: CreateConversationMessagePayload,
): Promise<ConversationMessage> {
  const response = await http.post<ConversationMessage>(
    `/api/conversations/${conversationId}/messages/user`,
    payload,
  )

  return response.data
}

export async function createAssistantMessage(
  conversationId: string,
  payload: CreateConversationMessagePayload,
): Promise<ConversationMessage> {
  const response = await http.post<ConversationMessage>(
    `/api/conversations/${conversationId}/messages/assistant`,
    payload,
  )

  return response.data
}
