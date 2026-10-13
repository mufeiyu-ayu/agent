import type { McpPlugin } from '@agent/contracts'
import { onScopeDispose, ref } from 'vue'
import { listPlugins } from '@/api/mcp'

export function useComposerPlugins() {
  const items = ref<McpPlugin[]>([])
  const selected = ref<Array<{ id: string, name: string }>>([])
  const loading = ref(false)
  const error = ref(false)
  let request: AbortController | undefined
  async function reload() {
    request?.abort()
    const current = request = new AbortController()
    loading.value = true
    error.value = false
    try {
      const plugins = await listPlugins(current.signal)
      if (!current.signal.aborted)
        items.value = plugins.filter(plugin => plugin.available && plugin.connected && plugin.enabled && !plugin.needsAuth)
    }
    catch {
      if (!current.signal.aborted) {
        items.value = []
        error.value = true
      }
    }
    finally {
      if (!current.signal.aborted)
        loading.value = false
    }
  }
  function select(plugin: { id: string, name: string }) {
    if (selected.value.length < 10 && !selected.value.some(item => item.id === plugin.id))
      selected.value = [...selected.value, { id: plugin.id, name: plugin.name }]
  }
  function remove(ids: string[]) {
    selected.value = selected.value.filter(plugin => !ids.includes(plugin.id))
  }
  onScopeDispose(() => request?.abort())
  return { items, selected, loading, error, reload, select, remove }
}
