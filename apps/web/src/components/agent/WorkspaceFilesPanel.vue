<script setup lang="ts">
import type { WorkspaceSnapshot } from '@agent/contracts'
import { useElementSize } from '@vueuse/core'
import { DialogClose, DialogContent, DialogPortal, DialogRoot, DialogTitle, DialogTrigger } from 'reka-ui'
import { computed, onScopeDispose, provide, reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { getWorkspaceArchive } from '../../api/workspace'
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
const contentLoading = computed(() => mode.value === 'preview' && props.snapshot?.artifact ? false : previewPending.value || (props.loading && !props.snapshot))
const previewError = ref('')
const downloadPending = ref(false)
const downloadTarget = ref<{ path: string, revision: number }>()
let downloadController: AbortController | undefined
const downloadError = ref(false)
const downloadChanged = computed(() => !!downloadTarget.value && props.snapshot?.revision !== downloadTarget.value.revision)
const downloadErrorText = computed(() => downloadTarget.value ? t(downloadChanged.value ? 'workspace.downloadChanged' : 'workspace.downloadFailed', { path: downloadTarget.value.path }) : '')
const search = ref('')
const collapsed = reactive(new Set<string>())
let previewRequest = 0
let downloadRequest = 0
let expectedSha256: string | undefined
let shownSha256: string | undefined
let pendingSha256: string | undefined
const totalBytes = computed(() => props.snapshot?.files.reduce((sum, file) => sum + file.bytes, 0) ?? 0)
const selectedFile = computed(() => props.snapshot?.files.find(file => file.path === selected.value))
const metaSizeText = computed(() => {
  if (selectedFile.value) {
    const kb = (selectedFile.value.bytes / 1024).toFixed(1)
    if (code.value)
      return `${kb} KB · ${t('workspace.characters', { n: code.value.length.toLocaleString() })}`
    return `${kb} KB`
  }
  return `${(totalBytes.value / 1024).toFixed(1)} KB`
})
const previewable = computed(() => !!props.snapshot?.artifact || (!props.snapshot?.webProject && selected.value.toLowerCase().endsWith('.html') && isPreviewableHtml(code.value, 'html')))
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
  downloadController?.abort()
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
const showTree = computed(() => width.value >= 620 || (!selected.value && (mode.value !== 'preview' || !props.snapshot?.artifact)))
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
    // 归档固定整个 Source revision，任何变版都不能切换下载目标。
    downloadController?.abort()
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
        void open(selected.value, mode.value === 'preview', expectedSha256, mode.value === 'preview' && !!props.snapshot.artifact)
    }
    else {
      previewRequest++
      selected.value = ''
      code.value = ''
      shownSha256 = undefined
      if (!props.snapshot.artifact)
        mode.value = 'code'
      previewPending.value = false
      previewError.value = ''
    }
    return
  }
  if (props.autoPreview !== false && props.snapshot.artifact && !autoPreviewed) {
    autoPreviewed = true
    const source = props.snapshot.files.find(file => file.path === 'src/App.tsx') ?? props.snapshot.files[0]
    if (source) {
      void open(source.path, false, undefined, true)
    }
    else { mode.value = 'preview' }
    return
  }
  const html = !props.snapshot.webProject && props.snapshot.files.find(file => file.path.toLowerCase().endsWith('.html'))
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

async function open(path: string, preview = false, sha256?: string, artifactPreview = false) {
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
  mode.value = artifactPreview || (preview && !props.snapshot?.webProject && path.toLowerCase().endsWith('.html')) ? 'preview' : 'code'
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
      mode.value = artifactPreview || (preview && !props.snapshot?.webProject && previewable.value) ? 'preview' : 'code'
      return
    }
    const result = cached ?? await props.readFile(path, sha256)
    if (current !== previewRequest)
      return
    shownSha256 = props.snapshot?.files.find(file => file.path === path)?.sha256
    code.value = result.text
    mode.value = artifactPreview || (preview && !props.snapshot?.webProject && path.toLowerCase().endsWith('.html') && isPreviewableHtml(result.text, 'html')) ? 'preview' : 'code'
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

async function download(revision = props.snapshot?.revision) {
  const id = props.conversationId
  if (downloadPending.value || props.loading || props.error || !id || revision === undefined)
    return
  const current = ++downloadRequest
  downloadController?.abort()
  downloadController = new AbortController()
  const target = { path: `project-v${revision}.zip`, revision }
  downloadTarget.value = target
  downloadError.value = false
  downloadPending.value = true
  try {
    if (downloadChanged.value)
      throw new Error('源码版本已失效')
    const bytes = await getWorkspaceArchive(id, revision, downloadController.signal)
    if (current !== downloadRequest)
      return
    if (props.error || downloadChanged.value || id !== props.conversationId)
      throw new Error('源码归档身份已失效')
    const url = URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'application/zip' }))
    const link = document.createElement('a')
    link.href = url
    link.download = target.path
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
  if (downloadTarget.value)
    void download(downloadTarget.value.revision)
}
</script>

