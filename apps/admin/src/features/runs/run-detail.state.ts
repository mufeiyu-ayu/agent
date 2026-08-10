import type { AdminRunDetail } from '@agent/contracts'
import { computed, ref, shallowRef } from 'vue'

import { AdminRunApiError, fetchAdminRunDetail, formatAdminRunError } from './run-api'

export function createRunDetailState(getRunId: () => string) {
  const run = ref<AdminRunDetail>()
  const loading = ref(false)
  const notFound = ref(false)
  const errorCause = shallowRef<unknown>()
  const error = computed(() => (
    errorCause.value === undefined ? '' : formatAdminRunError(errorCause.value)
  ))
  let activeController: AbortController | undefined
  let activeRequestId = 0

  async function load(): Promise<void> {
    const targetRunId = getRunId()
    const requestId = ++activeRequestId
    activeController?.abort()

    run.value = undefined
    notFound.value = false
    errorCause.value = undefined
    loading.value = true

    if (!targetRunId) {
      notFound.value = true
      loading.value = false
      return
    }

    const controller = new AbortController()
    activeController = controller

    try {
      const detail = await fetchAdminRunDetail(targetRunId, {
        signal: controller.signal,
      })
      if (isCurrentRequest())
        run.value = detail
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
      return requestId === activeRequestId && targetRunId === getRunId()
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
    error,
    load,
    loading,
    notFound,
    retry: load,
    run,
  }
}
