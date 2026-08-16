import type {
  Conversation,
  ConversationMessage,
  CreateConversationRequest,
  DeleteConversationResponse,
  ListConversationsRequest,
  ListConversationsResponse,
  UpdateConversationRequest,
} from '@agent/contracts'

import { normalizeConversationMessages } from '../utils/message-grounding'
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

/**
 * 读取历史消息，并在 Web 边界重新校验可选 Grounding。
 *
 * 历史数据同样要过 `parseMessageGroundingV1`：契约漂移、被改写的持久化数据或中间层
 * 改动都不该因为「类型上写着合法」就被直接渲染成来源。非法 Grounding 只被剥离，
 * 消息正文与整个会话继续正常加载。
 */
export async function listConversationMessages(conversationId: string): Promise<ConversationMessage[]> {
  const response = await http.get<ConversationMessage[]>(`/api/conversations/${conversationId}/messages`)

  return normalizeConversationMessages(response.data ?? [])
}
