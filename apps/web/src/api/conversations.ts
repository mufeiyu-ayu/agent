import type {
  Conversation,
  ConversationMessage,
  CreateConversationRequest,
  DeleteConversationResponse,
  ListConversationsRequest,
  ListConversationsResponse,
  UpdateConversationRequest,
} from '@agent/contracts'

import { http } from './http'

interface ConversationRequestOptions {
  signal?: AbortSignal
}

export async function listConversations(params: ListConversationsRequest = {}): Promise<ListConversationsResponse> {
  const response = await http.get<ListConversationsResponse>('/api/conversations', { params })

  return response.data
}

export async function createConversation(
  payload: CreateConversationRequest = {},
  options: ConversationRequestOptions = {},
): Promise<Conversation> {
  const response = await http.post<Conversation>('/api/conversations', payload, {
    ...(options.signal ? { signal: options.signal } : {}),
  })

  return response.data
}

export async function updateConversation(
  conversationId: string,
  payload: UpdateConversationRequest,
): Promise<Conversation> {
  const response = await http.patch<Conversation>(`/api/conversations/${conversationId}`, payload)

  return response.data
}

export async function deleteConversation(conversationId: string): Promise<DeleteConversationResponse> {
  const response = await http.delete<DeleteConversationResponse>(`/api/conversations/${conversationId}`)

  return response.data
}

export async function listConversationMessages(conversationId: string): Promise<ConversationMessage[]> {
  const response = await http.get<ConversationMessage[]>(`/api/conversations/${conversationId}/messages`)

  return response.data ?? []
}
