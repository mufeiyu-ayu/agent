import type {
  AdminRunDetail,
  AdminRunListResponse,
  AgentRunStatus,
  ApiSuccessResponse,
} from '@agent/contracts'

export interface AdminRunListQuery {
  page?: number
  pageSize?: number
  status?: AgentRunStatus
  query?: string
  dateFrom?: string
  dateTo?: string
}

export interface AdminRunFetchOptions {
  signal?: AbortSignal
}

export class AdminRunApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = 'AdminRunApiError'
  }
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

function appendPositiveInteger(
  search: URLSearchParams,
  key: string,
  value: number | undefined,
): void {
  if (value === undefined)
    return

  const normalized = Math.trunc(value)
  if (normalized > 0)
    search.set(key, String(normalized))
}

function toShanghaiDayBoundary(
  date: string,
  boundary: 'start' | 'end',
): string {
  if (!isCalendarDate(date))
    throw new RangeError(`无效日期：${date}`)

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

async function requestAdminRun<T>(
  url: string,
  options: AdminRunFetchOptions,
): Promise<T> {
  let response: Response

  try {
    response = await fetch(url, {
      headers: {
        Accept: 'application/json',
      },
      signal: options.signal,
    })
  }
  catch (error) {
    if (options.signal?.aborted || isAbortError(error))
      throw error

    throw new AdminRunApiError(
      0,
      error instanceof Error ? error.message : '无法连接 Admin API。',
    )
  }

  const payload = await readJson(response)

  if (!response.ok || !isSuccessResponse<T>(payload)) {
    throw new AdminRunApiError(
      response.status,
      getErrorMessage(payload, response),
    )
  }

  return payload.data
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json()
  }
  catch {
    return undefined
  }
}

function isSuccessResponse<T>(value: unknown): value is ApiSuccessResponse<T> & { data: T } {
  return (
    typeof value === 'object'
    && value !== null
    && 'success' in value
    && value.success === true
    && 'data' in value
    && value.data !== null
  )
}

function getErrorMessage(payload: unknown, response: Response): string {
  if (
    typeof payload === 'object'
    && payload !== null
    && 'message' in payload
    && typeof payload.message === 'string'
    && payload.message
  ) {
    return payload.message
  }

  return response.ok
    ? 'Admin API 返回了无效响应。'
    : `Admin API 请求失败（HTTP ${response.status}）。`
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}
