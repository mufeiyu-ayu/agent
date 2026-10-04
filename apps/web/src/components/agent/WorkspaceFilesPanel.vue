<script setup lang="ts">
import type { WorkspaceSnapshot } from '@agent/contracts'
import { useElementSize } from '@vueuse/core'
import { DialogClose, DialogContent, DialogPortal, DialogRoot, DialogTitle, DialogTrigger } from 'reka-ui'
import { computed, onScopeDispose, provide, reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useCopyFeedback } from '../../hooks/useCopyFeedback'
import { HTML_PREVIEW } from '../../hooks/useHtmlPreview'
import { useWorkspaceTheme } from '../../hooks/useWorkspaceTheme'
import { highlightCode } from '../../utils/code-highlighter'
import { isPreviewableHtml } from '../../utils/html-preview'
import { FILE_CODE_LIMIT, fileFormatParser, formatFileCode, highlightedCodeLines } from '../../utils/source-code'
import { workspaceFileTree, workspaceFileType } from '../../utils/workspace-files'
import AppIcon from '../common/AppIcon.vue'
import AppTooltip from '../common/AppTooltip.vue'
import AgentMarkdownContent from './AgentMarkdownContent.vue'
import HtmlPreviewPanel from './HtmlPreviewPanel.vue'

const props = defineProps<{
  snapshot?: WorkspaceSnapshot
  loading: boolean
  error: string
  conversationId: string | null
  readFile: (path: string, expectedSha256?: string) => Promise<{ bytes: Uint8Array, text: string }>
  cachedFile: (path: string, expectedSha256?: string) => { bytes: Uint8Array, text: string } | undefined
  autoPreview?: boolean
}>()
const emit = defineEmits<{ close: [], refresh: [] }>()
const { t } = useI18n()
const { workspaceTheme } = useWorkspaceTheme()
// 文件中的 Markdown 只阅读，不借用会关闭本面板的聊天 HTML 预览上下文。
provide(HTML_PREVIEW, undefined)
const { copied, copy } = useCopyFeedback()
const panel = ref<HTMLElement | null>(null)
const { width } = useElementSize(panel)
const expandedPreview = ref(false)
const selected = ref('')
const code = ref('')
const mode = ref<'code' | 'preview'>('code')
const previewPending = ref(false)
const contentLoading = computed(() => previewPending.value || (props.loading && !props.snapshot))
const previewError = ref('')
const downloadPending = ref(false)
const downloadTarget = ref<{ path: string, sha256: string }>()
const downloadError = ref(false)
const downloadChanged = computed(() => !!downloadTarget.value && !props.snapshot?.files.some(file => file.path === downloadTarget.value!.path && file.sha256 === downloadTarget.value!.sha256))
const downloadErrorText = computed(() => downloadTarget.value ? t(downloadChanged.value ? 'workspace.downloadChanged' : 'workspace.downloadFailed', { path: downloadTarget.value.path }) : '')
const search = ref('')
const collapsed = reactive(new Set<string>())
let previewRequest = 0
let downloadRequest = 0
let expectedSha256: string | undefined
let shownSha256: string | undefined
let pendingSha256: string | undefined
const showEnvironment = ref(localStorage.getItem('kuro-show-environment') === 'true')
watch(showEnvironment, value => localStorage.setItem('kuro-show-environment', String(value)))
const stateLabel = computed(() => t(`workspace.states.${props.snapshot?.state ?? 'idle'}`))
const totalBytes = computed(() => props.snapshot?.files.reduce((sum, file) => sum + file.bytes, 0) ?? 0)
const previewable = computed(() => selected.value.toLowerCase().endsWith('.html') && isPreviewableHtml(code.value, 'html'))
const fileType = computed(() => workspaceFileType(selected.value))
const markdown = computed(() => fileType.value.language === 'markdown')
const formattedCode = ref<string>()
const formatting = ref(false)
const formatError = ref('')
const wrapLines = ref(false)
let formatRequest = 0
onScopeDispose(() => {
  previewRequest++
  resetDownload()
  formatRequest++
})

