import type {
  AdminConversationDetail,
  AdminConversationListResponse,
} from '@agent/contracts'
import type { AdminRunFetchOptions } from '../shared/admin-api'

import { appendPositiveInteger, requestAdminRun } from '../shared/admin-api'

export interface AdminConversationListQuery {
  page?: number
  pageSize?: number
}

export function fetchAdminConversations(
  query: AdminConversationListQuery,
  options: AdminRunFetchOptions = {},
): Promise<AdminConversationListResponse> {
  const search = new URLSearchParams()

  appendPositiveInteger(search, 'page', query.page)
  appendPositiveInteger(search, 'pageSize', query.pageSize)

  const serialized = search.toString()
  return requestAdminRun<AdminConversationListResponse>(
    `/api/admin/conversations${serialized ? `?${serialized}` : ''}`,
    options,
  )
}

export function fetchAdminConversationDetail(
  conversationId: string,
  options: AdminRunFetchOptions = {},
): Promise<AdminConversationDetail> {
  return requestAdminRun<AdminConversationDetail>(
    `/api/admin/conversations/${encodeURIComponent(conversationId)}`,
    options,
  )
}
