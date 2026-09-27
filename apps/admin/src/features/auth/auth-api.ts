import type { AuthConfig, AuthUser, ChangePasswordRequest, LoginRequest } from '@agent/contracts'

import { AdminRunApiError, requestAdminRun } from '../shared/admin-api'

/** 未登录返回 null；其他失败照常抛出。 */
export async function fetchCurrentUser(): Promise<AuthUser | null> {
  try {
    return await requestAdminRun<AuthUser>('/api/auth/me', {})
  }
  catch (error) {
    if (error instanceof AdminRunApiError && error.status === 401)
      return null
    throw error
  }
}

export function login(input: LoginRequest): Promise<AuthUser> {
  return requestAdminRun<AuthUser>('/api/auth/login', {}, { method: 'POST', body: input })
}

export function logout(): Promise<{ ok: true }> {
  return requestAdminRun<{ ok: true }>('/api/auth/logout', {}, { method: 'POST' })
}

export function changePassword(input: ChangePasswordRequest): Promise<AuthUser> {
  return requestAdminRun<AuthUser>('/api/auth/change-password', {}, { method: 'POST', body: input })
}

export function fetchAuthConfig(): Promise<AuthConfig> {
  return requestAdminRun<AuthConfig>('/api/auth/config', {})
}

/** Google 重定向登录：整页跳走。回跳地址带上部署前缀（线上管理台在 /admin/ 下），后端据此回到管理台。 */
export function startGoogleLogin(redirect: string): void {
  const target = `${import.meta.env.BASE_URL.replace(/\/$/, '')}${redirect}`
  window.location.assign(`/api/auth/google/start?redirect=${encodeURIComponent(target)}`)
}
