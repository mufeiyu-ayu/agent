import type { AdminRunPagination } from './admin-run.js'
import type { UserProfile } from './auth.js'
import type {
  MessageRole,
  MessageStatus,
} from './conversation.js'

/** 会话所属用户；#195 之前的存量会话可能没有归属，此时为 null。 */
export type AdminConversationUser = UserProfile & { id: string }

export interface AdminConversationListItem {
  id: string
  title: string
  user: AdminConversationUser | null
  messageCount: number
  runCount: number
  createdAt: string
  updatedAt: string
}

export interface AdminConversationListResponse {
  items: AdminConversationListItem[]
  pagination: AdminRunPagination
}

/**
 * 会话级 transcript 消息：与 run 级 `AdminRunMessage` 的 500 字 preview 不同，
 * 这里刻意投影完整 `content`——`Message` 本就是用户可见层，不含模型内部数据。
 */
export interface AdminConversationMessage {
  id: string
  role: MessageRole
  status: MessageStatus
  content: string
  createdAt: string
}

export interface AdminConversationDetail {
  id: string
  title: string
  user: AdminConversationUser | null
  runCount: number
  createdAt: string
  updatedAt: string
  messages: AdminConversationMessage[]
}
