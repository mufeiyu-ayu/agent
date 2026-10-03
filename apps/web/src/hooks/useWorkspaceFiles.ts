import type { WorkspaceSnapshot } from '@agent/contracts'
import type { Ref } from 'vue'
import type { GenerationStatus } from '../types/chat'
import { isAxiosError } from 'axios'
import { onScopeDispose, ref, shallowRef, watch } from 'vue'
import { getWorkspace, getWorkspaceFile } from '../api/workspace'

interface FileContent { bytes: Uint8Array, text: string }
interface CachedFile { conversationId: string, path: string, sha256: string, result: FileContent, size: number }
interface FileRead { controller: AbortController, conversationId: string, path: string, sha256: string, promise: Promise<FileContent> }

// 内容预算包括原始字节与 UTF-16 文本的估算，不包括渲染 DOM；条数上限也约束空文件。
const CACHE_BYTES = 32 * 1024 * 1024
const CACHE_FILES = 256

export function useWorkspaceFiles(conversationId: Ref<string | null>, status: Ref<GenerationStatus>, userId?: Readonly<Ref<string | null>>) {
  const snapshot = shallowRef<WorkspaceSnapshot>()
  const error = ref('')
  const loading = ref(false)
  // 归当前工作区页面所有：面板销毁或切会话不清内容；账号变化与离开页面才全部清空。
  const cache = new Map<string, CachedFile>()
  const reads = new Map<string, FileRead>()
  let cacheBytes = 0
  let epoch = 0
  let controller: AbortController | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  let disposed = false
  let refreshPending = false
  let refreshing: Promise<void> | undefined
  const fileKey = (id: string, path: string) => JSON.stringify([id, path])

  function removeCached(key: string) {
    const entry = cache.get(key)
    if (entry)
      cacheBytes -= entry.size
    cache.delete(key)
  }

  function reconcile(data: WorkspaceSnapshot) {
    const hashes = new Map(data.files.map(file => [file.path, file.sha256]))
    for (const [key, entry] of cache) {
      if (entry.conversationId === data.conversationId && hashes.get(entry.path) !== entry.sha256)
        removeCached(key)
    }
    for (const [key, read] of reads) {
      if (read.conversationId === data.conversationId && hashes.get(read.path) !== read.sha256) {
        read.controller.abort()
        reads.delete(key)
      }
    }
  }

  /** 普通触发合并；显式刷新/保存后的刷新排在旧请求后，不能用保存前的响应确认新内容。 */
  function refresh(afterChange = true): Promise<void> {
    const id = conversationId.value
    if (!id || disposed || (userId && !userId.value))
      return Promise.resolve()
    if (refreshing) {
      refreshPending ||= afterChange
      return refreshing
    }
    const requestEpoch = epoch
    loading.value = true
    refreshing = (async () => {
      do {
        refreshPending = false
        controller = new AbortController()
        try {
          const data = await getWorkspace(id, controller.signal)
          if (requestEpoch === epoch) {
            reconcile(data)
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
        if (typeof document === 'undefined' || !document.hidden)
          await refresh(false)
        schedule()
      }, 2000)
    }
  }

  function resetActive() {
    epoch++
    controller?.abort()
    for (const read of reads.values())
      read.controller.abort()
    reads.clear()
    clearTimeout(timer)
    snapshot.value = undefined
    error.value = ''
    loading.value = false
    refreshing = undefined
    refreshPending = false
  }

  watch([conversationId, () => userId?.value], ([, account], [, previousAccount]) => {
    resetActive()
    if (account !== previousAccount) {
      cache.clear()
      cacheBytes = 0
    }
    void refresh(false).finally(schedule)
  }, { immediate: true, flush: 'sync' })
  watch([conversationId, status], ([id], [previousId]) => {
    // 切会话造成的 empty/idle 变化已由上面的同步 watcher 刷新；同会话终态变化仍要求新请求。
    if (id === previousId)
      void refresh().finally(schedule)
  })

  function restoreVisibility() {
    if (!document.hidden)
      void refresh(false).finally(schedule)
  }
  if (typeof window !== 'undefined') {
    window.addEventListener('focus', restoreVisibility)
    document.addEventListener('visibilitychange', restoreVisibility)
  }
  onScopeDispose(() => {
    disposed = true
    resetActive()
    cache.clear()
    cacheBytes = 0
    if (typeof window !== 'undefined') {
      window.removeEventListener('focus', restoreVisibility)
      document.removeEventListener('visibilitychange', restoreVisibility)
    }
  })

  function forgetConversation(id: string) {
    for (const [key, entry] of cache) {
      if (entry.conversationId === id)
        removeCached(key)
    }
    if (conversationId.value === id)
      resetActive()
  }

  function cachedFile(path: string, expectedSha256?: string): FileContent | undefined {
    const id = conversationId.value
    const file = snapshot.value?.files.find(file => file.path === path)
    if (!id || loading.value || error.value || !file || (expectedSha256 !== undefined && file.sha256 !== expectedSha256))
      return
    const key = fileKey(id, path)
    const cached = cache.get(key)
    if (cached?.sha256 === file.sha256) {
      // Map 插入顺序就是使用顺序，不另建 LRU 抽象。
      cache.delete(key)
      cache.set(key, cached)
      return cached.result
    }
  }

  function readFile(path: string, expectedSha256?: string): Promise<FileContent> {
    const id = conversationId.value
    const requestEpoch = epoch
    if (refreshing) {
      return refreshing.then(() => {
        if (requestEpoch !== epoch)
          throw new Error('会话或文件版本已改变，请重新打开')
        return readFile(path, expectedSha256)
      })
    }
    const file = snapshot.value?.files.find(file => file.path === path)
    const revision = snapshot.value?.revision
    if (!id || disposed || error.value || revision === undefined || !file || (userId && !userId.value))
      return Promise.reject(new Error('文件尚未确认，请刷新文件列表'))
    if (expectedSha256 !== undefined && file.sha256 !== expectedSha256)
      return Promise.reject(new Error('交付文件已改变，请重新选择当前文件'))
    const cached = cachedFile(path, expectedSha256)
    if (cached)
      return Promise.resolve(cached)
    const key = fileKey(id, path)
    const existing = reads.get(key)
    if (existing?.sha256 === file.sha256)
      return existing.promise
    const read: FileRead = { controller: new AbortController(), conversationId: id, path, sha256: file.sha256, promise: undefined! }
    const stillCurrent = () => requestEpoch === epoch && !read.controller.signal.aborted && !error.value
      && snapshot.value?.files.some(current => current.path === path && current.sha256 === file.sha256)
    read.promise = (async () => {
      let currentRevision = revision
      for (let attempt = 0; ; attempt++) {
        let bytes: Uint8Array
        try {
          bytes = await getWorkspaceFile(id, path, currentRevision, read.controller.signal)
        }
        catch (failure) {
          if (!stillCurrent())
            throw new Error('会话或文件版本已改变，请重新打开')
          // 保持读取身份不变：409 刷新后只重试一次，同路径的新 SHA 不能冒充这次读取。
          if (attempt !== 0 || !isAxiosError(failure) || failure.response?.status !== 409)
            throw failure
          await refresh()
          if (!stillCurrent())
            throw new Error('会话或文件版本已改变，请重新打开')
          currentRevision = snapshot.value!.revision
          continue
        }
        if (!stillCurrent())
          throw new Error('会话或文件版本已改变，请重新打开')
        const result = { bytes, text: new TextDecoder().decode(bytes) }
        const size = bytes.byteLength + result.text.length * 2
        removeCached(key)
        if (size <= CACHE_BYTES) {
          cache.set(key, { conversationId: id, path, sha256: file.sha256, result, size })
          cacheBytes += size
          while (cacheBytes > CACHE_BYTES || cache.size > CACHE_FILES)
            removeCached(cache.keys().next().value!)
        }
        return result
      }
    })().finally(() => {
      if (reads.get(key) === read)
        reads.delete(key)
    })
    reads.set(key, read)
    return read.promise
  }

  return { snapshot, loading, error, refresh, readFile, cachedFile, forgetConversation }
}
