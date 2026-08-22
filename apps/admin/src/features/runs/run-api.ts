import type {
  AdminRunDetail,
  AdminRunListResponse,
  AgentRunStatus,
} from '@agent/contracts'
import type { AdminRunFetchOptions } from '../shared/admin-api'
import { i18n } from '@/i18n'

import { appendPositiveInteger, requestAdminRun } from '../shared/admin-api'

// 历史入口兼容：通用请求层已上移到 features/shared/admin-api，这里保留 re-export。
export {
  AdminRunApiError,
  appendPositiveInteger,
  formatAdminRunError,
  requestAdminRun,
} from '../shared/admin-api'
export type { AdminRunFetchOptions } from '../shared/admin-api'

export interface AdminRunListQuery {
  page?: number
  pageSize?: number
  status?: AgentRunStatus
  query?: string
  conversationId?: string
  dateFrom?: string
  dateTo?: string
}

export function serializeAdminRunQuery(query: AdminRunListQuery): string {
  const search = new URLSearchParams()
  const normalizedQuery = query.query?.trim()

  appendPositiveInteger(search, 'page', query.page)
  appendPositiveInteger(search, 'pageSize', query.pageSize)

  if (query.status)
    search.set('status', query.status)
  if (normalizedQuery)
    search.set('query', normalizedQuery)
  if (query.conversationId)
    search.set('conversationId', query.conversationId)
  if (query.dateFrom)
    search.set('dateFrom', toShanghaiDayBoundary(query.dateFrom, 'start'))
  if (query.dateTo)
    search.set('dateTo', toShanghaiDayBoundary(query.dateTo, 'end'))

  return search.toString()
}

export function fetchAdminRuns(
  query: AdminRunListQuery,
  options: AdminRunFetchOptions = {},
): Promise<AdminRunListResponse> {
  const search = serializeAdminRunQuery(query)
  return requestAdminRun<AdminRunListResponse>(
    `/api/admin/runs${search ? `?${search}` : ''}`,
    options,
  )
}

export function fetchAdminRunDetail(
  runId: string,
  options: AdminRunFetchOptions = {},
): Promise<AdminRunDetail> {
  return requestAdminRun<AdminRunDetail>(
    `/api/admin/runs/${encodeURIComponent(runId)}`,
    options,
  )
}

function toShanghaiDayBoundary(
  date: string,
  boundary: 'start' | 'end',
): string {
  if (!isCalendarDate(date))
    throw new RangeError(i18n.global.t('errors.invalidDate', { date }))

  return boundary === 'start'
    ? `${date}T00:00:00+08:00`
    : `${date}T23:59:59.999+08:00`
}

function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value))
    return false

  const parsed = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}
