import type {
  AdminLlmModel,
  AdminLlmProvider,
  AdminOverviewStats,
  AdminProviderBalance,
} from '@agent/contracts'
import type {
  OverviewKpi,
  OverviewModelRow,
  OverviewToolRow,
  OverviewTrendPoint,
  OverviewWindow,
} from './overview.model'

import { computed, onBeforeUnmount, ref, shallowRef } from 'vue'

import { fetchAllLlmModels, fetchLlmProviders } from '../llm/llm-api'
import { formatAdminRunError } from '../shared/admin-api'
import { fetchOverviewStats, fetchProviderBalance } from './overview-api'
import {
  toOverviewKpi,
  toOverviewModelRows,
  toOverviewToolRows,
  toOverviewTrend,
} from './overview.model'

/**
 * 概览页的数据与派生视图模型。三路请求并行、各自失败：统计失败整页报错可重试，
 * 余额 / 模型配置失败只影响各自的卡片。
 */
export function useOverviewDashboard() {
  const activeWindow = ref<OverviewWindow>('30d')
  const stats = shallowRef<AdminOverviewStats>()
  const statsLoading = ref(false)
  const statsErrorCause = shallowRef<unknown>()
  const statsError = computed(() => (
    statsErrorCause.value === undefined ? '' : formatAdminRunError(statsErrorCause.value)
  ))

  const balance = shallowRef<AdminProviderBalance>()
  const balanceLoading = ref(false)
  const balanceCheckedAt = ref<string | null>(null)

  const models = shallowRef<AdminLlmModel[]>([])
  const providers = shallowRef<AdminLlmProvider[]>([])

  const lastUpdatedAt = ref<string | null>(null)

  let abortController = new AbortController()

  async function loadStats() {
    statsLoading.value = true
    statsErrorCause.value = undefined
    try {
      stats.value = await fetchOverviewStats({ signal: abortController.signal })
      lastUpdatedAt.value = new Date().toISOString()
    }
    catch (cause) {
      if (!abortController.signal.aborted)
        statsErrorCause.value = cause
    }
    finally {
      statsLoading.value = false
    }
  }

  async function loadBalance() {
    balanceLoading.value = true
    try {
      balance.value = await fetchProviderBalance({ signal: abortController.signal })
      balanceCheckedAt.value = new Date().toISOString()
    }
    catch {
      balance.value = { available: false, currency: null, totalBalance: null }
    }
    finally {
      balanceLoading.value = false
    }
  }

  async function loadModelCatalog() {
    try {
      const [nextModels, nextProviders] = await Promise.all([
        fetchAllLlmModels({ signal: abortController.signal }),
        fetchLlmProviders({ signal: abortController.signal }),
      ])
      models.value = nextModels
      providers.value = nextProviders
    }
    catch {
      // 只影响模型表的显示名与探活列，用量本身来自统计接口。
    }
  }

  function refresh() {
    abortController.abort()
    abortController = new AbortController()
    void loadStats()
    void loadBalance()
    void loadModelCatalog()
  }

  refresh()
  onBeforeUnmount(() => abortController.abort())

  const kpi = computed<OverviewKpi | undefined>(() => (
    stats.value
      ? toOverviewKpi(stats.value, stats.value.tools.reduce((total, item) => total + item.count, 0))
      : undefined
  ))
  const trend = computed<OverviewTrendPoint[]>(() => (stats.value ? toOverviewTrend(stats.value) : []))
  const modelRows = computed<OverviewModelRow[]>(() => (
    stats.value ? toOverviewModelRows(stats.value, models.value, providers.value) : []
  ))
  const toolRows = computed<OverviewToolRow[]>(() => (stats.value ? toOverviewToolRows(stats.value) : []))

  return {
    activeWindow,
    stats,
    statsLoading,
    statsError,
    balance,
    balanceLoading,
    balanceCheckedAt,
    lastUpdatedAt,
    kpi,
    trend,
    modelRows,
    toolRows,
    loadStats,
    refresh,
  }
}
