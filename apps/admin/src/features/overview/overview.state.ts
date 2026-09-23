import type {
  AdminOverviewStats,
  AdminOverviewWindow,
  AdminProviderBalance,
} from '@agent/contracts'
import type {
  OverviewFailureReasonRow,
  OverviewModelRow,
  OverviewToolRow,
  OverviewTrend,
} from './overview.model'

import { computed, onBeforeUnmount, ref, shallowRef, watch } from 'vue'

import { formatAdminRunError } from '../shared/admin-api'
import { fetchOverviewStats, fetchProviderBalance } from './overview-api'
import {
  toFailureReasonRows,
  toOverviewModelRows,
  toOverviewToolRows,
  toOverviewTrend,
} from './overview.model'

const UNAVAILABLE_BALANCE: AdminProviderBalance = { available: false, currency: null, totalBalance: null }

/**
 * 概览页的数据与派生视图模型。统计与余额两路请求并行、各自失败：统计失败整页报错可重试，
 * 余额失败只影响余额一格。两路各自持有 AbortController，新请求取消旧请求，
 * 被取消的旧请求不再写任何状态。
 */
export function useOverviewDashboard() {
  const activeWindow = ref<AdminOverviewWindow>('30d')
  const stats = shallowRef<AdminOverviewStats>()
  const statsLoading = ref(false)
  const statsErrorCause = shallowRef<unknown>()
  const statsError = computed(() => (
    statsErrorCause.value === undefined ? '' : formatAdminRunError(statsErrorCause.value)
  ))

  const balance = shallowRef<AdminProviderBalance>()
  const balanceLoading = ref(false)
  const balanceCheckedAt = ref<string | null>(null)

  const lastUpdatedAt = ref<string | null>(null)

  let statsAbortController = new AbortController()
  let balanceAbortController = new AbortController()

  async function loadStats() {
    statsAbortController.abort()
    statsAbortController = new AbortController()
    const { signal } = statsAbortController
    statsLoading.value = true
    statsErrorCause.value = undefined
    try {
      const nextStats = await fetchOverviewStats(activeWindow.value, { signal })
      if (signal.aborted)
        return
      stats.value = nextStats
      lastUpdatedAt.value = new Date().toISOString()
    }
    catch (cause) {
      if (!signal.aborted)
        statsErrorCause.value = cause
    }
    finally {
      if (!signal.aborted)
        statsLoading.value = false
    }
  }

  async function loadBalance() {
    balanceAbortController.abort()
    balanceAbortController = new AbortController()
    const { signal } = balanceAbortController
    balanceLoading.value = true
    try {
      const nextBalance = await fetchProviderBalance({ signal })
      if (signal.aborted)
        return
      balance.value = nextBalance
      balanceCheckedAt.value = new Date().toISOString()
    }
    catch {
      // 被刷新取消的旧请求不能把余额写成「不可用」，也不能清掉新请求的加载态。
      if (!signal.aborted)
        balance.value = UNAVAILABLE_BALANCE
    }
    finally {
      if (!signal.aborted)
        balanceLoading.value = false
    }
  }

  function refresh() {
    void loadStats()
    void loadBalance()
  }

  refresh()
  watch(activeWindow, () => {
    void loadStats()
  })
  onBeforeUnmount(() => {
    statsAbortController.abort()
    balanceAbortController.abort()
  })

  const trend = computed<OverviewTrend | undefined>(() => (stats.value ? toOverviewTrend(stats.value) : undefined))
  const failureReasonRows = computed<OverviewFailureReasonRow[]>(() => (stats.value ? toFailureReasonRows(stats.value) : []))
  const modelRows = computed<OverviewModelRow[]>(() => (stats.value ? toOverviewModelRows(stats.value) : []))
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
    trend,
    failureReasonRows,
    modelRows,
    toolRows,
    loadStats,
    refresh,
  }
}