function resetDownload() {
  downloadRequest++
  downloadPending.value = false
  downloadTarget.value = undefined
  downloadError.value = false
}
const displayedCode = computed(() => formattedCode.value ?? code.value)
const highlighted = computed(() => highlightCode(displayedCode.value, fileType.value.language, FILE_CODE_LIMIT))
// ponytail: 超过 5000 行退回完整 pre，避免为大文件创建数万个节点；需要大文件编辑时换虚拟化编辑器。
const sourceLines = computed(() => displayedCode.value.split('\n').length <= 5000 ? highlightedCodeLines(highlighted.value) : undefined)
const canFormat = computed(() => !!fileFormatParser(selected.value) && code.value.length <= FILE_CODE_LIMIT)
const tree = computed(() => workspaceFileTree(props.snapshot?.files.map(file => file.path) ?? [], search.value, collapsed))
const showTree = computed(() => !selected.value || width.value >= 620)
watch(selected, () => expandedPreview.value = false)
watch([code, selected], () => {
  formatRequest++
  formattedCode.value = undefined
  formatting.value = false
  formatError.value = ''
})
let autoPreviewed = false
watch([() => props.snapshot, () => props.loading, () => props.error], () => {
  if (!props.snapshot) {
    previewRequest++
    selected.value = ''
    code.value = ''
    shownSha256 = undefined
    previewPending.value = false
    resetDownload()
    return
  }
  if (downloadPending.value && downloadChanged.value) {
    // 只失效下载自己的身份；A 更新/删除不影响仍有效的 B。
    downloadRequest++
    downloadPending.value = false
    downloadError.value = true
  }
  if (props.loading || props.error)
    return
  if (selected.value) {
    const file = props.snapshot.files.find(file => file.path === selected.value)
    if (file) {
      // 未改的正文不重开，避免后台清单刷新抢走在途下载的请求序号。
      if ((shownSha256 !== file.sha256 && (!previewPending.value || pendingSha256 !== file.sha256)) || previewError.value)
        void open(selected.value, mode.value === 'preview', expectedSha256)
    }
    else {
      previewRequest++
      selected.value = ''
      code.value = ''
      shownSha256 = undefined
      mode.value = 'code'
      previewPending.value = false
      previewError.value = ''
    }
    return
  }
  const html = props.snapshot.files.find(file => file.path.toLowerCase().endsWith('.html'))
  if (props.autoPreview !== false && html && !autoPreviewed) {
    autoPreviewed = true
    void open(html.path, true)
  }
}, { immediate: true })

watch(() => props.conversationId, () => {
  previewRequest++
  resetDownload()
  autoPreviewed = false
  expectedSha256 = undefined
  shownSha256 = undefined
  selected.value = ''
  code.value = ''
  mode.value = 'code'
  previewPending.value = false
  previewError.value = ''
  search.value = ''
  collapsed.clear()
})
function toggleDirectory(path: string) {
  if (collapsed.has(path))
    collapsed.delete(path)
  else
    collapsed.add(path)
}

async function toggleFormat() {
  if (formattedCode.value !== undefined) {
    formattedCode.value = undefined
    return
  }
  const current = ++formatRequest
  formatting.value = true
  formatError.value = ''
  try {
    const result = await formatFileCode(code.value, selected.value)
    if (current === formatRequest)
      formattedCode.value = result
  }
  catch {
    if (current === formatRequest)
      formatError.value = t('workspace.formatFailed')
  }
  finally {
    if (current === formatRequest)
      formatting.value = false
  }
}

function close() {
  previewRequest++
  previewPending.value = false
  resetDownload()
  emit('close')
}

async function open(path: string, preview = false, sha256?: string) {
  const current = ++previewRequest
  expectedSha256 = sha256
  autoPreviewed = true
  // 先确定读取目标，版本变化时才能重读它；不能用上一次成功打开的文件抢回选择。
  const hash = props.snapshot?.files.find(file => file.path === path)?.sha256
  const cached = props.cachedFile(path, sha256)
  const alreadyShown = selected.value === path && shownSha256 !== undefined && shownSha256 === hash
    && !props.error && (sha256 === undefined || sha256 === hash)
  if (selected.value !== path || (!cached && !alreadyShown)) {
    code.value = ''
    shownSha256 = undefined
  }
  selected.value = path
  mode.value = preview && path.toLowerCase().endsWith('.html') ? 'preview' : 'code'
  previewPending.value = !cached && !alreadyShown
  pendingSha256 = hash
  previewError.value = ''
  try {
    if (sha256 !== undefined && !props.snapshot?.files.some(file => file.path === path && file.sha256 === sha256)) {
      code.value = ''
      selected.value = ''
      mode.value = 'code'
      throw new Error('交付文件内容已改变')
    }
    if (alreadyShown) {
      mode.value = preview && previewable.value ? 'preview' : 'code'
      return
    }
    const result = cached ?? await props.readFile(path, sha256)
    if (current !== previewRequest)
      return
    shownSha256 = props.snapshot?.files.find(file => file.path === path)?.sha256
    code.value = result.text
    mode.value = preview && path.toLowerCase().endsWith('.html') && isPreviewableHtml(result.text, 'html') ? 'preview' : 'code'
  }
  catch {
    if (current === previewRequest)
      previewError.value = t('workspace.fileFailed')
  }
  finally {
    if (current === previewRequest)
      previewPending.value = false
  }
}

