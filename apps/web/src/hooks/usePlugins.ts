import type { McpPlugin, McpPluginInput } from '@agent/contracts'
import { isAxiosError } from 'axios'
import { onMounted, onScopeDispose, ref } from 'vue'
import { useI18n } from 'vue-i18n'
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
  const { t, locale } = useI18n()
  const items = ref<McpPlugin[]>([])
  const selected = ref<McpPlugin | null>(null)
  const editing = ref<McpPlugin | null>(null)
  const editorOpen = ref(false)
  const importMode = ref(false)
  const busy = ref(false)
  const loading = ref(false)
  const error = ref('')
  const callbackUrl = ref('')
  const authorizing = ref(false)
  const cancellingAuthorization = ref(false)
  let authorizationPluginId: string | undefined
  let finishAuthorization: ((result: string) => void) | undefined
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
  function message(cause: unknown) {
    if (isAxiosError(cause)) {
      if (!cause.response || cause.response.data?.error?.error === 'DatabaseCommitOutcomeUnknown') {
        return t('plugins.resultUnknown')
      }
      const detail = cause.response.data?.message
      if (locale.value !== 'zh-CN') {
        if (typeof detail === 'string' && detail.includes('仅支持远端 HTTP'))
          return t('plugins.remoteOnly')
        const status = cause.response.status
        return t(status === 409 ? 'plugins.conflict' : status === 404 ? 'plugins.notFound' : status === 400 ? 'plugins.invalidRequest' : 'plugins.operationFailed')
      }
      if (typeof detail === 'string')
        return detail
    }
    return cause instanceof Error ? cause.message : t('plugins.operationFailed')
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
      if (alive) {
        // 授权回调可能先结束；取消请求确认前仍禁止发起下一次写入。
        busy.value = cancellingAuthorization.value
        if (reloadAfter && !error.value)
          void reload()
      }
    }
  }
  function replace(plugin: McpPlugin) {
    if (!alive)
      return
    const index = items.value.findIndex(item => item.id === plugin.id)
    items.value = index < 0
      ? [...items.value, plugin]
      : items.value.map((item, position) => position === index ? plugin : item)
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
    if (busy.value)
      return
    if (plugin.setupMessage) {
      error.value = t('plugins.setupRequired')
      return
    }
    let popup: Window | null = null
    let channel: BroadcastChannel | undefined
    let timer: ReturnType<typeof setTimeout> | undefined
    let completion: Promise<string> | undefined
    if (plugin.authType === 'oauth') {
      if (callbackUrl.value && new URL(callbackUrl.value).origin !== window.location.origin) {
        error.value = t('plugins.originRequired', { origin: new URL(callbackUrl.value).origin })
        return
      }
      // 在用户点击时打开，避免等待接口后被浏览器当成广告弹窗拦截。
      popup = window.open('', '_blank', 'popup,width=720,height=780')
      if (!popup) {
        error.value = t('plugins.popupBlocked')
        return
      }
      popup.opener = null
      const channelId = `kuro-mcp-${Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join('')}`
      popup.sessionStorage.setItem('kuro-mcp-oauth-channel', channelId)
      popup.document.title = t('plugins.preparingAuth')
      popup.document.body.textContent = t('plugins.preparingHint')
      channel = new BroadcastChannel(channelId)
      completion = new Promise((resolve) => {
        finishAuthorization = resolve
      })
      channel.onmessage = (event) => {
        if (event.data === 'connected' || event.data === 'failed')
          finishAuthorization?.(event.data)
      }
      timer = setTimeout(() => finishAuthorization?.('timeout'), 600_000)
    }
    try {
      await run(async () => {
        const result = await connectPlugin(plugin, headers, controller.signal)
        if (!alive)
          return
        replace(result.plugin)
        if (result.authorizationUrl && popup && completion) {
          authorizationPluginId = plugin.id
          authorizing.value = true
          popup.location.replace(result.authorizationUrl)
          const outcome = await completion
          if (!alive || outcome === 'cancelled')
            return
          const latest = await getPlugin(plugin.id, controller.signal)
          replace(latest)
          if (!latest.connected || latest.needsAuth)
            throw new Error(outcome === 'timeout' ? t('plugins.authTimeout') : t('plugins.authIncomplete'))
        }
      })
    }
    finally {
      if (timer)
        clearTimeout(timer)
      channel?.close()
      popup?.close()
      finishAuthorization = undefined
      authorizationPluginId = undefined
      authorizing.value = false
    }
  }
  async function cancelAuthorization() {
    if (!authorizing.value || !authorizationPluginId || cancellingAuthorization.value)
      return
    const finish = finishAuthorization
    cancellingAuthorization.value = true
    try {
      replace(await disconnectPlugin(authorizationPluginId, controller.signal))
      finish?.('cancelled')
    }
    catch (cause) {
      if (alive)
        error.value = message(cause)
    }
    finally {
      cancellingAuthorization.value = false
      if (!authorizing.value)
        busy.value = false
    }
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
    if (event.persisted)
      void reload()
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
    finishAuthorization?.('cancelled')
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
    authorizing,
    cancellingAuthorization,
    cancelAuthorization,
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
