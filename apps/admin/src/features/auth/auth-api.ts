import type { AuthUser, ChangePasswordRequest, LoginRequest } from '@agent/contracts'

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
