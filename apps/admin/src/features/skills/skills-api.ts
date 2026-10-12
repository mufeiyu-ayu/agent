import type { AdminSkillDetail, AdminSkillSummary, CreateAdminSkillRequest, UpdateAdminSkillRequest } from '@agent/contracts'
import type { AdminRunFetchOptions } from '../shared/admin-api'
import { requestAdminRun } from '../shared/admin-api'

const BASE_URL = '/api/admin/skills'

export function fetchAdminSkills(options: AdminRunFetchOptions = {}): Promise<AdminSkillSummary[]> {
  return requestAdminRun(BASE_URL, options)
}

export function fetchAdminSkillDetail(id: string, options: AdminRunFetchOptions = {}): Promise<AdminSkillDetail> {
  return requestAdminRun(`${BASE_URL}/${encodeURIComponent(id)}`, options)
}

export function createAdminSkill(input: CreateAdminSkillRequest, options: AdminRunFetchOptions = {}): Promise<AdminSkillDetail> {
  return requestAdminRun(BASE_URL, options, { method: 'POST', body: input })
}

export function updateAdminSkill(id: string, input: UpdateAdminSkillRequest, options: AdminRunFetchOptions = {}): Promise<AdminSkillDetail> {
  return requestAdminRun(`${BASE_URL}/${encodeURIComponent(id)}`, options, { method: 'PATCH', body: input })
}

export function toggleAdminSkill(id: string, enabled: boolean, options: AdminRunFetchOptions = {}): Promise<{ id: string, enabled: boolean }> {
  return requestAdminRun(`${BASE_URL}/${encodeURIComponent(id)}/toggle`, options, { method: 'POST', body: { enabled } })
}

export function deleteAdminSkill(id: string, options: AdminRunFetchOptions = {}): Promise<{ id: string }> {
  return requestAdminRun(`${BASE_URL}/${encodeURIComponent(id)}`, options, { method: 'DELETE' })
}
