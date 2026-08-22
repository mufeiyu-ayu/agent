import { computed, ref, shallowRef } from 'vue'

import { AdminRunApiError, formatAdminRunError } from './admin-api'

/** 详情页通用加载状态：abort / 竞态 / 404 处理只写一份，run 与 conversation 详情复用。 */
export function createDetailFetchState<T>(
  getId: () => string,
  fetchDetail: (id: string, signal: AbortSignal) => Promise<T>,
) {
  const data = shallowRef<T>()
  const loading = ref(false)
  const notFound = ref(false)
  const errorCause = shallowRef<unknown>()
  const error = computed(() => (
    errorCause.value === undefined ? '' : formatAdminRunError(errorCause.value)
  ))
  let activeController: AbortController | undefined
  let activeRequestId = 0

  async function load(): Promise<void> {
    const targetId = getId()
    const requestId = ++activeRequestId
    activeController?.abort()

    data.value = undefined
    notFound.value = false
    errorCause.value = undefined
    loading.value = true

    if (!targetId) {
      notFound.value = true
      loading.value = false
      return
    }

    const controller = new AbortController()
    activeController = controller

    try {
      const detail = await fetchDetail(targetId, controller.signal)
      if (isCurrentRequest())
        data.value = detail
    }
    catch (cause) {
      if (controller.signal.aborted || !isCurrentRequest())
        return

      if (cause instanceof AdminRunApiError && cause.status === 404)
        notFound.value = true
      else
        errorCause.value = cause
    }
    finally {
      if (isCurrentRequest())
        loading.value = false
    }

    function isCurrentRequest(): boolean {
      return requestId === activeRequestId && targetId === getId()
    }
  }

  function cancel(): void {
    activeRequestId += 1
    activeController?.abort()
    activeController = undefined
    loading.value = false
  }

  return {
    cancel,
    data,
    error,
    load,
    loading,
    notFound,
    retry: load,
  }
}
