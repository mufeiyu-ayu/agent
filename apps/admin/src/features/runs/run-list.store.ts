import type { RunFilters } from './run.model'
import { defineStore } from 'pinia'
import { reactive, ref } from 'vue'

import { defaultRunFilters } from './run.utils'

export const defaultRunListPageSize = 8

export interface RunListState {
  draftFilters: RunFilters
  appliedFilters: RunFilters
  dateRange: [string, string] | undefined
  currentPage: number
  pageSize: number
}

export const useRunListStore = defineStore('run-list', () => {
  const draftFilters = reactive<RunFilters>({ ...defaultRunFilters })
  const appliedFilters = ref<RunFilters>({ ...defaultRunFilters })
  const dateRange = ref<[string, string] | undefined>()
  const currentPage = ref(1)
  const pageSize = ref(defaultRunListPageSize)

  function applyFilters() {
    appliedFilters.value = {
      ...draftFilters,
      dateFrom: dateRange.value?.[0] ?? '',
      dateTo: dateRange.value?.[1] ?? '',
    }
    currentPage.value = 1
  }

  function resetFilters() {
    Object.assign(draftFilters, defaultRunFilters)
    appliedFilters.value = { ...defaultRunFilters }
    dateRange.value = undefined
    currentPage.value = 1
    pageSize.value = defaultRunListPageSize
  }

  function setCurrentPage(value: number) {
    currentPage.value = Math.max(1, Math.trunc(value) || 1)
  }

  function setPageSize(value: number) {
    pageSize.value = value > 0
      ? Math.trunc(value)
      : defaultRunListPageSize
  }

  function normalizePageAfterFilter(totalItems: number) {
    const lastPage = Math.max(1, Math.ceil(Math.max(0, totalItems) / pageSize.value))
    currentPage.value = Math.min(Math.max(1, currentPage.value), lastPage)
  }

  return {
    appliedFilters,
    applyFilters,
    currentPage,
    dateRange,
    draftFilters,
    normalizePageAfterFilter,
    pageSize,
    resetFilters,
    setCurrentPage,
    setPageSize,
  }
})
