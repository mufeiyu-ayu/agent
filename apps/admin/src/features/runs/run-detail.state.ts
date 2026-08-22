import type { AdminRunDetail } from '@agent/contracts'

import { createDetailFetchState } from '../shared/detail-fetch.state'
import { fetchAdminRunDetail } from './run-api'

export function createRunDetailState(getRunId: () => string) {
  const state = createDetailFetchState<AdminRunDetail>(
    getRunId,
    (id, signal) => fetchAdminRunDetail(id, { signal }),
  )

  return {
    cancel: state.cancel,
    error: state.error,
    load: state.load,
    loading: state.loading,
    notFound: state.notFound,
    retry: state.retry,
    run: state.data,
  }
}
