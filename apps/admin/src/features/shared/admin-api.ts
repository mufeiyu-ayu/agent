import type { ApiErrorResponse, ApiSuccessResponse } from '@agent/contracts'
import { PASSWORD_CHANGE_REQUIRED } from '@agent/contracts'
import { i18n } from '@/i18n'

/** admin 通用 JSON 请求层：runs / conversations 等所有 admin feature 共用。 */

export interface AdminRunFetchOptions {
  signal?: AbortSignal
}

type AdminRunErrorMessage = string | (() => string)

export class AdminRunApiError extends Error {
  constructor(
    readonly status: number,
    readonly messageSource: AdminRunErrorMessage,
    options?: ErrorOptions,
  ) {
    super(typeof messageSource === 'string' ? messageSource : messageSource(), options)
    this.name = 'AdminRunApiError'
  }
}

export function formatAdminRunError(error: unknown): string {
  if (error instanceof AdminRunApiError) {
    return typeof error.messageSource === 'string'
      ? error.messageSource
      : error.messageSource()
  }

  return error instanceof Error ? error.message : i18n.global.t('errors.generic')
}

export function appendPositiveInteger(
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

export async function requestAdminRun<T>(
  url: string,
  options: AdminRunFetchOptions,
  init?: { method?: 'POST' | 'PATCH' | 'DELETE', body?: unknown },
): Promise<T> {
  let response: Response

  try {
    response = await fetch(url, {
      method: init?.method ?? 'GET',
      headers: {
        Accept: 'application/json',
        ...(init?.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
      signal: options.signal,
    })
  }
  catch (error) {
    if (options.signal?.aborted || isAbortError(error))
      throw error

    throw new AdminRunApiError(
      0,
      () => i18n.global.t('errors.apiUnavailable'),
      { cause: error },
    )
  }

  const payload = await readJson(response)

  handleAuthFailure(url, response.status, payload)

  if (!response.ok || !isSuccessResponse<T>(payload)) {
    throw new AdminRunApiError(
      response.status,
      getErrorMessageSource(payload, response),
    )
  }

  return payload.data
}

// 登录、查当前用户、退出的 401 由调用方自己处理，不触发跳转。
const AUTH_PROBE_URLS = new Set(['/api/auth/login', '/api/auth/me', '/api/auth/logout'])

/** 登录失效（401）回登录页，需要先改密码（403）去改密码页；都带上当前页，完成后回来。 */
function handleAuthFailure(url: string, status: number, payload: unknown): void {
  if (AUTH_PROBE_URLS.has(url))
    return

  const code = (payload as Partial<ApiErrorResponse> | undefined)?.error?.error
  const target = status === 401
    ? '/login'
    : status === 403 && code === PASSWORD_CHANGE_REQUIRED ? '/change-password' : undefined

  if (!target)
    return

  // 线上挂在 /admin/ 下：跳转地址加上 base，回跳参数是去掉 base 的路由路径（交给 router）。
  const base = import.meta.env.BASE_URL.replace(/\/$/, '')
  const routePath = window.location.pathname.slice(base.length) || '/'

  if (routePath === target)
    return

  const redirect = `${routePath}${window.location.search}`
  window.location.assign(`${base}${target}?redirect=${encodeURIComponent(redirect)}`)
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

function getErrorMessageSource(payload: unknown, response: Response): AdminRunErrorMessage {
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
    ? () => i18n.global.t('errors.invalidResponse')
    : () => i18n.global.t('errors.requestFailed', { status: response.status })
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}