defineExpose({ openFile: (path: string, sha256: string) => open(path, true, sha256) })

async function download(path: string, sha256?: string) {
  if (downloadPending.value || props.loading || props.error)
    return
  const current = ++downloadRequest
  // 重试固定失败下载的 path + SHA，不从当前预览选择重新推导身份。
  const target = { path, sha256: sha256 ?? (path === selected.value ? expectedSha256 : undefined) ?? props.snapshot?.files.find(file => file.path === path)?.sha256 ?? '' }
  downloadTarget.value = target
  downloadError.value = false
  const cached = props.cachedFile(path, target.sha256)
  downloadPending.value = !cached
  try {
    if (downloadChanged.value)
      throw new Error('下载文件身份已失效')
    const result = cached ?? await props.readFile(path, target.sha256)
    if (current !== downloadRequest)
      return
    if (props.error || downloadChanged.value)
      throw new Error('下载文件尚未确认或已失效')
    const url = URL.createObjectURL(new Blob([result.bytes as Uint8Array<ArrayBuffer>], { type: 'application/octet-stream' }))
    const link = document.createElement('a')
    link.href = url
    link.download = path.split('/').at(-1) ?? 'file'
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    downloadTarget.value = undefined
  }
  catch {
    if (current === downloadRequest)
      downloadError.value = true
  }
  finally {
    if (current === downloadRequest)
      downloadPending.value = false
  }
}

function retryDownload() {
  const target = downloadTarget.value
  if (target)
    void download(target.path, target.sha256)
}
</script>

