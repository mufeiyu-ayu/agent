<script setup lang="ts">
import { useObjectUrl } from '@vueuse/core'
import { isAxiosError } from 'axios'
import { computed, onMounted, onScopeDispose, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import AppIcon from '@/components/common/AppIcon.vue'
import AppTooltip from '@/components/common/AppTooltip.vue'
import { getWorkspaceTraffic, openWorkspacePreview } from '../../api/workspace'

const props = defineProps<{ code: string, focusClose?: boolean, interactive?: boolean, conversationId?: string, embedded?: boolean, artifactId?: string }>()
const emit = defineEmits<{ close: [], current: [] }>()
const { t } = useI18n()
const title = computed(() => t(props.artifactId ? 'workspace.buildPreview' : 'conversation.actions.codeBlock.previewTitle'))
const frame = ref<HTMLIFrameElement | null>(null)
const closeButton = ref<HTMLButtonElement | null>(null)
const previewUrl = `${import.meta.env.BASE_URL}html-preview.html`
const artifactUrl = ref('')
const artifactError = ref(false)
const artifactExpired = ref(false)
const artifactLoading = ref(false)
let artifactRequest = 0
let artifactController: AbortController | undefined
let readyTimer: ReturnType<typeof setTimeout> | undefined
let expiryTimer: ReturnType<typeof setTimeout> | undefined
let artifactGeneration = ''
let artifactFailed = false
function navigateArtifact(url: string) {
  const generation = crypto.randomUUID()
  artifactGeneration = generation
  artifactFailed = false
  artifactLoading.value = true
  artifactError.value = false
  const target = new URL(url, location.origin)
  target.searchParams.set('generation', generation)
  artifactUrl.value = target.href
  clearTimeout(readyTimer)
  readyTimer = setTimeout(() => {
    if (artifactGeneration === generation) {
      artifactLoading.value = false
      artifactError.value = true
    }
  }, 10_000)
}
async function loadArtifact() {
  const current = ++artifactRequest
  artifactController?.abort()
  clearTimeout(readyTimer)
  clearTimeout(expiryTimer)
  artifactExpired.value = false
  artifactUrl.value = ''
  artifactGeneration = ''
  artifactFailed = false
  artifactLoading.value = false
  artifactError.value = false
  if (!props.artifactId || !props.conversationId)
    return
  artifactLoading.value = true
  artifactController = new AbortController()
  try {
    const grant = await openWorkspacePreview(props.conversationId, props.artifactId, artifactController.signal)
    if (current !== artifactRequest)
      return
    navigateArtifact(grant.url)
    expiryTimer = setTimeout(() => {
      if (current === artifactRequest) {
        clearTimeout(readyTimer)
        artifactExpired.value = true
        artifactLoading.value = false
        artifactError.value = true
      }
    }, Math.max(0, grant.expiresAt - Date.now()))
  }
  catch (error) {
    if (current === artifactRequest) {
      artifactFailed = true
      artifactExpired.value = isAxiosError(error) && [404, 410].includes(error.response?.status ?? 0)
      artifactLoading.value = false
      artifactError.value = true
    }
  }
}
watch([() => props.artifactId, () => props.conversationId], loadArtifact, { immediate: true })
const downloadUrl = useObjectUrl(computed(() => new Blob([props.code], { type: 'text/html;charset=utf-8' })))

function renderDocument() {
  if (props.artifactId)
    return
  frame.value?.contentWindow?.postMessage({ type: 'html-preview', code: props.code, title: title.value, interactive: props.interactive === true }, '*')
}

let nextQueryAt = 0
const queryControllers = new Set<AbortController>()
async function handleQuery(event: MessageEvent) {
  const data: unknown = event.data
  if ((!props.interactive && !props.artifactId) || event.source !== frame.value?.contentWindow || event.origin !== 'null'
    || !data || typeof data !== 'object' || !('type' in data)) {
    return
  }
  if (props.artifactId && (!('generation' in data) || data.generation !== artifactGeneration))
    return
  if (props.artifactId && artifactExpired.value && data.type !== 'artifact-close')
    return
  if (props.artifactId && data.type === 'artifact-page' && 'path' in data && typeof data.path === 'string' && artifactUrl.value) {
    const url = new URL(artifactUrl.value, location.origin)
    url.searchParams.set('path', data.path)
    url.hash = 'fragment' in data && typeof data.fragment === 'string' ? data.fragment : ''
    navigateArtifact(url.href)
    return
  }
  if (props.artifactId && data.type === 'artifact-ready') {
    if (!artifactFailed) {
      clearTimeout(readyTimer)
      artifactError.value = false
      artifactLoading.value = false
    }
    return
  }
  if (props.artifactId && data.type === 'artifact-error') {
    artifactFailed = true
    clearTimeout(readyTimer)
    artifactLoading.value = false
    artifactError.value = true
    return
  }
  if (data.type === 'html-preview-close' || (props.artifactId && data.type === 'artifact-close')) {
    emit('close')
    return
  }
  if (props.artifactId || !props.conversationId || data.type !== 'workspace-query'
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
  artifactRequest++
  artifactController?.abort()
  clearTimeout(readyTimer)
  clearTimeout(expiryTimer)
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
    :aria-busy="artifactLoading"
    class="flex min-h-0 min-w-0 flex-1 flex-col bg-agent-surface text-agent-ink"
    @keydown.esc.stop="emit('close')"
  >
    <header v-if="!embedded" class="flex h-12 shrink-0 items-center gap-2 border-b border-agent-border-soft px-3">
      <AppIcon name="tabler:browser" :size="18" class="text-agent-ink-muted" />
      <h2 class="min-w-0 flex-1 truncate text-sm font-medium">
        {{ title }}
      </h2>
      <AppTooltip v-if="!conversationId" :content="t('conversation.actions.codeBlock.download')">
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
    <p v-if="artifactLoading" role="status" class="p-3 text-sm">
      {{ t('workspace.loading') }}
    </p>
    <p v-if="artifactError" role="alert" class="p-3 text-sm">
      {{ t(artifactExpired ? 'workspace.artifactExpired' : 'workspace.artifactFailed') }}
      <button class="underline" @click="loadArtifact">
        {{ t('workspace.retry') }}
      </button>
      <button class="ml-2 underline" @click="emit('current')">
        {{ t('workspace.openCurrentBuild') }}
      </button>
    </p>
    <iframe
      v-if="!artifactId || artifactUrl"
      ref="frame"
      :title="title"
      sandbox="allow-scripts"
      referrerpolicy="no-referrer"
      :src="artifactId ? artifactUrl : previewUrl"
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
