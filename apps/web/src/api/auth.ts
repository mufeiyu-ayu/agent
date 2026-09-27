import type { AuthConfig, AuthUser, ChangePasswordRequest, GoogleOneTapNonce, GoogleOneTapResult, LoginRequest } from '@agent/contracts'
import { isAxiosError } from 'axios'

import { http } from './http'

/** 未登录返回 null；其他失败照常抛出。 */
export async function fetchCurrentUser(): Promise<AuthUser | null> {
  try {
    return (await http.get<AuthUser>('/api/auth/me')).data
  }
  catch (error) {
    if (isAxiosError(error) && error.response?.status === 401)
      return null
    throw error
  }
}

export async function login(payload: LoginRequest): Promise<AuthUser> {
  return (await http.post<AuthUser>('/api/auth/login', payload)).data
}

export async function logout(): Promise<void> {
  await http.post('/api/auth/logout')
}

export async function changePassword(payload: ChangePasswordRequest): Promise<AuthUser> {
  return (await http.post<AuthUser>('/api/auth/change-password', payload)).data
}

export async function fetchAuthConfig(): Promise<AuthConfig> {
  return (await http.get<AuthConfig>('/api/auth/config')).data
}

export async function fetchOneTapNonce(): Promise<string> {
  return (await http.post<GoogleOneTapNonce>('/api/auth/google/one-tap/nonce')).data.nonce
}

export async function loginWithOneTap(credential: string): Promise<GoogleOneTapResult> {
  return (await http.post<GoogleOneTapResult>('/api/auth/google/one-tap', { credential })).data
}