<template>
  <section ref="panel" data-workspace-files-panel class="workspace-panel" :class="{ 'is-compact': width < 620 }" :data-dark="workspaceTheme === 'olive-ember'" @keydown.esc.stop="close">
    <header class="file-toolbar">
      <div class="file-title" :title="selected || t('workspace.files')">
        <AppIcon :name="selected ? fileType.icon : 'vscode-icons:default-folder-opened'" :size="18" />
        <select v-if="width < 620 && selected && (snapshot?.files.length ?? 0) > 1" :value="selected" :disabled="previewPending || loading || !!error" :aria-label="t('workspace.chooseFile')" @change="open(($event.target as HTMLSelectElement).value, true)">
          <option v-for="file in snapshot?.files" :key="file.path" :value="file.path">
            {{ file.path }}
          </option>
        </select>
        <h2 v-else>
          {{ selected ? selected.split('/').at(-1) : t('workspace.files') }}
        </h2>
      </div>
      <div class="toolbar-actions">
        <div v-if="selected && !markdown" class="view-switch" :aria-label="t('workspace.viewMode')" role="group">
          <button :aria-pressed="mode === 'code'" @click="mode = 'code'">
            {{ t('workspace.code') }}
          </button>
          <button v-if="previewable" :aria-pressed="mode === 'preview'" @click="mode = 'preview'">
            {{ t('workspace.preview') }}
          </button>
        </div>
        <AppTooltip :content="t('workspace.refresh')">
          <button class="workspace-action" :disabled="loading" :aria-label="t('workspace.refresh')" @click="emit('refresh')">
            <AppIcon name="tabler:refresh" :size="16" :class="{ 'animate-spin motion-reduce:animate-none': loading }" />
          </button>
        </AppTooltip>
        <AppTooltip v-if="selected" :content="t('workspace.downloadFile', { path: selected })">
          <button class="workspace-action" :disabled="downloadPending || loading || !!error" :aria-busy="downloadPending && downloadTarget?.path === selected" :aria-label="t('workspace.downloadFile', { path: selected })" @click="download(selected)">
            <AppIcon :name="downloadPending && downloadTarget?.path === selected ? 'tabler:loader-2' : 'tabler:download'" :size="17" :class="{ 'animate-spin motion-reduce:animate-none': downloadPending && downloadTarget?.path === selected }" />
          </button>
        </AppTooltip>
        <DialogRoot v-if="previewable && !error && !previewError" v-model:open="expandedPreview">
          <AppTooltip :content="t('workspace.expandPreview')">
            <DialogTrigger as-child>
              <button class="workspace-action" :disabled="previewPending" :aria-label="t('workspace.expandPreview')">
                <AppIcon name="tabler:maximize" :size="16" />
              </button>
            </DialogTrigger>
          </AppTooltip>
          <DialogPortal>
            <DialogContent data-expanded-preview :aria-describedby="undefined" class="fixed inset-0 z-[70] flex h-dvh w-full flex-col overflow-hidden bg-agent-surface outline-none">
              <header class="flex h-11 shrink-0 items-center gap-2 border-b border-agent-border-soft px-3 text-agent-ink">
                <AppIcon :name="fileType.icon" :size="18" />
                <DialogTitle class="min-w-0 flex-1 truncate text-[13px] font-medium" :title="selected">
                  {{ selected.split('/').at(-1) }}
                </DialogTitle>
                <AppTooltip :content="t('workspace.downloadFile', { path: selected })">
                  <button class="workspace-action" :disabled="downloadPending || loading || !!error" :aria-busy="downloadPending && downloadTarget?.path === selected" :aria-label="t('workspace.downloadFile', { path: selected })" @click="download(selected)">
                    <AppIcon :name="downloadPending && downloadTarget?.path === selected ? 'tabler:loader-2' : 'tabler:download'" :size="17" :class="{ 'animate-spin motion-reduce:animate-none': downloadPending && downloadTarget?.path === selected }" />
                  </button>
                </AppTooltip>
                <AppTooltip :content="t('workspace.closeExpandedPreview')">
                  <DialogClose class="workspace-action" :aria-label="t('workspace.closeExpandedPreview')">
                    <AppIcon name="tabler:x" :size="17" />
                  </DialogClose>
                </AppTooltip>
              </header>
              <p v-if="downloadPending && downloadTarget" data-workspace-download-loading role="status" class="shrink-0 truncate px-3 py-2 text-xs text-agent-ink-muted">
                {{ t('workspace.downloading', { path: downloadTarget.path }) }}
              </p>
              <p v-if="downloadError" data-workspace-download-error role="alert" class="workspace-error">
                {{ downloadErrorText }}
                <button :disabled="downloadPending || loading || !!error" class="underline" @click="retryDownload">
                  {{ t('workspace.retryDownload', { path: downloadTarget?.path }) }}
                </button>
              </p>
              <HtmlPreviewPanel :code="code" :conversation-id="conversationId ?? undefined" interactive embedded @close="expandedPreview = false" />
            </DialogContent>
          </DialogPortal>
        </DialogRoot>
        <AppTooltip :content="t('workspace.close')">
          <button class="workspace-action" :aria-label="t('workspace.close')" @click="close">
            <AppIcon name="tabler:x" :size="17" />
          </button>
        </AppTooltip>
      </div>
    </header>
    <p v-if="error || previewError || snapshot?.lastError" data-workspace-preview-error role="alert" class="workspace-error">
      {{ error || previewError || snapshot?.lastError }}
      <button v-if="error || previewError" :disabled="previewPending || loading" class="underline" @click="error || !selected ? emit('refresh') : open(selected, mode === 'preview', expectedSha256)">
        {{ t('workspace.retry') }}
      </button>
    </p>
    <p v-if="downloadError" data-workspace-download-error role="alert" class="workspace-error">
      {{ downloadErrorText }}
      <button :disabled="downloadPending || loading || !!error" class="underline" @click="retryDownload">
        {{ t('workspace.retryDownload', { path: downloadTarget?.path }) }}
      </button>
    </p>
    <div class="workspace-body">
      <aside v-if="showTree" class="file-sidebar" :class="{ 'is-browser': !selected }" :aria-label="t('workspace.files')">
        <label class="file-search">
          <AppIcon name="tabler:search" :size="15" />
          <input v-model="search" type="search" :placeholder="t('workspace.search')" :aria-label="t('workspace.search')">
        </label>
        <div class="file-tree-heading">
          {{ t('workspace.files') }}
        </div>
        <div class="file-tree">
          <p v-if="!snapshot" class="workspace-empty">
            {{ t('workspace.loading') }}
          </p>
          <p v-else-if="!snapshot.configured && !snapshot.files.length" class="workspace-empty">
            {{ t('workspace.notConfigured') }}
          </p>
          <p v-else-if="!snapshot.files.length" class="workspace-empty">
            {{ t('workspace.empty') }}
          </p>
          <p v-else-if="!tree.length" class="workspace-empty">
            {{ t('workspace.noMatches') }}
          </p>
          <template v-else>
            <div class="tree-root">
              <AppIcon name="vscode-icons:default-folder-opened" :size="18" /><span>project</span>
            </div>
            <div v-for="entry in tree" :key="entry.path" class="tree-row" :class="{ 'is-selected': selected === entry.path }" :style="{ paddingLeft: `${10 + entry.depth * 14}px` }">
              <button v-if="entry.directory" class="tree-entry" :aria-label="entry.path" :aria-expanded="!!search.trim() || !collapsed.has(entry.path)" @click="toggleDirectory(entry.path)">
                <AppIcon :name="!search.trim() && collapsed.has(entry.path) ? 'tabler:chevron-right' : 'tabler:chevron-down'" :size="13" class="tree-arrow" />
                <AppIcon :name="!search.trim() && collapsed.has(entry.path) ? 'vscode-icons:default-folder' : 'vscode-icons:default-folder-opened'" :size="18" />
                <span>{{ entry.name }}</span>
              </button>
              <template v-else>
                <button class="tree-entry tree-file" :disabled="previewPending || loading || !!error" :title="entry.path" :aria-label="entry.path" :aria-current="selected === entry.path ? 'true' : undefined" @click="open(entry.path, true)">
                  <AppIcon :name="workspaceFileType(entry.path).icon" :size="17" />
                  <span>{{ entry.name }}</span>
                </button>
                <button class="workspace-action tree-download" :disabled="downloadPending || loading || !!error" :aria-busy="downloadPending && downloadTarget?.path === entry.path" :aria-label="t('workspace.downloadFile', { path: entry.path })" @click="download(entry.path)">
                  <AppIcon :name="downloadPending && downloadTarget?.path === entry.path ? 'tabler:loader-2' : 'tabler:download'" :size="14" :class="{ 'animate-spin motion-reduce:animate-none': downloadPending && downloadTarget?.path === entry.path }" />
                </button>
              </template>
            </div>
          </template>
        </div>
      </aside>
      <main v-if="selected || width >= 620" class="file-viewport" :aria-busy="contentLoading">
        <div v-if="contentLoading" data-workspace-content-loading class="workspace-placeholder workspace-loading" role="status">
          <div class="loading-balls" aria-hidden="true">
            <span v-for="n in 3" :key="`circle-${n}`" class="loading-circle" />
            <span v-for="n in 3" :key="`shadow-${n}`" class="loading-shadow" />
          </div>
          <span class="sr-only">{{ t('workspace.loading') }}</span>
        </div>
        <HtmlPreviewPanel v-if="!error && !previewError && mode === 'preview' && previewable" :inert="contentLoading || undefined" :code="code" :conversation-id="conversationId ?? undefined" interactive embedded @close="close" />
        <div v-else-if="!error && !previewError && markdown" data-workspace-markdown :inert="contentLoading || undefined" class="markdown-preview">
          <AgentMarkdownContent v-if="code" :key="selected" :text="code" />
        </div>
        <div v-else-if="!error && !previewError && selected && mode === 'code'" :inert="contentLoading || undefined" class="source-panel">
          <div class="source-header">
            <span>{{ fileType.label }} <span class="source-readonly">{{ t('workspace.readonly') }}</span></span>
            <div class="source-actions">
              <button v-if="canFormat" class="source-format" :disabled="formatting" @click="toggleFormat">
                <AppIcon :name="formatting ? 'tabler:loader-2' : 'tabler:source-code'" :size="15" :class="{ 'animate-spin motion-reduce:animate-none': formatting }" />
                {{ t(formatting ? 'workspace.formatting' : formattedCode !== undefined ? 'workspace.original' : 'workspace.format') }}
              </button>
              <AppTooltip :content="t('workspace.wrapLines')">
                <button class="workspace-action" :aria-label="t('workspace.wrapLines')" :aria-pressed="wrapLines" @click="wrapLines = !wrapLines">
                  <AppIcon name="tabler:text-wrap" :size="16" />
                </button>
              </AppTooltip>
              <AppTooltip :content="t(copied ? 'conversation.actions.codeBlock.copied' : 'conversation.actions.codeBlock.copy')">
                <button class="workspace-action" :aria-label="t(copied ? 'conversation.actions.codeBlock.copied' : 'conversation.actions.codeBlock.copy')" @click="copy(displayedCode)">
                  <AppIcon :name="copied ? 'tabler:check' : 'tabler:copy'" :size="16" />
                </button>
              </AppTooltip>
            </div>
          </div>
          <p v-if="formatError" class="workspace-error" role="alert">
            {{ formatError }}
          </p>
          <div data-workspace-source tabindex="0" class="source-scroll" :class="{ 'is-wrapped': wrapLines }">
            <pre v-if="sourceLines" class="source-lines"><code><span v-for="(line, index) in sourceLines" :key="index" class="source-row"><span class="source-gutter" aria-hidden="true">{{ index + 1 }}</span><span class="source-line" v-html="line || '&#8203;'" /></span></code></pre>
            <pre v-else class="source-plain"><code class="hljs" v-html="highlighted" /></pre>
          </div>
        </div>
        <div v-else-if="!contentLoading && !error && !previewError" class="workspace-placeholder">
          <AppIcon name="tabler:file-code" :size="28" /><p>{{ t('workspace.selectFile') }}</p>
        </div>
      </main>
    </div>
    <footer class="workspace-status">
      <span class="saved-version">{{ t('workspace.savedVersion', { n: snapshot?.revision ?? 0 }) }} · {{ (totalBytes / 1024).toFixed(1) }} KB</span>
      <span v-if="previewPending" class="status-loading">{{ t('workspace.loading') }}</span>
      <span v-if="downloadPending && downloadTarget" data-workspace-download-loading role="status" class="status-loading truncate" :title="downloadTarget.path">{{ t('workspace.downloading', { path: downloadTarget.path }) }}</span>
      <AppTooltip :content="t('workspace.interactiveNotice')">
        <span class="isolation-icon" :aria-label="t('workspace.interactiveNotice')"><AppIcon name="tabler:shield-lock" :size="14" /></span>
      </AppTooltip>
      <label class="environment-toggle"><input v-model="showEnvironment" type="checkbox" class="accent-agent-accent"><span>{{ t('workspace.environment') }}</span></label>
    </footer>
    <p v-if="showEnvironment" data-workspace-environment class="environment-status" aria-live="polite">
      {{ stateLabel }}
    </p>
  </section>
