import type {
  AdminOverviewStats,
  AdminProviderBalance,
} from '@agent/contracts'
import type { AdminRunFetchOptions } from '../shared/admin-api'

import { requestAdminRun } from '../shared/admin-api'

export function fetchOverviewStats(
  options: AdminRunFetchOptions = {},
): Promise<AdminOverviewStats> {
  return requestAdminRun<AdminOverviewStats>('/api/admin/overview/stats', options)
}

export function fetchProviderBalance(
  options: AdminRunFetchOptions = {},
): Promise<AdminProviderBalance> {
  return requestAdminRun<AdminProviderBalance>('/api/admin/overview/balance', options)
}