<template>
  <section ref="panel" data-workspace-files-panel class="workspace-panel" :class="{ 'is-compact': width < 620 }" :data-dark="workspaceTheme === 'olive-ember'" @keydown.esc.stop="close">
    <header class="file-toolbar">
      <div class="file-header-left">
        <div class="file-title" :title="t('workspace.files')">
          <AppIcon name="vscode-icons:default-folder-opened" :size="18" class="shrink-0" />
          <select v-if="width < 620 && selected && (snapshot?.files.length ?? 0) > 1" :value="selected" :disabled="previewPending || loading || !!error" :aria-label="t('workspace.chooseFile')" @change="open(($event.target as HTMLSelectElement).value, true)">
            <option v-for="file in snapshot?.files" :key="file.path" :value="file.path">
              {{ file.path }}
            </option>
          </select>
          <h2 v-else>
            {{ t('workspace.files') }}
          </h2>
        </div>
        <span
          v-if="downloadPending && downloadTarget"
          data-workspace-download-loading
          role="status"
          class="meta-downloading truncate"
          :title="downloadTarget.path"
        >
          <AppIcon name="tabler:loader-2" :size="12" class="animate-spin motion-reduce:animate-none shrink-0" />
          <span class="truncate">{{ t('workspace.downloading', { path: downloadTarget.path }) }}</span>
        </span>
      </div>
      <div class="toolbar-actions">
        <div v-if="(selected && !markdown) || snapshot?.artifact" class="view-switch" :aria-label="t('workspace.viewMode')" role="group">
          <button :aria-pressed="mode === 'code'" @click="mode = 'code'">
            {{ t('workspace.code') }}
          </button>
          <button v-if="previewable" :aria-pressed="mode === 'preview'" @click="mode = 'preview'">
            {{ t('workspace.preview') }}
          </button>
        </div>
        <div v-if="selected && !markdown" class="toolbar-divider" />
        <span class="saved-version">
          {{ t('workspace.savedVersion', { n: snapshot?.revision ?? 0 }) }}
        </span>
        <button class="workspace-action" :disabled="loading" :title="t('workspace.refresh')" :aria-label="t('workspace.refresh')" @click="emit('refresh')">
          <AppIcon name="tabler:refresh" :size="16" :class="{ 'animate-spin motion-reduce:animate-none': loading }" />
        </button>
        <button v-if="snapshot?.files.length" class="workspace-action" :disabled="downloadPending || loading || !!error" :aria-busy="downloadPending" :title="t('workspace.downloadProject')" :aria-label="t('workspace.downloadProject')" @click="download()">
          <AppIcon :name="downloadPending ? 'tabler:loader-2' : 'tabler:download'" :size="16" :class="{ 'animate-spin motion-reduce:animate-none': downloadPending }" />
        </button>
        <DialogRoot v-if="previewable && (snapshot?.artifact || (!error && !previewError))" v-model:open="expandedPreview">
          <DialogTrigger as-child>
            <button class="workspace-action" :disabled="previewPending && !snapshot?.artifact" :title="t('workspace.expandPreview')" :aria-label="t('workspace.expandPreview')">
              <AppIcon name="tabler:maximize" :size="16" />
            </button>
          </DialogTrigger>
          <DialogPortal>
            <DialogContent data-expanded-preview :aria-describedby="undefined" class="fixed inset-0 z-[70] flex h-dvh w-full flex-col overflow-hidden bg-agent-surface outline-none">
              <header class="flex h-11 shrink-0 items-center gap-2 border-b border-agent-border-soft px-3 text-agent-ink">
                <AppIcon :name="fileType.icon" :size="18" />
                <DialogTitle class="min-w-0 flex-1 truncate text-[13px] font-medium" :title="selected">
                  {{ snapshot?.artifact ? t('workspace.buildPreview') : selected.split('/').at(-1) }}
                </DialogTitle>
                <button class="workspace-action" :disabled="downloadPending || loading || !!error || !snapshot?.files.length" :aria-busy="downloadPending" :title="t('workspace.downloadProject')" :aria-label="t('workspace.downloadProject')" @click="download()">
                  <AppIcon :name="downloadPending ? 'tabler:loader-2' : 'tabler:download'" :size="17" :class="{ 'animate-spin motion-reduce:animate-none': downloadPending }" />
                </button>
                <DialogClose class="workspace-action" :title="t('workspace.closeExpandedPreview')" :aria-label="t('workspace.closeExpandedPreview')">
                  <AppIcon name="tabler:x" :size="17" />
                </DialogClose>
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
              <HtmlPreviewPanel :code="code" :artifact-id="snapshot?.artifact?.id" :conversation-id="conversationId ?? undefined" interactive embedded @close="expandedPreview = false" />
            </DialogContent>
          </DialogPortal>
        </DialogRoot>
        <button class="workspace-action" :title="t('workspace.close')" :aria-label="t('workspace.close')" @click="close">
          <AppIcon name="tabler:x" :size="17" />
        </button>
      </div>
    </header>
    <p v-if="error || previewError || snapshot?.lastError" data-workspace-preview-error role="alert" class="workspace-error">
      {{ error || previewError || snapshot?.lastError }}
      <button v-if="error || previewError" :disabled="previewPending || loading" class="underline" @click="error || !selected ? emit('refresh') : open(selected, mode === 'preview', expectedSha256, mode === 'preview' && !!snapshot?.artifact)">
        {{ t('workspace.retry') }}
      </button>
    </p>
    <p v-if="downloadError" data-workspace-download-error role="alert" class="workspace-error">
      {{ downloadErrorText }}
      <button :disabled="downloadPending || loading || !!error" class="underline" @click="retryDownload">
        {{ t('workspace.retryDownload', { path: downloadTarget?.path }) }}
      </button>
    </p>
    <p v-if="mode === 'preview' && snapshot?.artifact" class="px-3 py-1 text-xs text-agent-ink-muted" data-build-identity>
      {{ t('workspace.buildVersion', { n: snapshot.artifact.sourceRevision }) }} · {{ snapshot.artifact.id.slice(0, 8) }}
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
            <div v-for="entry in tree" :key="entry.path" class="tree-row" :class="{ 'is-selected': selected === entry.path }" :style="{ paddingLeft: `${6 + entry.depth * 12}px` }">
              <button v-if="entry.directory" class="tree-entry" :aria-label="entry.path" :aria-expanded="!!search.trim() || !collapsed.has(entry.path)" @click="toggleDirectory(entry.path)">
                <AppIcon :name="!search.trim() && collapsed.has(entry.path) ? 'tabler:chevron-right' : 'tabler:chevron-down'" :size="12" class="tree-arrow shrink-0" />
                <AppIcon :name="!search.trim() && collapsed.has(entry.path) ? 'vscode-icons:default-folder' : 'vscode-icons:default-folder-opened'" :size="15" class="shrink-0" />
                <span>{{ entry.name }}</span>
              </button>
              <template v-else>
                <button class="tree-entry tree-file" :disabled="previewPending || loading || !!error" :title="entry.path" :aria-label="entry.path" :aria-current="selected === entry.path ? 'true' : undefined" @click="open(entry.path, true)">
                  <AppIcon :name="workspaceFileType(entry.path).icon" :size="15" class="shrink-0" />
                  <span>{{ entry.name }}</span>
                </button>
              </template>
            </div>
          </template>
        </div>
      </aside>
      <main v-if="selected || width >= 620 || (mode === 'preview' && snapshot?.artifact)" class="file-viewport" :aria-busy="contentLoading">
        <div v-if="contentLoading" data-workspace-content-loading class="workspace-placeholder workspace-loading" role="status">
          <div class="loading-balls" aria-hidden="true">
            <span v-for="n in 3" :key="`circle-${n}`" class="loading-circle" />
            <span v-for="n in 3" :key="`shadow-${n}`" class="loading-shadow" />
          </div>
          <span class="sr-only">{{ t('workspace.loading') }}</span>
        </div>
        <HtmlPreviewPanel v-if="mode === 'preview' && previewable && (snapshot?.artifact || (!error && !previewError))" :inert="contentLoading || undefined" :code="code" :artifact-id="snapshot?.artifact?.id" :conversation-id="conversationId ?? undefined" interactive embedded @close="close" />
        <div v-else-if="!error && !previewError && markdown" data-workspace-markdown :inert="contentLoading || undefined" class="markdown-preview">
          <AgentMarkdownContent v-if="code" :key="selected" :text="code" />
        </div>
        <div v-else-if="!error && !previewError && selected && mode === 'code'" :inert="contentLoading || undefined" class="source-panel">
          <div class="source-header">
            <div class="source-file-info">
              <AppIcon :name="fileType.icon" :size="15" class="shrink-0" />
              <span class="source-filename" :title="selected">{{ selected.split('/').at(-1) }}</span>
              <span class="source-tag">{{ fileType.label }}</span>
              <span class="source-readonly">{{ t('workspace.readonly') }}</span>
              <template v-if="metaSizeText">
                <span class="source-sep">·</span>
                <span class="source-meta">{{ metaSizeText }}</span>
              </template>
            </div>
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
          <p v-if="formatError || (fileFormatParser(selected) && !canFormat)" class="workspace-error" role="status">
            {{ formatError || t('workspace.formatLarge') }}
          </p>
          <div data-workspace-source tabindex="0" class="source-scroll" :class="{ 'is-wrapped': wrapLines }">
            <pre v-if="sourceLines" class="source-lines"><code><span v-for="(line, index) in sourceLines" :key="index" class="source-row"><span class="source-gutter" aria-hidden="true">{{ index + 1 }}</span><span class="source-line" v-html="line || '&#8203;'" /></span></code></pre>
            <pre v-else class="source-plain"><code class="hljs" v-html="highlighted" /></pre>
          </div>
        </div>
        <div v-else-if="!contentLoading && !error && !previewError && !snapshot?.files.length" class="workspace-empty-stage workspace-empty-state" role="status">
          <div class="stage-ambient-glow" aria-hidden="true" />
          <div class="stage-card-stack" aria-hidden="true">
            <div class="stack-card card-back">
              <span class="card-line card-line-sm" />
              <span class="card-line card-line-md" />
              <span class="card-line card-line-lg" />
            </div>
            <div class="stack-card card-middle">
              <div class="card-browser-bar">
                <span class="browser-dot" />
                <span class="browser-dot" />
                <span class="browser-dot" />
              </div>
              <div class="card-wireframe" />
            </div>
            <div class="stack-card card-front">
              <div class="card-chip">
                WORKSPACE
              </div>
              <div class="card-icon-wrap is-workspace">
                <AppIcon name="tabler:sparkles" :size="30" class="card-icon" />
              </div>
              <div class="card-preview-lines" aria-hidden="true">
                <span class="preview-line preview-line-1" />
                <span class="preview-line preview-line-2" />
              </div>
            </div>
          </div>
          <div class="stage-content">
            <h3 class="stage-title empty-title">
              {{ t('workspace.emptyTitle') }}
            </h3>
            <p class="stage-desc empty-desc">
              {{ t('workspace.empty') }}
            </p>
            <div class="stage-hint-pill">
              <AppIcon name="tabler:sparkles" :size="13" class="hint-icon" />
              <span>{{ t('workspace.emptyHint') }}</span>
            </div>
          </div>
        </div>
        <div v-else-if="!contentLoading && !error && !previewError" class="workspace-empty-stage workspace-empty-state is-select-file" role="status">
          <div class="stage-ambient-glow" aria-hidden="true" />
          <div class="stage-card-stack" aria-hidden="true">
            <div class="stack-card card-back">
              <span class="card-line card-line-sm" />
              <span class="card-line card-line-md" />
              <span class="card-line card-line-lg" />
            </div>
            <div class="stack-card card-middle">
              <div class="card-browser-bar">
                <span class="browser-dot" />
                <span class="browser-dot" />
                <span class="browser-dot" />
              </div>
              <div class="card-wireframe" />
            </div>
            <div class="stack-card card-front">
              <div class="card-chip">
                PREVIEW
              </div>
              <div class="card-icon-wrap is-preview">
                <AppIcon name="tabler:device-desktop-code" :size="30" class="card-icon" />
              </div>
              <div class="card-preview-lines" aria-hidden="true">
                <span class="preview-line preview-line-1" />
                <span class="preview-line preview-line-2" />
              </div>
            </div>
          </div>
          <div class="stage-content">
            <h3 class="stage-title empty-title">
              {{ t('workspace.selectFileTitle') }}
            </h3>
            <p class="stage-desc empty-desc">
              {{ t('workspace.selectFileDesc') }}
            </p>
            <div class="stage-hint-pill">
              <AppIcon name="tabler:layout-sidebar-left-collapse" :size="13" class="hint-icon" />
              <span>{{ t('workspace.selectFileHint') }}</span>
            </div>
          </div>
        </div>
      </main>
    </div>
  </section>
