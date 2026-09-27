import type { ApiErrorResponse, ApiSuccessResponse as ApiSuccessResponseContract } from '@agent/contracts'
import { PASSWORD_CHANGE_REQUIRED } from '@agent/contracts'
import axios, { isAxiosError } from 'axios'

export const http = axios.create({
  timeout: 10000,
})

http.interceptors.response.use((response) => {
  const payload = response.data

  if (isApiSuccessResponse<unknown>(payload)) {
    response.data = payload.data
  }

  return response
}, (error: unknown) => {
  if (isAxiosError(error))
    handleAuthFailure(error.response?.status, error.response?.data, error.config?.url)

  return Promise.reject(error)
})

// 登录、查当前用户、退出、One Tap 的 401 由调用方自己处理，不触发跳转。
const AUTH_PROBE_URLS = new Set(['/api/auth/login', '/api/auth/me', '/api/auth/logout', '/api/auth/google/one-tap'])

/** 登录失效（401）回登录页，需要先改密码（403）去改密码页；都带上当前页，完成后回来。 */
export function handleAuthFailure(status: number | undefined, payload: unknown, url?: string) {
  if (url && AUTH_PROBE_URLS.has(url))
    return

  const code = (payload as Partial<ApiErrorResponse> | undefined)?.error?.error
  const target = status === 401
    ? '/login'
    : status === 403 && code === PASSWORD_CHANGE_REQUIRED ? '/change-password' : undefined

  if (!target || window.location.pathname === target)
    return

  const redirect = `${window.location.pathname}${window.location.search}`
  window.location.assign(`${target}?redirect=${encodeURIComponent(redirect)}`)
}

function isApiSuccessResponse<T>(value: unknown): value is ApiSuccessResponseContract<T> {
  return (
    typeof value === 'object'
    && value !== null
    && 'success' in value
    && value.success === true
    && 'code' in value
    && 'data' in value
  )
}
