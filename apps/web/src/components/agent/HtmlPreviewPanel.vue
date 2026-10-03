<script setup lang="ts">
import { useObjectUrl } from '@vueuse/core'
import { computed, onMounted, onScopeDispose, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import AppIcon from '@/components/common/AppIcon.vue'
import AppTooltip from '@/components/common/AppTooltip.vue'
import { getWorkspaceTraffic } from '../../api/workspace'

const props = defineProps<{ code: string, focusClose?: boolean, interactive?: boolean, conversationId?: string, embedded?: boolean }>()
const emit = defineEmits<{ close: [] }>()
const { t } = useI18n()
const title = computed(() => t('conversation.actions.codeBlock.previewTitle'))
const frame = ref<HTMLIFrameElement | null>(null)
const closeButton = ref<HTMLButtonElement | null>(null)
const previewUrl = `${import.meta.env.BASE_URL}html-preview.html`
const downloadUrl = useObjectUrl(computed(() => new Blob([props.code], { type: 'text/html;charset=utf-8' })))

function renderDocument() {
  frame.value?.contentWindow?.postMessage({ type: 'html-preview', code: props.code, title: title.value, interactive: props.interactive === true }, '*')
}

let nextQueryAt = 0
const queryControllers = new Set<AbortController>()
async function handleQuery(event: MessageEvent) {
  const data: unknown = event.data
  if (!props.interactive || event.source !== frame.value?.contentWindow || event.origin !== 'null'
    || !data || typeof data !== 'object' || !('type' in data)) {
    return
  }
  if (data.type === 'html-preview-close') {
    emit('close')
    return
  }
  if (!props.conversationId || data.type !== 'workspace-query'
    || !('id' in data) || typeof data.id !== 'string' || !/^[\w-]{1,80}$/.test(data.id)
    || !('query' in data) || data.query !== 'topuplist.traffic') {
    return
  }
  const id = props.conversationId
  const source = frame.value?.contentWindow
  if (Date.now() < nextQueryAt) {
    source?.postMessage({ type: 'workspace-query-result', id: data.id, error: '请稍后再查询' }, '*')
    return
  }
  nextQueryAt = Date.now() + 1000
  const controller = new AbortController()
  queryControllers.add(controller)
  try {
    const result = await getWorkspaceTraffic(id, controller.signal)
    if (id === props.conversationId && source === frame.value?.contentWindow)
      source?.postMessage({ type: 'workspace-query-result', id: data.id, result }, '*')
  }
  catch {
    if (id === props.conversationId && source === frame.value?.contentWindow)
      source?.postMessage({ type: 'workspace-query-result', id: data.id, error: '数据查询暂时失败' }, '*')
  }
  finally {
    queryControllers.delete(controller)
  }
}
window.addEventListener('message', handleQuery)
onScopeDispose(() => {
  window.removeEventListener('message', handleQuery)
  queryControllers.forEach(controller => controller.abort())
})

watch([() => props.code, title], renderDocument, { flush: 'post' })
onMounted(() => {
  if (props.focusClose)
    closeButton.value?.focus({ preventScroll: true })
})
</script>

<template>
  <section
    data-html-preview-panel
    :aria-label="title"
    class="flex min-h-0 min-w-0 flex-1 flex-col bg-agent-surface text-agent-ink"
    @keydown.esc="emit('close')"
  >
    <header v-if="!embedded" class="flex h-12 shrink-0 items-center gap-2 border-b border-agent-border-soft px-3">
      <AppIcon name="tabler:browser" :size="18" class="text-agent-ink-muted" />
      <h2 class="min-w-0 flex-1 truncate text-sm font-medium">
        {{ title }}
      </h2>
      <AppTooltip :content="t('conversation.actions.codeBlock.download')">
        <a :href="downloadUrl" download="index.html" :aria-label="t('conversation.actions.codeBlock.download')" class="preview-action">
          <AppIcon name="tabler:download" :size="18" />
        </a>
      </AppTooltip>
      <AppTooltip :content="t('conversation.actions.codeBlock.closePreview')">
        <button ref="closeButton" type="button" :aria-label="t('conversation.actions.codeBlock.closePreview')" class="preview-action" @click="emit('close')">
          <AppIcon name="tabler:x" :size="18" />
        </button>
      </AppTooltip>
    </header>
    <iframe
      ref="frame"
      :title="title"
      sandbox="allow-scripts"
      referrerpolicy="no-referrer"
      :src="previewUrl"
      class="min-h-0 w-full flex-1 border-0 bg-white"
      @load="renderDocument"
    />
    <p v-if="!embedded" class="shrink-0 border-t border-agent-border-soft px-3 py-2 text-xs leading-relaxed text-agent-ink-muted">
      {{ props.interactive ? t('workspace.interactiveNotice') : t('conversation.actions.codeBlock.previewNotice') }}
    </p>
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
.preview-action:hover { background: var(--agent-surface-sunken); color: var(--agent-ink); }
.preview-action:focus-visible { outline: 2px solid var(--agent-focus); }
</style>
