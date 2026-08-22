import type { AdminConversationDetail } from '@agent/contracts'

import { createDetailFetchState } from '../shared/detail-fetch.state'
import { fetchAdminConversationDetail } from './conversation-api'

export function createConversationDetailState(getConversationId: () => string) {
  const state = createDetailFetchState<AdminConversationDetail>(
    getConversationId,
    (id, signal) => fetchAdminConversationDetail(id, { signal }),
  )

  return {
    cancel: state.cancel,
    conversation: state.data,
    error: state.error,
    load: state.load,
    loading: state.loading,
    notFound: state.notFound,
    retry: state.retry,
  }
}
