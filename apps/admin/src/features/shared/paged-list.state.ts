import type { AdminRunPagination } from '@agent/contracts'
import { computed, ref, shallowRef } from 'vue'

import { formatAdminRunError } from './admin-api'

export interface PagedResult<T> {
  items: T[]
  pagination: AdminRunPagination
}

/** 无过滤表单的简单分页列表状态：会话列表与会话内运行列表复用。 */
export function createPagedListState<T>(
  fetchPage: (page: number, pageSize: number, signal: AbortSignal) => Promise<PagedResult<T>>,
  defaultPageSize = 8,
) {
  const items = shallowRef<T[]>([])
  const currentPage = ref(1)
  const pageSize = ref(defaultPageSize)
  const pagination = ref<AdminRunPagination>({
    page: 1,
    pageSize: defaultPageSize,
    totalItems: 0,
    totalPages: 0,
  })
  const loading = ref(false)
  const errorCause = shallowRef<unknown>()
  const error = computed(() => (
    errorCause.value === undefined ? '' : formatAdminRunError(errorCause.value)
  ))
  let activeController: AbortController | undefined
  let activeRequestId = 0

  async function load(): Promise<void> {
    const requestId = ++activeRequestId
    activeController?.abort()
    const controller = new AbortController()
    activeController = controller
    loading.value = true
    errorCause.value = undefined

    try {
      const result = await fetchPage(currentPage.value, pageSize.value, controller.signal)

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

  function setPage(value: number): Promise<void> {
    currentPage.value = Math.max(1, Math.trunc(value) || 1)
    return load()
  }

  function setPageSize(value: number): Promise<void> {
    pageSize.value = Math.min(50, Math.max(1, Math.trunc(value) || defaultPageSize))
    currentPage.value = 1
    return load()
  }

  function cancel(): void {
    activeRequestId += 1
    activeController?.abort()
    activeController = undefined
    loading.value = false
  }

  return {
    cancel,
    currentPage,
    error,
    items,
    load,
    loading,
    pageSize,
    pagination,
    retry: load,
    setPage,
    setPageSize,
  }
}