</template>

<style scoped>
.workspace-panel { display: flex; flex: 1; min-width: 0; min-height: 0; flex-direction: column; background: var(--agent-canvas); color: var(--agent-ink); }
.file-toolbar { display: flex; flex-shrink: 0; flex-wrap: wrap; align-items: center; gap: 6px 12px; min-height: 44px; padding: 6px 12px; border-bottom: 1px solid var(--agent-border-soft); background: var(--agent-surface); }
.file-title { display: flex; flex: 1; min-width: 100px; align-items: center; gap: 8px; }
.file-title h2 { overflow: hidden; margin: 0; font-size: 13px; font-weight: 500; text-overflow: ellipsis; white-space: nowrap; }
.file-title select { width: 100%; min-width: 0; background: transparent; color: var(--agent-ink); font-size: 13px; }
.file-title select:focus-visible { outline: 2px solid var(--agent-focus); outline-offset: 2px; }
.file-title option { background: var(--agent-surface); color: var(--agent-ink); }
.toolbar-actions { display: flex; flex-shrink: 0; align-items: center; gap: 3px; margin-left: auto; }
.workspace-action { display: grid; width: 28px; height: 28px; flex-shrink: 0; place-items: center; border-radius: 5px; color: var(--agent-ink-muted); }
.workspace-action:hover { background: var(--agent-surface-sunken); color: var(--agent-ink); }
.workspace-action:focus-visible, .view-switch button:focus-visible, .tree-entry:focus-visible { outline: 2px solid var(--agent-focus); outline-offset: -2px; }
.workspace-action:disabled, .tree-entry:disabled { opacity: 0.45; cursor: wait; }
.view-switch { display: inline-flex; gap: 2px; padding: 2px; border-radius: 6px; background: var(--agent-surface-sunken); }
.view-switch button { padding: 3px 9px; border-radius: 4px; color: var(--agent-ink-muted); font-size: 12px; }
.view-switch button[aria-pressed='true'] { background: var(--agent-surface-raised); color: var(--agent-ink); }
.workspace-body { display: flex; flex: 1; min-width: 0; min-height: 0; }
.file-sidebar { display: flex; width: 210px; max-width: 40%; flex-shrink: 0; flex-direction: column; border-right: 1px solid var(--agent-border-soft); background: var(--agent-sidebar); }
.file-search { display: flex; min-width: 0; align-items: center; gap: 7px; margin: 12px 10px 0; padding: 6px 8px; border: 1px solid var(--agent-border-soft); border-radius: 6px; background: var(--agent-surface-raised); color: var(--agent-ink-muted); }
.file-search:focus-within { outline: 2px solid var(--agent-focus); outline-offset: 1px; }
.file-search input { width: 100%; min-width: 0; outline: none; background: transparent; color: var(--agent-ink); font-size: 12px; }
.file-search input::placeholder { color: var(--agent-ink-muted); }
.file-tree-heading { padding: 12px 14px 6px; color: var(--agent-ink-muted); font-size: 11px; font-weight: 600; }
.file-tree { flex: 1; min-height: 0; overflow: auto; padding: 0 6px 12px; }
.tree-root, .tree-row { display: flex; min-height: 32px; align-items: center; gap: 6px; padding: 0 6px; border-radius: 6px; font-size: 12px; }
.tree-root { gap: 7px; color: var(--agent-ink-muted); }
.tree-row:hover { background: color-mix(in oklch, var(--agent-surface-sunken) 55%, transparent); }
.tree-row.is-selected { background: var(--agent-surface-sunken); color: var(--agent-ink); }
.tree-entry { display: flex; flex: 1; min-width: 0; min-height: 32px; align-items: center; gap: 6px; text-align: left; color: var(--agent-ink-soft); }
.tree-entry span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tree-file { padding-left: 15px; }
.tree-arrow { color: var(--agent-ink-faint); }
.tree-download { width: 22px; height: 24px; opacity: 0; }
.tree-row:hover .tree-download, .tree-row:focus-within .tree-download { opacity: 1; }
.file-viewport { position: relative; display: flex; flex: 1; min-width: 0; min-height: 0; flex-direction: column; overflow: hidden; }
.workspace-placeholder { display: grid; flex: 1; align-content: center; justify-items: center; gap: 12px; padding: 24px; color: var(--agent-ink-muted); text-align: center; font-size: 13px; }
.workspace-loading { --loading-cream: #c8a875; position: absolute; inset: 0; z-index: 1; background: var(--agent-canvas); }
.markdown-preview { flex: 1; min-height: 0; overflow: auto; padding: 20px 24px; }
.loading-balls { position: relative; z-index: 1; width: 200px; max-width: 100%; height: 60px; }
.loading-circle { position: absolute; top: 0; left: 15%; width: 20px; height: 20px; border-radius: 50%; background: var(--loading-cream); box-shadow: inset 0 0 0 1px rgb(124 96 52 / 0.12); transform-origin: 50%; animation: workspace-loading-circle 0.5s alternate infinite ease; }
.loading-circle:nth-child(2) { left: 45%; animation-delay: 0.2s; }
.loading-circle:nth-child(3) { right: 15%; left: auto; animation-delay: 0.3s; }
.loading-shadow { position: absolute; top: 62px; left: 15%; z-index: -1; width: 20px; height: 4px; border-radius: 50%; background: color-mix(in oklch, var(--loading-cream) 45%, transparent); filter: blur(1px); transform-origin: 50%; animation: workspace-loading-shadow 0.5s alternate infinite ease; }
.loading-shadow:nth-child(5) { left: 45%; animation-delay: 0.2s; }
.loading-shadow:nth-child(6) { right: 15%; left: auto; animation-delay: 0.3s; }
@keyframes workspace-loading-circle {
  0% { top: 60px; height: 5px; border-radius: 50px 50px 25px 25px; transform: scaleX(1.7); }
  40% { height: 20px; border-radius: 50%; transform: scaleX(1); }
  100% { top: 0; }
}
@keyframes workspace-loading-shadow {
  0% { transform: scaleX(1.5); }
  40% { transform: scaleX(1); opacity: 0.7; }
  100% { transform: scaleX(0.2); opacity: 0.4; }
}
@media (prefers-reduced-motion: reduce) {
  .loading-circle, .loading-shadow { animation: none; }
  .loading-circle { top: 20px; }
  .loading-shadow { transform: scaleX(0.7); opacity: 0.4; }
}
.workspace-empty { padding: 16px 8px; color: var(--agent-ink-muted); font-size: 12px; line-height: 1.7; }
.workspace-error { flex-shrink: 0; padding: 8px 12px; color: var(--agent-error); font-size: 12px; }
.workspace-status { display: flex; flex-shrink: 0; flex-wrap: wrap; align-items: center; gap: 6px 12px; padding: 6px 12px; border-top: 1px solid var(--agent-border-soft); background: var(--agent-surface); color: var(--agent-ink-muted); font-size: 11px; }
.saved-version { flex: 1; font-variant-numeric: tabular-nums; white-space: nowrap; }
.environment-toggle { display: inline-flex; flex-shrink: 0; align-items: center; gap: 5px; cursor: pointer; }
.environment-toggle input { width: 12px; height: 12px; }
.environment-status { padding: 6px 12px; background: var(--agent-surface); color: var(--agent-ink-muted); font-size: 11px; }
.isolation-icon { display: grid; place-items: center; }
.source-panel { --code-ink: #383a42; --code-keyword: #a626a4; --code-title: #4078f2; --code-string: #50a14f; --code-value: #986801; --code-tag: #e45649; --code-comment: #6d727d; --code-type: #c18401; --code-symbol: #0184bc; display: flex; flex: 1; min-width: 0; min-height: 0; flex-direction: column; background: #f4f4f5; }
[data-dark='true'] .source-panel { --code-ink: #abb2bf; --code-keyword: #c678dd; --code-title: #61afef; --code-string: #98c379; --code-value: #d19a66; --code-tag: #e06c75; --code-comment: #8b919c; --code-type: #e5c07b; --code-symbol: #56b6c2; background: #1e1e20; }
.source-header { display: flex; min-height: 38px; flex-shrink: 0; align-items: center; justify-content: space-between; padding: 0 16px; border-bottom: 1px solid var(--agent-border-soft); background: var(--agent-surface); color: var(--agent-ink-muted); font-size: 11px; }
.source-readonly { margin-left: 8px; font-family: var(--font-sans); font-weight: 400; }
.source-actions { display: flex; align-items: center; gap: 6px; }
.source-format { display: inline-flex; align-items: center; gap: 5px; padding: 4px 6px; border-radius: 4px; color: var(--agent-ink-muted); font-size: 12px; }
.source-format:hover, .source-actions [aria-pressed='true'] { background: var(--agent-surface-sunken); color: var(--agent-ink); }
.source-format:disabled { opacity: 0.5; cursor: wait; }
.source-format:focus-visible, .source-scroll:focus-visible { outline: 2px solid var(--agent-focus); outline-offset: -2px; }
.source-scroll { flex: 1; min-height: 0; overflow: auto; padding: 12px 0; color: var(--code-ink); font: 13px/22px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; tab-size: 2; }
.source-scroll pre { margin: 0; font: inherit; }
.source-lines { width: max-content; min-width: 100%; }
.source-row { display: grid; grid-template-columns: 52px minmax(0, 1fr); min-height: 22px; }
.source-row:hover { background: color-mix(in oklch, var(--agent-ink) 4%, transparent); }
.source-gutter { position: sticky; left: 0; padding: 0 12px 0 6px; border-right: 1px solid var(--agent-border-subtle); background: #f4f4f5; color: #6d727d; text-align: right; font-variant-numeric: tabular-nums; user-select: none; }
[data-dark='true'] .source-gutter { background: #1e1e20; color: #8b919c; }
.source-line { display: block; min-width: 0; padding: 0 16px; white-space: pre; }
.source-plain { padding: 0 16px; }
.is-wrapped .source-lines { width: 100%; }
.is-wrapped .source-line, .is-wrapped .source-plain { white-space: pre-wrap; overflow-wrap: anywhere; }
.source-panel :deep(.hljs) { color: var(--code-ink); background: transparent; }
.source-panel :deep(.hljs-comment), .source-panel :deep(.hljs-quote) { color: var(--code-comment); }
.source-panel :deep(.hljs-keyword), .source-panel :deep(.hljs-selector-tag) { color: var(--code-keyword); }
.source-panel :deep(.hljs-title), .source-panel :deep(.hljs-section) { color: var(--code-title); }
.source-panel :deep(.hljs-string), .source-panel :deep(.hljs-attribute) { color: var(--code-string); }
.source-panel :deep(.hljs-number), .source-panel :deep(.hljs-literal), .source-panel :deep(.hljs-attr) { color: var(--code-value); }
.source-panel :deep(.hljs-tag), .source-panel :deep(.hljs-name) { color: var(--code-tag); }
.source-panel :deep(.hljs-type), .source-panel :deep(.hljs-built_in) { color: var(--code-type); }
.source-panel :deep(.hljs-symbol), .source-panel :deep(.hljs-selector-id), .source-panel :deep(.hljs-selector-class) { color: var(--code-symbol); }
.workspace-panel.is-compact .file-sidebar.is-browser { width: 100%; max-width: none; border-right: 0; }
@media (hover: none) { .tree-download { opacity: 1; } }
</style>
