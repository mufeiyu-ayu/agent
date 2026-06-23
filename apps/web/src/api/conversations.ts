import type {
  Conversation,
  ConversationMessage,
  CreateConversationPayload,
  DeleteConversationResult,
  ListConversationsParams,
  ListConversationsResponse,
  UpdateConversationPayload,
} from '../types/conversation'

import { http } from './http'

export async function listConversations(params: ListConversationsParams = {}): Promise<ListConversationsResponse> {
  const response = await http.get<ListConversationsResponse>('/api/conversations', { params })

  return response.data
}

export async function createConversation(payload: CreateConversationPayload = {}): Promise<Conversation> {
  const response = await http.post<Conversation>('/api/conversations', payload)

  return response.data
}

export async function updateConversation(
  conversationId: string,
  payload: UpdateConversationPayload,
): Promise<Conversation> {
  const response = await http.patch<Conversation>(`/api/conversations/${conversationId}`, payload)

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