</template>

<style scoped>
.workspace-panel {
  display: flex;
  flex: 1;
  min-width: 0;
  min-height: 0;
  flex-direction: column;
  padding: 0;
  gap: 0;
  background: var(--agent-surface);
  color: var(--agent-ink);
  overflow: hidden;
}
.file-toolbar {
  display: flex;
  flex-shrink: 0;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-height: 44px;
  padding: 6px 14px;
  border-bottom: 1px solid var(--agent-border-soft);
  background: color-mix(in oklch, var(--agent-surface) 96%, transparent);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  z-index: 10;
}
:global([data-agent-workspace-theme='olive-ember']) .file-toolbar {
  background: color-mix(in oklch, var(--agent-surface) 92%, transparent);
  border-bottom-color: rgba(255, 255, 255, 0.08);
}
.file-header-left {
  display: flex;
  min-width: 0;
  flex: 1;
  align-items: center;
  gap: 10px;
}
.file-title {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 100px;
}
.file-title h2 {
  overflow: hidden;
  margin: 0;
  font-size: 13.5px;
  font-weight: 600;
  letter-spacing: -0.01em;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--agent-ink);
}
.file-title select {
  width: 100%;
  min-width: 100px;
  background: transparent;
  color: var(--agent-ink);
  font-size: 13px;
  font-weight: 500;
  border: none;
  outline: none;
}
.file-title select:focus-visible {
  outline: 2px solid var(--agent-focus);
  outline-offset: 2px;
}
.file-title option {
  background: var(--agent-surface);
  color: var(--agent-ink);
}
.saved-version {
  display: inline-flex;
  align-items: center;
  font-size: 11.5px;
  color: var(--agent-ink-muted);
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
  padding: 0 4px;
}
.meta-downloading {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 2px 8px;
  border-radius: 9999px;
  background: color-mix(in oklch, var(--agent-accent) 12%, transparent);
  color: var(--agent-accent);
  font-size: 11px;
  font-weight: 500;
  max-width: 220px;
}
.workspace-panel.is-compact .file-toolbar {
  padding: 6px 10px;
  gap: 6px;
}
.workspace-panel.is-compact .file-header-left {
  flex-basis: 100%;
  gap: 6px;
}
.workspace-panel.is-compact .file-title {
  min-width: 0;
  max-width: 100%;
}
.workspace-panel.is-compact .file-title select {
  min-width: 0;
}
.workspace-panel.is-compact .saved-version {
  font-size: 11px;
}
.workspace-panel.is-compact .toolbar-divider {
  display: none;
}
.toolbar-actions {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  gap: 3px;
  margin-left: auto;
}
.toolbar-divider {
  width: 1px;
  height: 16px;
  background: var(--agent-border-soft);
  margin: 0 4px;
}
.workspace-action {
  display: grid;
  width: 28px;
  height: 28px;
  flex-shrink: 0;
  place-items: center;
  border-radius: 6px;
  color: var(--agent-ink-muted);
  transition: all 0.16s ease;
}
.workspace-action:hover {
  background: var(--agent-surface-sunken);
  color: var(--agent-ink);
}
.workspace-action:focus-visible, .view-switch button:focus-visible, .tree-entry:focus-visible {
  outline: 2px solid var(--agent-focus);
  outline-offset: -2px;
}
.workspace-action:disabled, .tree-entry:disabled {
  opacity: 0.45;
  cursor: wait;
}
.view-switch {
  display: inline-flex;
  gap: 2px;
  padding: 2px;
  border-radius: 6px;
  background: var(--agent-surface-sunken);
}
.view-switch button {
  padding: 3px 9px;
  border-radius: 4px;
  color: var(--agent-ink-muted);
  font-size: 11.5px;
  font-weight: 500;
  transition: all 0.16s ease;
}
.view-switch button[aria-pressed='true'] {
  background: var(--agent-surface-raised);
  color: var(--agent-ink);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.06);
}
.workspace-body {
  display: flex;
  flex: 1;
  min-width: 0;
  min-height: 0;
  gap: 0;
}
.file-sidebar {
  display: flex;
  width: 220px;
  max-width: 38%;
  flex-shrink: 0;
  flex-direction: column;
  border-right: 1px solid var(--agent-border-soft);
  background: color-mix(in oklch, var(--agent-sidebar) 85%, transparent);
  overflow: hidden;
}
:global([data-agent-workspace-theme='olive-ember']) .file-sidebar {
  background: color-mix(in oklch, var(--agent-sidebar) 75%, transparent);
  border-right-color: rgba(255, 255, 255, 0.07);
}
.file-search {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 7px;
  margin: 10px 10px 4px;
  padding: 6px 10px;
  border: 1px solid var(--agent-border-soft);
  border-radius: 8px;
  background: var(--agent-surface);
  color: var(--agent-ink-muted);
  transition: all 0.2s ease;
}
.file-search:focus-within {
  background: var(--agent-surface-raised);
  border-color: color-mix(in oklch, var(--agent-accent) 40%, var(--agent-border-soft));
  box-shadow: 0 0 0 2px color-mix(in oklch, var(--agent-accent) 15%, transparent);
  color: var(--agent-ink);
}
.file-search input {
  width: 100%;
  min-width: 0;
  outline: none;
  background: transparent;
  color: var(--agent-ink);
  font-size: 12px;
}
.file-search input::placeholder {
  color: var(--agent-ink-faint);
}
.file-tree-heading {
  padding: 8px 12px 4px;
  color: var(--agent-ink-faint);
  font-size: 10.5px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.file-tree {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 3px 4px 10px;
}
.tree-row {
  display: flex;
  height: 24px;
  min-height: 24px;
  align-items: center;
  gap: 4px;
  padding: 0 4px;
  border-radius: 4px;
  font-size: 12px;
  margin: 1px 0;
  transition: background-color 0.12s ease;
  user-select: none;
}
.tree-row:hover {
  background: color-mix(in oklch, var(--agent-ink) 5%, transparent);
}
:global([data-agent-workspace-theme='olive-ember']) .tree-row:hover {
  background: rgba(255, 255, 255, 0.05);
}
.tree-row.is-selected {
  background: color-mix(in oklch, var(--agent-ink) 8%, transparent);
  color: var(--agent-ink);
  box-shadow: none;
}
:global([data-agent-workspace-theme='olive-ember']) .tree-row.is-selected {
  background: rgba(255, 255, 255, 0.1);
  color: #fff;
}
.tree-entry {
  display: flex;
  flex: 1;
  min-width: 0;
  height: 100%;
  align-items: center;
  gap: 5px;
  text-align: left;
  color: var(--agent-ink-soft);
  font-size: 12px;
  line-height: 24px;
}
.tree-row.is-selected .tree-entry {
  color: var(--agent-ink);
  font-weight: 500;
}
:global([data-agent-workspace-theme='olive-ember']) .tree-row.is-selected .tree-entry {
  color: #fff;
}
.tree-entry span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tree-file {
  padding-left: 17px;
}
.tree-arrow {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 12px;
  height: 12px;
  color: var(--agent-ink-faint);
  transition: transform 0.12s ease;
}
.file-viewport {
  position: relative;
  display: flex;
  flex: 1;
  min-width: 0;
  min-height: 0;
  flex-direction: column;
  background: var(--agent-surface);
  overflow: hidden;
}
.workspace-placeholder { display: grid; flex: 1; align-content: center; justify-items: center; gap: 12px; padding: 24px; color: var(--agent-ink-muted); text-align: center; font-size: 13px; }
.workspace-loading { --loading-cream: #c8a875; position: absolute; inset: 0; z-index: 1; background: var(--agent-canvas); }
.markdown-preview {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 16px 20px;
}
.markdown-preview :deep(.agent-markdown-content) {
  font-size: 13px !important;
  line-height: 1.6;
}
.markdown-preview :deep(.agent-markdown-prose + .agent-markdown-prose) {
  margin-top: 0.75rem;
}
.markdown-preview :deep(p + p) {
  margin-top: 0.75rem;
}
.markdown-preview :deep(ol),
.markdown-preview :deep(ul) {
  margin: 0.75rem 0 0;
  padding-left: 1.25rem;
}
.markdown-preview :deep(li) {
  margin-top: 0.35rem;
}
.markdown-preview :deep(h1),
.markdown-preview :deep(h2),
.markdown-preview :deep(h3),
.markdown-preview :deep(h4) {
  margin: 1rem 0 0.4rem;
}
.markdown-preview :deep(.agent-code-pre) {
  font-size: 12px;
  line-height: 1.55;
}
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
  .loading-circle, .loading-shadow, .stage-card-stack { animation: none !important; }
  .loading-circle { top: 20px; }
  .loading-shadow { transform: scaleX(0.7); opacity: 0.4; }
  .stage-card-stack:hover .card-back,
  .stage-card-stack:hover .card-middle,
  .stage-card-stack:hover .card-front { transform: none !important; }
}
.workspace-empty-stage { position: relative; display: flex; flex: 1; min-width: 0; min-height: 0; flex-direction: column; align-items: center; justify-content: center; padding: 40px 24px; text-align: center; user-select: none; overflow: hidden; border-radius: inherit; }
.stage-ambient-glow { position: absolute; top: 42%; left: 50%; width: 280px; height: 180px; transform: translate(-50%, -50%); border-radius: 50%; pointer-events: none; opacity: 0.85; filter: blur(48px); background: radial-gradient(ellipse at center, color-mix(in oklch, var(--agent-accent) 22%, transparent) 0%, transparent 72%); transition: opacity 0.3s ease; }
.stage-card-stack { position: relative; width: 172px; height: 124px; margin-bottom: 22px; perspective: 600px; cursor: default; animation: stage-float 6s ease-in-out infinite; }
.stack-card { position: absolute; border-radius: 12px; transition: transform 0.4s cubic-bezier(0.16, 1, 0.3, 1), box-shadow 0.4s ease, border-color 0.3s ease; will-change: transform; }
.card-back { width: 148px; height: 96px; top: 14px; left: 12px; background: color-mix(in oklch, var(--agent-surface-raised) 70%, var(--agent-surface-sunken)); border: 1px solid var(--agent-border-soft); box-shadow: 0 4px 14px -3px rgb(0 0 0 / 0.05); transform: translate(-16px, 4px) rotate(-8deg); z-index: 1; display: flex; flex-direction: column; gap: 7px; padding: 14px 12px; }
.card-line { height: 5px; border-radius: 3px; background: color-mix(in oklch, var(--agent-ink) 12%, transparent); }
.card-line-sm { width: 35%; }
.card-line-md { width: 68%; }
.card-line-lg { width: 85%; }
.card-middle { width: 152px; height: 100px; top: 12px; left: 10px; background: color-mix(in oklch, var(--agent-surface) 80%, var(--agent-surface-raised)); border: 1px solid var(--agent-border-soft); box-shadow: 0 6px 18px -4px rgb(0 0 0 / 0.07); transform: translate(14px, -2px) rotate(6deg); z-index: 2; padding: 8px 10px; display: flex; flex-direction: column; gap: 8px; }
.card-browser-bar { display: flex; gap: 4px; align-items: center; padding-bottom: 6px; border-bottom: 1px solid var(--agent-border-subtle); }
.browser-dot { width: 5px; height: 5px; border-radius: 50%; background: color-mix(in oklch, var(--agent-ink) 18%, transparent); }
.card-wireframe { flex: 1; border-radius: 4px; border: 1px dashed color-mix(in oklch, var(--agent-ink) 12%, transparent); background: color-mix(in oklch, var(--agent-surface-sunken) 40%, transparent); }
.card-front { width: 158px; height: 108px; top: 8px; left: 7px; background: var(--agent-surface-raised); border: 1px solid var(--agent-border-soft); box-shadow: 0 16px 32px -8px rgb(0 0 0 / 0.1), 0 4px 12px -2px rgb(0 0 0 / 0.04), inset 0 1px 0 rgb(255 255 255 / 0.8); transform: translate(0, 0); z-index: 3; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px; padding: 10px; }
.card-chip { position: absolute; top: 6px; left: 8px; font-size: 8.5px; font-weight: 700; letter-spacing: 0.08em; padding: 1.5px 6px; border-radius: 4px; background: color-mix(in oklch, var(--agent-accent) 12%, transparent); color: var(--agent-accent); }
.card-icon-wrap { display: flex; align-items: center; justify-content: center; color: color-mix(in oklch, var(--agent-accent) 72%, transparent); margin-bottom: 2px; }
.card-icon { flex-shrink: 0; filter: drop-shadow(0 2px 6px color-mix(in oklch, var(--agent-accent) 15%, transparent)); }
.card-preview-lines { display: flex; flex-direction: column; align-items: center; gap: 3.5px; margin-top: 1px; }
.preview-line { height: 3px; border-radius: 2px; background: color-mix(in oklch, var(--agent-ink) 14%, transparent); }
.preview-line-1 { width: 48px; }
.preview-line-2 { width: 28px; opacity: 0.65; }
.stage-card-stack:hover .card-back { transform: translate(-26px, 8px) rotate(-14deg); box-shadow: 0 8px 20px -4px rgb(0 0 0 / 0.1); }
.stage-card-stack:hover .card-middle { transform: translate(24px, -4px) rotate(12deg); box-shadow: 0 10px 24px -5px rgb(0 0 0 / 0.12); }
.stage-card-stack:hover .card-front { transform: translateY(-4px) scale(1.03); box-shadow: 0 22px 40px -10px rgb(0 0 0 / 0.15), 0 6px 16px -2px rgb(0 0 0 / 0.06), inset 0 1px 0 rgb(255 255 255 / 0.9); }
.stage-content { display: flex; flex-direction: column; align-items: center; gap: 6px; max-width: 320px; z-index: 2; }
.stage-title { margin: 0; font-size: 14.5px; font-weight: 600; line-height: 1.4; letter-spacing: -0.01em; color: var(--agent-ink); }
.stage-desc { margin: 0; font-size: 12.5px; line-height: 1.55; color: var(--agent-ink-muted); }
.stage-hint-pill { display: inline-flex; align-items: center; gap: 6px; margin-top: 10px; padding: 5px 12px; border-radius: 9999px; border: 1px solid var(--agent-border-soft); background: var(--agent-surface-raised); color: var(--agent-ink-muted); font-size: 11.5px; font-weight: 450; box-shadow: 0 1px 3px 0 rgb(0 0 0 / 0.03); transition: all 0.2s ease; }
.stage-hint-pill:hover { border-color: color-mix(in oklch, var(--agent-accent) 40%, var(--agent-border-soft)); color: var(--agent-ink); }
.hint-icon { flex-shrink: 0; color: var(--agent-accent); }
:global([data-agent-workspace-theme='olive-ember']) .stage-ambient-glow { background: radial-gradient(ellipse at center, color-mix(in oklch, var(--agent-accent) 26%, transparent) 0%, transparent 72%); opacity: 0.95; filter: blur(52px); }
:global([data-agent-workspace-theme='olive-ember']) .card-back { background: color-mix(in oklch, var(--agent-surface) 90%, black); border-color: color-mix(in oklch, var(--agent-border-soft) 80%, transparent); box-shadow: 0 8px 24px -4px rgb(0 0 0 / 0.5); }
:global([data-agent-workspace-theme='olive-ember']) .card-middle { background: color-mix(in oklch, var(--agent-surface-raised) 70%, var(--agent-surface)); border-color: color-mix(in oklch, var(--agent-border-soft) 90%, transparent); box-shadow: 0 12px 30px -6px rgb(0 0 0 / 0.6); }
:global([data-agent-workspace-theme='olive-ember']) .card-front { background: linear-gradient(160deg, color-mix(in oklch, var(--agent-surface-raised) 95%, white 5%), var(--agent-surface-raised)); border-color: color-mix(in oklch, var(--agent-accent) 25%, var(--agent-border-soft)); box-shadow: 0 20px 42px -10px rgb(0 0 0 / 0.7), 0 4px 12px -2px rgb(0 0 0 / 0.4), inset 0 1px 0 rgb(255 255 255 / 0.12); }
:global([data-agent-workspace-theme='olive-ember']) .card-icon { filter: drop-shadow(0 2px 8px color-mix(in oklch, var(--agent-accent) 45%, transparent)); }
:global([data-agent-workspace-theme='olive-ember']) .preview-line { background: color-mix(in oklch, var(--agent-ink) 22%, transparent); }
:global([data-agent-workspace-theme='olive-ember']) .stage-hint-pill { background: color-mix(in oklch, var(--agent-surface-raised) 80%, transparent); border-color: var(--agent-border-soft); box-shadow: 0 2px 8px -2px rgb(0 0 0 / 0.3), inset 0 1px 0 rgb(255 255 255 / 0.05); }
@keyframes stage-float { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-5px); } }
.workspace-empty { padding: 16px 8px; color: var(--agent-ink-muted); font-size: 12px; line-height: 1.7; }
.workspace-error { flex-shrink: 0; padding: 6px 12px; color: var(--agent-error); font-size: 12px; background: color-mix(in oklch, var(--agent-error) 8%, transparent); border-bottom: 1px solid color-mix(in oklch, var(--agent-error) 20%, transparent); }

