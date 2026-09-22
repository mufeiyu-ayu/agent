import type {
  AdminOverviewStats,
  AdminOverviewWindow,
  AdminProviderBalance,
} from '@agent/contracts'
import type { AdminRunFetchOptions } from '../shared/admin-api'

import { requestAdminRun } from '../shared/admin-api'

export function fetchOverviewStats(
  window: AdminOverviewWindow,
  options: AdminRunFetchOptions = {},
): Promise<AdminOverviewStats> {
  return requestAdminRun<AdminOverviewStats>(`/api/admin/overview/stats?window=${window}`, options)
}

export function fetchProviderBalance(
  options: AdminRunFetchOptions = {},
): Promise<AdminProviderBalance> {
  return requestAdminRun<AdminProviderBalance>('/api/admin/overview/balance', options)
}
