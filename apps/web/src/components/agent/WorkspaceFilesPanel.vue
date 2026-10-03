<script setup lang="ts">
import type { WorkspaceSnapshot } from '@agent/contracts'
import { useElementSize } from '@vueuse/core'
import { DialogClose, DialogContent, DialogPortal, DialogRoot, DialogTitle, DialogTrigger } from 'reka-ui'
import { computed, onScopeDispose, reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useCopyFeedback } from '../../hooks/useCopyFeedback'
import { useWorkspaceTheme } from '../../hooks/useWorkspaceTheme'
import { highlightCode } from '../../utils/code-highlighter'
import { isPreviewableHtml } from '../../utils/html-preview'
import { FILE_CODE_LIMIT, fileFormatParser, formatFileCode, highlightedCodeLines } from '../../utils/source-code'
import { workspaceFileTree, workspaceFileType } from '../../utils/workspace-files'
import AppIcon from '../common/AppIcon.vue'
import AppTooltip from '../common/AppTooltip.vue'
import HtmlPreviewPanel from './HtmlPreviewPanel.vue'

const props = defineProps<{
  snapshot?: WorkspaceSnapshot
  loading: boolean
  error: string
  conversationId: string | null
  readFile: (path: string) => Promise<{ bytes: Uint8Array, text: string }>
}>()
const emit = defineEmits<{ close: [], refresh: [] }>()
const { t } = useI18n()
const { workspaceTheme } = useWorkspaceTheme()
const { copied, copy } = useCopyFeedback()
const panel = ref<HTMLElement | null>(null)
const { width } = useElementSize(panel)
const expandedPreview = ref(false)
const selected = ref('')
const code = ref('')
const mode = ref<'code' | 'preview'>('code')
const pending = ref(false)
const fileError = ref('')
const search = ref('')
const collapsed = reactive(new Set<string>())
let request = 0
const showEnvironment = ref(localStorage.getItem('kuro-show-environment') === 'true')
watch(showEnvironment, value => localStorage.setItem('kuro-show-environment', String(value)))
const stateLabel = computed(() => t(`workspace.states.${props.snapshot?.state ?? 'idle'}`))
const totalBytes = computed(() => props.snapshot?.files.reduce((sum, file) => sum + file.bytes, 0) ?? 0)
const previewable = computed(() => selected.value.toLowerCase().endsWith('.html') && isPreviewableHtml(code.value, 'html'))
const fileType = computed(() => workspaceFileType(selected.value))
const formattedCode = ref<string>()
const formatting = ref(false)
const formatError = ref('')
const wrapLines = ref(false)
let formatRequest = 0
onScopeDispose(() => {
  request++
  formatRequest++
})
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
watch(() => props.snapshot?.files, (files) => {
  const html = files?.find(file => file.path.toLowerCase().endsWith('.html'))
  if (html && !autoPreviewed && !selected.value) {
    autoPreviewed = true
    void open(html.path, true)
  }
}, { immediate: true })

