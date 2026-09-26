export interface Conversation {
  id: string
  title: string
  createdAt: string
  updatedAt: string
}

export interface ListConversationsRequest {
  cursor?: string
  limit?: number
}

export interface ListConversationsResponse {
  items: Conversation[]
  nextCursor: string | null
}

export interface CreateConversationRequest {
  title?: string
}

export interface UpdateConversationRequest {
  title: string
}

export interface DeleteConversationResponse {
  deleted: boolean
  id: string
}

export type MessageRole = 'USER' | 'ASSISTANT'

export type MessageStatus
  = | 'PENDING' // 消息已创建，等待开始处理（如等待模型响应）
    | 'STREAMING' // 模型正在流式返回内容，消息处于生成中
    | 'COMPLETED' // 消息已正常生成完毕
    | 'FAILED' // 处理过程中出错，未能正常完成
    | 'ABORTED' // 被主动中断（如用户手动停止生成）

export interface ConversationMessage {
  id: string
  conversationId: string
  role: MessageRole
  content: string
  status: MessageStatus
  createdAt: string
  updatedAt: string
}
