import type { AdminUser, CreateAdminUserRequest, UpdateAdminUserRequest } from '@agent/contracts'

import { requestAdminRun } from '../shared/admin-api'

const BASE = '/api/admin/users'

export function fetchAdminUsers(): Promise<AdminUser[]> {
  return requestAdminRun<AdminUser[]>(BASE, {})
}

export function createAdminUser(input: CreateAdminUserRequest): Promise<AdminUser> {
  return requestAdminRun<AdminUser>(BASE, {}, { method: 'POST', body: input })
}

export function updateAdminUser(userId: string, input: UpdateAdminUserRequest): Promise<AdminUser> {
  return requestAdminRun<AdminUser>(`${BASE}/${encodeURIComponent(userId)}`, {}, { method: 'PATCH', body: input })
}

export function resetAdminUserPassword(userId: string, password: string): Promise<AdminUser> {
  return requestAdminRun<AdminUser>(`${BASE}/${encodeURIComponent(userId)}/reset-password`, {}, { method: 'POST', body: { password } })
}