watch(() => props.conversationId, () => {
  request++
  autoPreviewed = false
  selected.value = ''
  code.value = ''
  mode.value = 'code'
  pending.value = false
  fileError.value = ''
  search.value = ''
  collapsed.clear()
})
watch(() => props.snapshot?.revision, (next, previous) => {
  if (next === previous || previous === undefined || !selected.value)
    return
  if (props.snapshot?.files.some(file => file.path === selected.value)) {
    void open(selected.value, mode.value === 'preview')
  }
  else {
    request++
    selected.value = ''
    code.value = ''
    mode.value = 'code'
    pending.value = false
    fileError.value = ''
  }
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
  emit('close')
}

async function open(path: string, preview = false) {
  const current = ++request
  // 先确定读取目标，版本变化时才能重读它；不能用上一次成功打开的文件抢回选择。
  if (selected.value !== path) {
    selected.value = path
    code.value = ''
  }
  mode.value = preview && path.toLowerCase().endsWith('.html') ? 'preview' : 'code'
  pending.value = true
  fileError.value = ''
  try {
    const result = await props.readFile(path)
    if (current !== request)
      return
    code.value = result.text
    mode.value = preview && path.toLowerCase().endsWith('.html') && isPreviewableHtml(result.text, 'html') ? 'preview' : 'code'
  }
  catch {
    if (current === request)
      fileError.value = t('workspace.fileFailed')
  }
  finally {
    if (current === request)
      pending.value = false
  }
}

defineExpose({ openFile: (path: string) => open(path, true) })

async function download(path: string) {
  const current = ++request
  pending.value = true
  fileError.value = ''
  try {
    const result = await props.readFile(path)
    if (current !== request)
      return
    const url = URL.createObjectURL(new Blob([result.bytes as Uint8Array<ArrayBuffer>], { type: 'application/octet-stream' }))
    const link = document.createElement('a')
    link.href = url
    link.download = path.split('/').at(-1) ?? 'file'
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  catch {
    if (current === request)
      fileError.value = t('workspace.fileFailed')
  }
  finally {
    if (current === request)
      pending.value = false
  }
}
</script>

<template>
  <section ref="panel" data-workspace-files-panel class="workspace-panel" :class="{ 'is-compact': width < 620 }" :data-dark="workspaceTheme === 'olive-ember'" @keydown.esc.stop="close">
    <header class="file-toolbar">
      <div class="file-title" :title="selected || t('workspace.files')">
        <AppIcon :name="selected ? fileType.icon : 'vscode-icons:default-folder-opened'" :size="18" />
        <select v-if="width < 620 && selected && (snapshot?.files.length ?? 0) > 1" :value="selected" :disabled="pending" :aria-label="t('workspace.chooseFile')" @change="open(($event.target as HTMLSelectElement).value, true)">
          <option v-for="file in snapshot?.files" :key="file.path" :value="file.path">
            {{ file.path }}
          </option>
        </select>
        <h2 v-else>
          {{ selected ? selected.split('/').at(-1) : t('workspace.files') }}
        </h2>
      </div>
      <div class="toolbar-actions">
        <div v-if="selected" class="view-switch" :aria-label="t('workspace.viewMode')" role="group">
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
          <button class="workspace-action" :disabled="pending" :aria-label="t('workspace.downloadFile', { path: selected })" @click="download(selected)">
            <AppIcon name="tabler:download" :size="17" />
          </button>
        </AppTooltip>
        <DialogRoot v-if="previewable" v-model:open="expandedPreview">
          <AppTooltip :content="t('workspace.expandPreview')">
            <DialogTrigger as-child>
              <button class="workspace-action" :disabled="pending" :aria-label="t('workspace.expandPreview')">
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
                  <button class="workspace-action" :disabled="pending" :aria-label="t('workspace.downloadFile', { path: selected })" @click="download(selected)">
                    <AppIcon name="tabler:download" :size="17" />
                  </button>
                </AppTooltip>
                <AppTooltip :content="t('workspace.closeExpandedPreview')">
                  <DialogClose class="workspace-action" :aria-label="t('workspace.closeExpandedPreview')">
                    <AppIcon name="tabler:x" :size="17" />
                  </DialogClose>
                </AppTooltip>
              </header>
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
    <p v-if="error || fileError || snapshot?.lastError" role="alert" class="workspace-error">
      {{ error || fileError || snapshot?.lastError }}
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
                <button class="tree-entry tree-file" :disabled="pending" :title="entry.path" :aria-label="entry.path" :aria-current="selected === entry.path ? 'true' : undefined" @click="open(entry.path, true)">
                  <AppIcon :name="workspaceFileType(entry.path).icon" :size="17" />
                  <span>{{ entry.name }}</span>
                </button>
                <button class="workspace-action tree-download" :disabled="pending" :aria-label="t('workspace.downloadFile', { path: entry.path })" @click="download(entry.path)">
                  <AppIcon name="tabler:download" :size="14" />
                </button>
              </template>
            </div>
          </template>
        </div>
      </aside>
      <main v-if="selected || width >= 620" class="file-viewport">
        <HtmlPreviewPanel v-if="mode === 'preview' && previewable" :code="code" :conversation-id="conversationId ?? undefined" interactive embedded @close="close" />
        <div v-else-if="selected && mode === 'code'" class="source-panel">
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
        <div v-else class="workspace-placeholder">
          <AppIcon name="tabler:file-code" :size="28" /><p>{{ t('workspace.selectFile') }}</p>
        </div>
      </main>
    </div>
    <footer class="workspace-status">
      <span class="saved-version">{{ t('workspace.savedVersion', { n: snapshot?.revision ?? 0 }) }} · {{ (totalBytes / 1024).toFixed(1) }} KB</span>
      <span v-if="pending" role="status" class="status-loading">{{ t('workspace.loading') }}</span>
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
.file-viewport { display: flex; flex: 1; min-width: 0; min-height: 0; flex-direction: column; overflow: hidden; }
.workspace-placeholder { display: grid; flex: 1; align-content: center; justify-items: center; gap: 12px; padding: 24px; color: var(--agent-ink-muted); text-align: center; font-size: 13px; }
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
