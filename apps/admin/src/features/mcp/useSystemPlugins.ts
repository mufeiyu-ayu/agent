import type { McpPlugin, McpPluginInput } from '@agent/contracts'
import { onMounted, onScopeDispose, ref } from 'vue'
import { formatAdminRunError } from '../shared/admin-api'
import {
  fetchSystemPlugins,
  removeSystemPlugin,
  saveSystemPlugin,
  testSystemPlugin,
  toggleSystemPlugin,
} from './mcp-api'

export function useSystemPlugins() {
  const rows = ref<McpPlugin[]>([])
  const busy = ref(false)
  const togglingId = ref<string | null>(null)
  const loading = ref(false)
  const error = ref('')
  const editorOpen = ref(false)
  const selected = ref<McpPlugin | null>(null)
  const testPlugin = ref<McpPlugin | null>(null)
  const testMessage = ref('')
  const controller = new AbortController()
  let alive = true
  let epoch = 0
  const redirecting = ref(false)
  async function reload() {
    if (busy.value)
      return
    const current = ++epoch
    loading.value = true
    try {
      const data = await fetchSystemPlugins(controller.signal)
      if (alive && current === epoch) {
        rows.value = data
        error.value = ''
      }
    }
    catch (cause) {
      if (alive && current === epoch)
        error.value = formatAdminRunError(cause)
    }
    finally {
      if (alive && current === epoch)
        loading.value = false
    }
  }
  async function run(operation: () => Promise<void>) {
    if (busy.value)
      return
    const reloadAfter = loading.value
    loading.value = false
    ++epoch
    busy.value = true
    error.value = ''
    try {
      await operation()
    }
    catch (cause) {
      if (alive) {
        redirecting.value = false
        error.value = formatAdminRunError(cause)
      }
    }
    finally {
      if (alive && !redirecting.value) {
        busy.value = false
        if (reloadAfter && !error.value)
          void reload()
      }
    }
  }
  function replace(plugin: McpPlugin) {
    if (alive) {
      const index = rows.value.findIndex(row => row.id === plugin.id)
      rows.value = index < 0
        ? [...rows.value, plugin]
        : rows.value.map((row, position) => position === index ? plugin : row)
    }
  }
  function edit(plugin: McpPlugin | null) {
    if (busy.value)
      return
    selected.value = plugin
    editorOpen.value = true
    error.value = ''
  }
  async function save(input: McpPluginInput) {
    await run(async () => {
      replace(await saveSystemPlugin(input, controller.signal, selected.value?.id))
      if (alive)
        editorOpen.value = false
    })
  }
  async function toggle(plugin: McpPlugin) {
    if (busy.value)
      return
    togglingId.value = plugin.id
    try {
      await run(async () => replace(await toggleSystemPlugin(plugin.id, !plugin.available, controller.signal)))
    }
    finally {
      togglingId.value = null
    }
  }
  async function remove(plugin: McpPlugin) {
    await run(async () => {
      await removeSystemPlugin(plugin.id, controller.signal)
      if (alive)
        rows.value = rows.value.filter(row => row.id !== plugin.id)
    })
  }
  async function test(headers: Record<string, string>) {
    const plugin = testPlugin.value
    if (!plugin)
      return
    await run(async () => {
      testMessage.value = ''
      const result = await testSystemPlugin(plugin, headers, controller.signal)
      if (!alive)
        return
      replace(result.plugin)
      if (result.authorizationUrl) {
        redirecting.value = true
        window.location.assign(result.authorizationUrl)
      }
      else if (result.plugin.connected) {
        testMessage.value = `连接成功，发现 ${result.plugin.tools.length} 个工具。此授权仅属于当前管理员。`
      }
      else {
        error.value = '连接尚未完成，请重新测试。'
      }
    })
  }
  function pageShow(event: PageTransitionEvent) {
    if (event.persisted) {
      redirecting.value = false
      testMessage.value = ''
      busy.value = false
      void reload()
    }
  }
  onMounted(() => {
    void reload()
    window.addEventListener('pageshow', pageShow)
  })
  onScopeDispose(() => {
    alive = false
    ++epoch
    controller.abort()
    window.removeEventListener('pageshow', pageShow)
  })
  return {
    rows,
    busy,
    togglingId,
    loading,
    error,
    editorOpen,
    selected,
    testPlugin,
    testMessage,
    redirecting,
    reload,
    edit,
    save,
    toggle,
    remove,
    test,
  }
}
