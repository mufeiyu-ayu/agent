import type {
  AdminConversationDetail,
  AdminConversationListResponse,
} from '@agent/contracts'
import type { AdminRunFetchOptions } from '../shared/admin-api'

import { toShanghaiDayBoundary } from '../runs/run-api'
import { appendPositiveInteger, requestAdminRun } from '../shared/admin-api'

export interface AdminConversationListQuery {
  page?: number
  pageSize?: number
  userId?: string
  /** YYYY-MM-DD，按最近活跃筛选，含当天。 */
  dateFrom?: string
  dateTo?: string
}

export function fetchAdminConversations(
  query: AdminConversationListQuery,
  options: AdminRunFetchOptions = {},
): Promise<AdminConversationListResponse> {
  const search = new URLSearchParams()

  appendPositiveInteger(search, 'page', query.page)
  appendPositiveInteger(search, 'pageSize', query.pageSize)

  if (query.userId)
    search.set('userId', query.userId)
  if (query.dateFrom)
    search.set('dateFrom', toShanghaiDayBoundary(query.dateFrom, 'start'))
  if (query.dateTo)
    search.set('dateTo', toShanghaiDayBoundary(query.dateTo, 'end'))

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
