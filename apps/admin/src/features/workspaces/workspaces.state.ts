import type { WorkspaceHistoryResponse, WorkspaceMonitorItem, WorkspaceMonitorResponse } from '@agent/contracts'
import { computed, onMounted, onScopeDispose, ref, shallowRef, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { formatAdminRunError } from '../shared/admin-api'
import { createDetailFetchState } from '../shared/detail-fetch.state'
import { getWorkspaceHistory, getWorkspaces, refreshWorkspaces } from './workspaces-api'

export function useWorkspaces() {
  const data = shallowRef<WorkspaceMonitorResponse>()
  const cloud = computed(() => data.value?.cloud)
  const loading = ref(false)
  const error = ref('')
  const page = ref(1)
  const pageSize = ref(20)
  const route = useRoute()
  const router = useRouter()
  const historyId = computed(() => route.name === 'workspaces' && typeof route.query.workspace === 'string' ? route.query.workspace : '')
  const historyPage = ref(1)
  const historyPageSize = ref(20)
  const historyWorkspace = shallowRef<WorkspaceMonitorItem>()
  const history = createDetailFetchState<WorkspaceHistoryResponse>(() => historyId.value, (id, signal) => getWorkspaceHistory(id, historyPage.value, historyPageSize.value, signal))
  watch(historyId, (id) => {
    history.cancel()
    historyPage.value = 1
    historyWorkspace.value = data.value?.items.find(item => item.conversationId === id)
    if (id)
      void history.load()
  }, { immediate: true })
  watch(history.data, (result) => {
    if (result)
      historyWorkspace.value = result.workspace
  })
  let controller: AbortController | undefined
  let epoch = 0
  let disposed = false

  async function load(refresh = false) {
    if (disposed || (refresh && loading.value))
      return
    controller?.abort()
    controller = new AbortController()
    const current = ++epoch
    loading.value = true
    try {
      const request = refresh ? refreshWorkspaces : getWorkspaces
      const result = await request(page.value, pageSize.value, controller.signal)
      if (!disposed && current === epoch) {
        data.value = result
        error.value = ''
      }
    }
    catch (cause) {
      if (!disposed && current === epoch)
        error.value = formatAdminRunError(cause)
    }
    finally {
      if (current === epoch)
        loading.value = false
    }
  }

  function changePage(next: number, size: number) {
    page.value = size === pageSize.value ? next : 1
    pageSize.value = size
    void load()
  }

  function changeHistoryPage(next: number, size: number) {
    historyPage.value = size === historyPageSize.value ? next : 1
    historyPageSize.value = size
    void history.load()
  }

  function closeHistory() {
    void router.replace({ query: { ...route.query, workspace: undefined } })
  }

  onMounted(() => {
    void load()
  })
  onScopeDispose(() => {
    disposed = true
    epoch++
    controller?.abort()
    history.cancel()
  })
  return { data, cloud, loading, error, page, pageSize, load, refresh: () => load(true), changePage, historyId, history, historyWorkspace, historyPage, historyPageSize, changeHistoryPage, closeHistory }
}
