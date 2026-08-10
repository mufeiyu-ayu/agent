import type {
  AdminRunListItem,
  AdminRunPagination,
  AdminRunSummary,
} from '@agent/contracts'
import type { RunFilters } from './run.model'
import { defineStore } from 'pinia'
import { computed, reactive, ref, shallowRef } from 'vue'

import { fetchAdminRuns, formatAdminRunError } from './run-api'

export const defaultRunListPageSize = 8

export const useRunListStore = defineStore('run-list', () => {
  const draftFilters = reactive<RunFilters>(createDefaultFilters())
  const appliedFilters = ref<RunFilters>(createDefaultFilters())
  const dateRange = ref<[string, string] | undefined>()
  const currentPage = ref(1)
  const pageSize = ref(defaultRunListPageSize)
  const items = ref<AdminRunListItem[]>([])
  const summary = ref<AdminRunSummary>(createEmptySummary())
  const pagination = ref<AdminRunPagination>(createEmptyPagination())
  const loading = ref(false)
  const errorCause = shallowRef<unknown>()
  const error = computed(() => (
    errorCause.value === undefined ? '' : formatAdminRunError(errorCause.value)
  ))
  let activeController: AbortController | undefined
  let activeRequestId = 0

  function applyFilters(): Promise<void> {
    appliedFilters.value = {
      ...draftFilters,
      dateFrom: dateRange.value?.[0] ?? '',
      dateTo: dateRange.value?.[1] ?? '',
    }
    currentPage.value = 1
    clearResults()
    return load()
  }

  function resetFilters(): Promise<void> {
    Object.assign(draftFilters, createDefaultFilters())
    appliedFilters.value = createDefaultFilters()
    dateRange.value = undefined
    currentPage.value = 1
    pageSize.value = defaultRunListPageSize
    clearResults()
    return load()
  }

  function setPage(value: number): Promise<void> {
    currentPage.value = Math.max(1, Math.trunc(value) || 1)
    return load()
  }

  function setPageSize(value: number): Promise<void> {
    pageSize.value = Math.min(50, Math.max(1, Math.trunc(value) || defaultRunListPageSize))
    currentPage.value = 1
    return load()
  }

  async function load(): Promise<void> {
    const requestId = ++activeRequestId
    activeController?.abort()
    const controller = new AbortController()
    activeController = controller
    loading.value = true
    errorCause.value = undefined

    try {
      const result = await fetchAdminRuns({
        ...appliedFilters.value,
        page: currentPage.value,
        pageSize: pageSize.value,
      }, {
        signal: controller.signal,
      })

      if (requestId !== activeRequestId)
        return

      if (result.pagination.totalPages > 0 && currentPage.value > result.pagination.totalPages) {
        currentPage.value = result.pagination.totalPages
        await load()
        return
      }

      if (result.pagination.totalPages === 0)
        currentPage.value = 1

      items.value = result.items
      summary.value = result.summary
      pagination.value = result.pagination.totalPages === 0
        ? { ...result.pagination, page: 1 }
        : result.pagination
    }
    catch (cause) {
      if (controller.signal.aborted || requestId !== activeRequestId)
        return

      errorCause.value = cause
    }
    finally {
      if (requestId === activeRequestId)
        loading.value = false
    }
  }

  function retry(): Promise<void> {
    return load()
  }

  function cancel(): void {
    activeRequestId += 1
    activeController?.abort()
    activeController = undefined
    loading.value = false
  }

  function clearResults(): void {
    items.value = []
    summary.value = createEmptySummary()
    pagination.value = {
      page: currentPage.value,
      pageSize: pageSize.value,
      totalItems: 0,
      totalPages: 0,
    }
  }

  return {
    appliedFilters,
    applyFilters,
    cancel,
    currentPage,
    dateRange,
    draftFilters,
    error,
    items,
    load,
    loading,
    pageSize,
    pagination,
    resetFilters,
    retry,
    setPage,
    setPageSize,
    summary,
  }
})

function createDefaultFilters(): RunFilters {
  return {
    query: '',
    status: undefined,
    dateFrom: '',
    dateTo: '',
  }
}

function createEmptySummary(): AdminRunSummary {
  return {
    totalRuns: 0,
    statusCounts: {
      RUNNING: 0,
      COMPLETED: 0,
      FAILED: 0,
      ABORTED: 0,
    },
  }
}

function createEmptyPagination(): AdminRunPagination {
  return {
    page: 1,
    pageSize: defaultRunListPageSize,
    totalItems: 0,
    totalPages: 0,
  }
}
