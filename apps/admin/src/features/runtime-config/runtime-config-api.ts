import type { AdminRuntimeConfig, AdminRuntimeConfigInput } from '@agent/contracts'

import { requestAdminRun } from '../shared/admin-api'

const BASE = '/api/admin/runtime-config'

export function fetchRuntimeConfig(): Promise<AdminRuntimeConfig> {
  return requestAdminRun<AdminRuntimeConfig>(BASE, {})
}

export function updateRuntimeConfig(input: AdminRuntimeConfigInput): Promise<AdminRuntimeConfig> {
  return requestAdminRun<AdminRuntimeConfig>(BASE, {}, { method: 'PATCH', body: input })
}
