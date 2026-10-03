import type { WorkspaceSnapshot } from '@agent/contracts'
import type { Ref } from 'vue'
import type { GenerationStatus } from '../types/chat'
import { onScopeDispose, ref, shallowRef, watch } from 'vue'
import { getWorkspace, getWorkspaceFile } from '../api/workspace'

export function useWorkspaceFiles(conversationId: Ref<string | null>, status: Ref<GenerationStatus>) {
  const snapshot = shallowRef<WorkspaceSnapshot>()
  const error = ref('')
  const loading = ref(false)
  let epoch = 0
  let controller: AbortController | undefined
  const fileControllers = new Set<AbortController>()
  let timer: ReturnType<typeof setTimeout> | undefined
  let disposed = false
  let refreshPending = false
  let refreshing: Promise<void> | undefined

  function refresh(): Promise<void> {
    const id = conversationId.value
    if (!id || disposed)
      return Promise.resolve()
    if (refreshing) {
      refreshPending = true
      return refreshing
    }
    const requestEpoch = epoch
    loading.value = true
    // 刷新按钮与交付卡片都等待最后一次请求，不能在排队后立即返回旧版本。
    refreshing = (async () => {
      do {
        refreshPending = false
        controller = new AbortController()
        try {
          const data = await getWorkspace(id, controller.signal)
          if (requestEpoch === epoch) {
            snapshot.value = data
            error.value = ''
          }
        }
        catch {
          if (requestEpoch === epoch)
            error.value = '工作文件暂时无法加载，请刷新重试。'
        }
        if (requestEpoch !== epoch || disposed)
          return
      } while (refreshPending)
    })().finally(() => {
      if (requestEpoch === epoch) {
        loading.value = false
        refreshing = undefined
      }
    })
    return refreshing
  }

  function schedule() {
    clearTimeout(timer)
    if (disposed)
      return
    if (['thinking', 'generating'].includes(status.value) || ['creating', 'restoring', 'running', 'saving', 'read', 'write', 'edit', 'bash'].includes(snapshot.value?.state ?? '')) {
      timer = setTimeout(async () => {
        if (!document.hidden)
          await refresh()
        schedule()
      }, 2000)
    }
  }

  watch(conversationId, () => {
    epoch++
    controller?.abort()
    fileControllers.forEach(controller => controller.abort())
    clearTimeout(timer)
    snapshot.value = undefined
    error.value = ''
    loading.value = false
    refreshing = undefined
    refreshPending = false
    void refresh().finally(schedule)
  }, { immediate: true, flush: 'sync' })
  watch(status, () => {
    void refresh().finally(schedule)
  })
  onScopeDispose(() => {
    disposed = true
    epoch++
    controller?.abort()
    fileControllers.forEach(controller => controller.abort())
    clearTimeout(timer)
  })

  async function readFile(path: string, expectedSha256?: string): Promise<{ bytes: Uint8Array, text: string }> {
    const id = conversationId.value
    const revision = snapshot.value?.revision
    const requestEpoch = epoch
    if (!id || revision === undefined)
      throw new Error('文件尚未保存')
    if (expectedSha256 !== undefined && !snapshot.value?.files.some(file => file.path === path && file.sha256 === expectedSha256))
      throw new Error('交付文件已改变，请重新选择当前文件')
    const controller = new AbortController()
    fileControllers.add(controller)
    try {
      const bytes = await getWorkspaceFile(id, path, revision, controller.signal)
      if (requestEpoch !== epoch || conversationId.value !== id || snapshot.value?.revision !== revision)
        throw new Error('会话或文件版本已改变，请重新打开')
      return { bytes, text: new TextDecoder().decode(bytes) }
    }
    finally {
      fileControllers.delete(controller)
    }
  }

  return { snapshot, loading, error, refresh, readFile }
}