.source-panel { --code-ink: #383a42; --code-keyword: #a626a4; --code-title: #4078f2; --code-string: #50a14f; --code-value: #986801; --code-tag: #e45649; --code-comment: #6d727d; --code-type: #c18401; --code-symbol: #0184bc; display: flex; flex: 1; min-width: 0; min-height: 0; flex-direction: column; background: #f4f4f5; }
[data-dark='true'] .source-panel { --code-ink: #abb2bf; --code-keyword: #c678dd; --code-title: #61afef; --code-string: #98c379; --code-value: #d19a66; --code-tag: #e06c75; --code-comment: #8b919c; --code-type: #e5c07b; --code-symbol: #56b6c2; background: #1e1e20; }
.source-header { display: flex; min-height: 38px; flex-shrink: 0; align-items: center; justify-content: space-between; gap: 8px; padding: 0 14px; border-bottom: 1px solid var(--agent-border-soft); background: var(--agent-surface); color: var(--agent-ink-muted); font-size: 11px; }
.source-file-info { display: flex; align-items: center; gap: 7px; min-width: 0; overflow: hidden; }
.source-filename { font-weight: 500; color: var(--agent-ink); font-size: 12.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.source-tag { display: inline-flex; align-items: center; padding: 1px 5px; border-radius: 4px; background: var(--agent-surface-sunken); color: var(--agent-ink-soft); font-size: 10px; font-weight: 600; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; line-height: 1.3; }
.source-readonly { font-size: 11px; font-family: var(--font-sans); font-weight: 400; color: var(--agent-ink-muted); }
.source-sep { color: var(--agent-ink-faint); opacity: 0.6; }
.source-meta { font-size: 11.5px; color: var(--agent-ink-muted); font-variant-numeric: tabular-nums; white-space: nowrap; }
.workspace-panel.is-compact .source-meta, .workspace-panel.is-compact .source-sep { display: none; }
.source-actions { display: flex; flex-shrink: 0; align-items: center; gap: 6px; }
.source-format { display: inline-flex; align-items: center; gap: 5px; padding: 4px 6px; border-radius: 4px; color: var(--agent-ink-muted); font-size: 12px; }
.source-format:hover, .source-actions [aria-pressed='true'] { background: var(--agent-surface-sunken); color: var(--agent-ink); }
.source-format:disabled { opacity: 0.5; cursor: wait; }
.source-format:focus-visible, .source-scroll:focus-visible { outline: 2px solid var(--agent-focus); outline-offset: -2px; }
.source-scroll { flex: 1; min-height: 0; overflow: auto; padding: 10px 0; color: var(--code-ink); font: 12px/20px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; tab-size: 2; }
.source-scroll pre { margin: 0; font: inherit; }
.source-lines { width: max-content; min-width: 100%; }
.source-row { display: grid; grid-template-columns: 46px minmax(0, 1fr); min-height: 20px; }
.source-row:hover { background: color-mix(in oklch, var(--agent-ink) 4%, transparent); }
.source-gutter { position: sticky; left: 0; padding: 0 10px 0 6px; border-right: 1px solid var(--agent-border-subtle); background: #f4f4f5; color: #6d727d; text-align: right; font-variant-numeric: tabular-nums; user-select: none; font-size: 11px; line-height: 20px; }
[data-dark='true'] .source-gutter { background: #1e1e20; color: #8b919c; }
.source-line { display: block; min-width: 0; padding: 0 12px; white-space: pre; }
.source-plain { padding: 0 12px; }
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
</style>
