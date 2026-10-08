<script setup lang="ts">
import type { ChatAttachment } from '../../types/chat'
import type { PreviewTable } from '../../utils/attachment-documents'

import { computed, onMounted, ref, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import AppIcon from '@/components/common/AppIcon.vue'
import AppTooltip from '@/components/common/AppTooltip.vue'
import { readSheets, renderDocx } from '@/utils/attachment-documents'
import { attachmentPreviewMode, decodeText, parseCsv } from '@/utils/attachments'
import { workspaceFileType } from '@/utils/workspace-files'

import AgentMarkdownContent from './AgentMarkdownContent.vue'

/**
 * 用户上传的文档在右侧面板里的预览：只把文件内容渲染出来看。
 * 和沙箱的工作文件面板无关，不读工作区、不列文件树。
 */
const props = defineProps<{
  attachment: ChatAttachment
  /** 窄屏时面板盖住对话：打开后把焦点放到关闭按钮上。 */
  focusClose?: boolean
}>()

const emit = defineEmits<{
  close: []
}>()

const { t } = useI18n()

/** 文本最多渲染这么多字，表格最多这么多行和列，更多的下载后看：DOM 节点数是这里的性能上限。 */
const TEXT_LIMIT = 200_000
const ROW_LIMIT = 500
const COLUMN_LIMIT = 30

const closeButton = ref<HTMLButtonElement | null>(null)
onMounted(() => {
  if (props.focusClose)
    closeButton.value?.focus()
})

const mode = computed(() => attachmentPreviewMode(props.attachment.name))

const state = ref<'loading' | 'ready' | 'failed'>('loading')
const text = ref('')
// 表格数据可能有几万个单元格，只换引用、不做深层响应。
const tables = shallowRef<PreviewTable[]>([])
const activeTable = ref(0)
const docxHtml = ref('')

watch(() => props.attachment, async (attachment, _previous, onCleanup) => {
  const controller = new AbortController()
  onCleanup(() => controller.abort())
  state.value = 'loading'
  text.value = ''
  tables.value = []
  activeTable.value = 0
  docxHtml.value = ''
  if (mode.value === 'pdf') {
    state.value = 'ready'
    return
  }

  try {
    const response = await fetch(attachment.url, { signal: controller.signal })
    if (!response.ok)
      throw new Error(`HTTP ${response.status}`)

    // 每一步等待之后都可能已经换了别的附件：迟到的结果不要。
    if (mode.value === 'sheet') {
      const sheets = await readSheets(await response.blob(), controller.signal)
      if (props.attachment !== attachment)
        return
      tables.value = sheets
    }
    else if (mode.value === 'docx') {
      const html = await renderDocx(await response.blob())
      if (props.attachment !== attachment)
        return
      docxHtml.value = html
    }
    else {
      const content = decodeText(await response.arrayBuffer())
      if (props.attachment !== attachment)
        return
      if (mode.value === 'table')
        tables.value = [{ name: attachment.name, rows: parseCsv(content) }]
      else
        text.value = content
    }

    if (props.attachment === attachment)
      state.value = 'ready'
  }
  catch {
    if (props.attachment === attachment)
      state.value = 'failed'
  }
}, { immediate: true })

const isTable = computed(() => mode.value === 'table' || mode.value === 'sheet')
const table = computed(() => tables.value[activeTable.value])
const headerRow = computed(() => table.value?.rows[0]?.slice(0, COLUMN_LIMIT) ?? [])
const bodyRows = computed(() => table.value?.rows.slice(1, ROW_LIMIT + 1) ?? [])
const shownText = computed(() => text.value.slice(0, TEXT_LIMIT))

const truncatedNotice = computed(() => {
  if (isTable.value) {
    const rows = table.value?.rows ?? []
    const tooWide = rows.some(row => row.length > COLUMN_LIMIT)
    return rows.length - 1 > ROW_LIMIT || tooWide
      ? t('conversation.attachments.tableTruncated', { rows: ROW_LIMIT.toLocaleString(), columns: COLUMN_LIMIT })
      : ''
  }
  return text.value.length > TEXT_LIMIT ? t('conversation.attachments.truncated', { count: TEXT_LIMIT.toLocaleString() }) : ''
})
</script>

<template>
  <section
    data-attachment-preview-panel
    :aria-label="attachment.name"
    :aria-busy="state === 'loading'"
    class="flex min-h-0 min-w-0 flex-1 flex-col bg-agent-surface text-agent-ink"
    @keydown.esc.stop="emit('close')"
  >
    <header class="flex h-12 shrink-0 items-center gap-2 border-b border-agent-border-soft px-3">
      <AppIcon :name="workspaceFileType(attachment.name).icon" :size="18" />
      <h2 class="min-w-0 flex-1 truncate text-sm font-medium" :title="attachment.name">
        {{ attachment.name }}
      </h2>
      <AppTooltip :content="t('conversation.attachments.download', { name: attachment.name })">
        <a
          :href="attachment.url"
          :download="attachment.name"
          :aria-label="t('conversation.attachments.download', { name: attachment.name })"
          class="preview-action"
        >
          <AppIcon name="tabler:download" :size="18" />
        </a>
      </AppTooltip>
      <AppTooltip :content="t('conversation.attachments.close')">
        <button
          ref="closeButton"
          type="button"
          :aria-label="t('conversation.attachments.close')"
          class="preview-action"
          @click="emit('close')"
        >
          <AppIcon name="tabler:x" :size="18" />
        </button>
      </AppTooltip>
    </header>

    <!-- 多个工作表时在这里切换；数据已经全部读好，切换不再解析。 -->
    <div v-if="tables.length > 1" role="tablist" class="flex shrink-0 gap-1 overflow-x-auto border-b border-agent-border-soft px-3 py-1.5">
      <button
        v-for="(sheet, index) in tables"
        :key="index"
        type="button"
        role="tab"
        :aria-selected="index === activeTable"
        class="sheet-tab"
        @click="activeTable = index"
      >
        <span class="block max-w-40 truncate text-xs leading-6">{{ sheet.name }}</span>
      </button>
    </div>

    <!-- 浏览器自带的 PDF 阅读器；面板窄，收起它的缩略图栏并按宽度铺满。 -->
    <iframe
      v-if="mode === 'pdf'"
      :key="attachment.id"
      :src="`${attachment.url}#navpanes=0&view=FitH`"
      :title="attachment.name"
      class="min-h-0 w-full flex-1 border-0 bg-white"
    />
    <div v-else class="relative min-h-0 flex-1 overflow-auto">
      <p v-if="state === 'failed'" role="alert" class="p-5 text-sm text-agent-ink-muted">
        {{ t('conversation.attachments.loadFailed') }}
      </p>
      <!-- 读得快就不出现：延迟一小会儿才显示，避免一闪而过。 -->
      <p v-else-if="state === 'loading'" role="status" class="preview-loading p-5 text-sm text-agent-ink-muted">
        {{ t('conversation.attachments.loading') }}
      </p>
      <p v-else-if="truncatedNotice" class="sticky left-0 border-b border-agent-border-subtle px-5 py-2 text-xs text-agent-ink-muted">
        {{ truncatedNotice }}
      </p>

      <!-- Word 的不可信样式只留在独立文档内；无 same-origin / scripts 权限。 -->
      <iframe
        v-if="mode === 'docx' && state === 'ready'"
        :key="attachment.id"
        :srcdoc="docxHtml"
        :title="attachment.name"
        sandbox="allow-popups allow-popups-to-escape-sandbox"
        data-docx-preview
        class="h-full min-h-0 w-full border-0 bg-white"
      />

      <template v-if="state === 'ready'">
        <table v-if="isTable" :key="activeTable" class="attachment-table">
          <thead>
            <tr>
              <th v-for="(cell, column) in headerRow" :key="column" scope="col">
                {{ cell }}
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(row, index) in bodyRows" :key="index">
              <td v-for="(cell, column) in row.slice(0, COLUMN_LIMIT)" :key="column">
                {{ cell }}
              </td>
            </tr>
          </tbody>
        </table>
        <div v-else-if="mode === 'markdown'" class="px-6 py-5">
          <AgentMarkdownContent :key="attachment.id" :text="shownText" />
        </div>
        <pre v-else-if="mode === 'text'" class="whitespace-pre-wrap break-words px-6 py-5 font-mono text-[13px] leading-6 text-agent-ink-soft">{{ shownText }}</pre>
      </template>
    </div>
  </section>
</template>

<style scoped>
.preview-action {
  display: grid;
  width: 2rem;
  height: 2rem;
  flex-shrink: 0;
  place-items: center;
  border-radius: 0.5rem;
  color: var(--agent-ink-muted);
}

.preview-action:hover {
  background: var(--agent-surface-sunken);
  color: var(--agent-ink);
}

.preview-action:focus-visible {
  outline: 2px solid var(--agent-focus);
}

.preview-loading {
  animation: preview-loading-in 0.2s ease-out 0.25s both;
}

@keyframes preview-loading-in {
  from {
    opacity: 0;
  }
}

.sheet-tab {
  flex-shrink: 0;
  border-radius: 0.5rem;
  padding: 0 0.625rem;
  color: var(--agent-ink-muted);
}

.sheet-tab:hover {
  background: color-mix(in oklch, var(--agent-surface-sunken) 50%, transparent);
  color: var(--agent-ink);
}

.sheet-tab[aria-selected='true'] {
  background: var(--agent-accent-soft);
  color: var(--agent-ink);
}

.sheet-tab:focus-visible {
  outline: 2px solid var(--agent-focus);
}

/* 表头吸顶；单元格不折行，表格比面板宽时横向滚动。 */
.attachment-table {
  min-width: 100%;
  border-collapse: separate;
  border-spacing: 0;
  font-size: 12.5px;
  line-height: 1.5;
  font-variant-numeric: tabular-nums;
}

.attachment-table th,
.attachment-table td {
  max-width: 320px;
  overflow: hidden;
  border-right: 1px solid var(--agent-border-subtle);
  border-bottom: 1px solid var(--agent-border-subtle);
  padding: 6px 12px;
  text-align: left;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.attachment-table th {
  position: sticky;
  top: 0;
  background: var(--agent-surface-raised);
  color: var(--agent-ink);
  font-weight: 600;
}

.attachment-table td {
  color: var(--agent-ink-soft);
}

.attachment-table tbody tr:hover td {
  background: color-mix(in oklch, var(--agent-surface-sunken) 30%, transparent);
}

@media (prefers-reduced-motion: reduce) {
  .preview-loading {
    animation: none;
  }
}
</style>
