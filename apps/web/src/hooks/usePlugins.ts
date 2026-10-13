import type { McpPlugin, McpPluginInput } from '@agent/contracts'
import { isAxiosError } from 'axios'
import { onMounted, onScopeDispose, ref } from 'vue'
import {
  connectPlugin,
  deletePlugin,
  disconnectPlugin,
  enablePlugin,
  getMcpConfig,
  getPlugin,
  importPlugins,
  listPlugins,
  savePlugin,
} from '@/api/mcp'

export function usePlugins() {
  const items = ref<McpPlugin[]>([])
  const selected = ref<McpPlugin | null>(null)
  const editing = ref<McpPlugin | null>(null)
  const editorOpen = ref(false)
  const importMode = ref(false)
  const busy = ref(false)
  const loading = ref(false)
  const error = ref('')
  const callbackUrl = ref('')
  const imported = ref<
    Array<{
      config: McpPluginInput
      headers: Record<string, string>
      selected: boolean
    }>
  >([])
  const controller = new AbortController()
  let readEpoch = 0
  let detailEpoch = 0
  let alive = true
  let navigating = false
  function message(cause: unknown) {
    if (isAxiosError(cause)) {
      if (!cause.response || cause.response.data?.error?.error === 'DatabaseCommitOutcomeUnknown') {
        return '请求结果未确认，请刷新核对后再操作，避免重复创建。'
      }
      if (typeof cause.response.data?.message === 'string')
        return cause.response.data.message
    }
    return cause instanceof Error ? cause.message : '操作失败，请重试'
  }
  async function reload() {
    if (busy.value)
      return
    const epoch = ++readEpoch
    loading.value = true
    try {
      const data = await listPlugins(controller.signal)
      if (!alive || epoch !== readEpoch)
        return
      items.value = data
      if (selected.value) {
        selected.value = data.find(item => item.id === selected.value?.id) ?? null
      }
      error.value = ''
    }
    catch (cause) {
      if (alive && epoch === readEpoch)
        error.value = message(cause)
    }
    finally {
      if (alive && epoch === readEpoch)
        loading.value = false
    }
  }
  async function run(operation: () => Promise<void>) {
    if (busy.value)
      return
    const reloadAfter = loading.value
    loading.value = false
    busy.value = true
    ++readEpoch
    ++detailEpoch
    error.value = ''
    try {
      await operation()
    }
    catch (cause) {
      if (alive)
        error.value = message(cause)
    }
    finally {
      if (alive && !navigating) {
        busy.value = false
        if (reloadAfter && !error.value)
          void reload()
      }
    }
  }
  function replace(plugin: McpPlugin) {
    if (!alive)
      return
    items.value = [...items.value.filter(item => item.id !== plugin.id), plugin]
    if (selected.value?.id === plugin.id)
      selected.value = plugin
  }
  async function preview(plugin: McpPlugin) {
    if (busy.value)
      return
    selected.value = plugin
    const epoch = ++detailEpoch
    try {
      const data = await getPlugin(plugin.id, controller.signal)
      if (alive && epoch === detailEpoch && selected.value?.id === plugin.id)
        replace(data)
    }
    catch (cause) {
      if (alive && epoch === detailEpoch)
        error.value = message(cause)
    }
  }
  function openEditor(plugin: McpPlugin | null = null, importing = false) {
    if (busy.value)
      return
    ++detailEpoch
    editing.value = plugin
    selected.value = null
    importMode.value = importing
    imported.value = []
    editorOpen.value = true
    error.value = ''
  }
  async function save(input: McpPluginInput) {
    await run(async () => {
      const plugin = await savePlugin(input, controller.signal, editing.value?.id)
      replace(plugin)
      if (alive) {
        editorOpen.value = false
        selected.value = plugin
      }
    })
  }
  async function parseImport(json: string) {
    await run(async () => {
      const data = await importPlugins(json, controller.signal)
      if (alive)
        imported.value = data.map(item => ({ ...item, selected: true }))
    })
  }
  async function saveImported() {
    await run(async () => {
      for (const entry of [...imported.value].filter(item => item.selected)) {
        const plugin = await savePlugin({ ...entry.config, headers: entry.headers }, controller.signal)
        if (!alive)
          return
        replace(plugin)
        imported.value = imported.value.filter(item => item !== entry)
      }
      if (alive && !imported.value.some(item => item.selected))
        editorOpen.value = false
    })
  }
  async function connect(plugin: McpPlugin, headers?: Record<string, string>) {
    await run(async () => {
      const result = await connectPlugin(plugin, headers, controller.signal)
      if (!alive)
        return
      replace(result.plugin)
      if (result.authorizationUrl) {
        navigating = true
        window.location.assign(result.authorizationUrl)
      }
    })
  }
  async function toggle(plugin: McpPlugin) {
    await run(async () => replace(await enablePlugin(plugin.id, !plugin.enabled, controller.signal)))
  }
  async function disconnect(plugin: McpPlugin) {
    await run(async () => replace(await disconnectPlugin(plugin.id, controller.signal)))
  }
  async function remove(plugin: McpPlugin) {
    await run(async () => {
      await deletePlugin(plugin.id, controller.signal)
      if (alive) {
        items.value = items.value.filter(item => item.id !== plugin.id)
        selected.value = null
      }
    })
  }
  function pageShow(event: PageTransitionEvent) {
    if (event.persisted) {
      navigating = false
      busy.value = false
      void reload()
    }
  }
  onMounted(() => {
    void reload()
    void getMcpConfig(controller.signal)
      .then((data) => {
        if (alive)
          callbackUrl.value = data.callbackUrl
      })
      .catch(() => {})
    window.addEventListener('pageshow', pageShow)
  })
  onScopeDispose(() => {
    alive = false
    ++readEpoch
    ++detailEpoch
    controller.abort()
    window.removeEventListener('pageshow', pageShow)
  })
  return {
    items,
    selected,
    editing,
    editorOpen,
    importMode,
    imported,
    busy,
    loading,
    error,
    callbackUrl,
    reload,
    preview,
    openEditor,
    save,
    parseImport,
    saveImported,
    connect,
    toggle,
    disconnect,
    remove,
  }
}
