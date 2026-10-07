<script setup lang="ts">
import type { WorkspaceFile } from '@agent/contracts'
import type { TurnRun } from '../../types/chat'
import { useResizeObserver } from '@vueuse/core'
import { computed, nextTick, onScopeDispose, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { workspaceArtifacts, workspaceFileType } from '../../utils/workspace-files'
import AppIcon from '../common/AppIcon.vue'

const props = defineProps<{ run: TurnRun, files: WorkspaceFile[], opening: boolean }>()
const emit = defineEmits<{ openFile: [file: WorkspaceFile] }>()
const { t } = useI18n()
const artifacts = computed(() => workspaceArtifacts(props.run, props.files))

function formatBytes(bytes: number) {
  if (bytes < 1024)
    return `${bytes} B`
  return `${(bytes / 1024).toFixed(1)} KB`
}

const COLLAPSED_HEIGHT = 96
const containerRef = ref<HTMLElement | null>(null)
const isExpanded = ref(false)
const isClamped = ref(true)
const isAnimating = ref(false)
const measuredOverflow = ref<boolean | null>(null)

// 初始根据文件数估算是否可能溢出 3 行（>= 8 个通常超过 3 行），挂载后以实测 scrollHeight 为准，避免闪烁
const hasOverflow = computed(() => measuredOverflow.value ?? (artifacts.value.length >= 8))

function checkOverflow() {
  const el = containerRef.value
  if (!el)
    return
  // 3 行标准高度 28 * 3 + 6 * 2 = 96px，超过 100px 明确代表已折到第 4 行
  measuredOverflow.value = el.scrollHeight > 100
}

// VueUse 随实际条件节点重绑并在 scope 结束时断开，不只观察第一次 mounted 的节点。
useResizeObserver(containerRef, checkOverflow)
let finishAnimation: (() => void) | undefined
let disposed = false
onScopeDispose(() => {
  disposed = true
  finishAnimation?.()
})

watch(() => props.files, () => {
  measuredOverflow.value = null
  nextTick(checkOverflow)
}, { deep: true })

async function toggleExpand() {
  const el = containerRef.value
  if (!el || isAnimating.value)
    return

  const prefersReducedMotion = typeof window !== 'undefined'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches

  if (prefersReducedMotion) {
    isExpanded.value = !isExpanded.value
    isClamped.value = !isExpanded.value
    el.style.height = ''
    el.style.transition = ''
    return
  }

  const expanding = !isExpanded.value
  const startHeight = el.offsetHeight
  const targetHeight = expanding ? el.scrollHeight : COLLAPSED_HEIGHT
  const duration = expanding ? 280 : 240
  isAnimating.value = true
  el.style.height = `${startHeight}px`
  isExpanded.value = expanding
  if (expanding)
    isClamped.value = false
  await nextTick()
  if (disposed || el !== containerRef.value) {
    el.style.height = ''
    isAnimating.value = false
    return
  }
  void el.offsetHeight
  el.style.transition = `height ${duration}ms cubic-bezier(0.16, 1, 0.3, 1)`
  el.style.height = `${targetHeight}px`
  let cleaned = false
  let timer: ReturnType<typeof setTimeout> | undefined
  const onEnd = (event: TransitionEvent) => {
    if (event.target === el && event.propertyName === 'height')
      finishAnimation?.()
  }
  const cleanup = async () => {
    if (cleaned)
      return
    cleaned = true
    clearTimeout(timer)
    el.removeEventListener('transitionend', onEnd)
    finishAnimation = undefined
    if (!isExpanded.value) {
      isClamped.value = true
      await nextTick()
    }
    el.style.height = ''
    el.style.transition = ''
    isAnimating.value = false
  }
  timer = setTimeout(cleanup, duration + 60)
  finishAnimation = () => {
    void cleanup()
  }
  el.addEventListener('transitionend', onEnd)
}
</script>

<template>
  <section
    v-if="artifacts.length"
    data-workspace-artifact
    class="my-2.5 min-w-0 max-w-2xl rounded-xl border border-agent-border-soft/70 bg-agent-surface-raised/40 p-1.5 shadow-2xs transition-colors hover:border-agent-border-soft hover:bg-agent-surface-raised/70 dark:border-white/[0.07] dark:bg-white/[0.02]"
  >
    <!-- 单文件场景：紧凑单行条，图标精致无厚重方框，排版通透 -->
    <div v-if="artifacts.length === 1" class="flex min-w-0 items-center justify-between gap-2">
      <button
        type="button"
        :disabled="opening"
        :title="artifacts[0]!.path"
        :aria-label="t('workspace.openFile', { path: artifacts[0]!.path })"
        class="group flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2 py-1 text-left transition-colors hover:bg-agent-surface/80 focus-visible:outline-2 focus-visible:outline-agent-focus disabled:cursor-wait disabled:opacity-50"
        @click="emit('openFile', artifacts[0]!)"
      >
        <AppIcon :name="workspaceFileType(artifacts[0]!.path).icon" :size="15" class="shrink-0 transition-transform group-hover:scale-105" />
        <span class="min-w-0 truncate font-mono text-[12.5px] font-medium text-agent-ink group-hover:text-agent-ink-soft">
          {{ artifacts[0]!.path }}
        </span>
        <span class="shrink-0 text-[11px] tabular-nums text-agent-ink-muted/80">
          {{ formatBytes(artifacts[0]!.bytes) }}
        </span>
      </button>

      <button
        type="button"
        :disabled="opening"
        :aria-label="t('workspace.openPanel')"
        class="artifact-panel-btn"
        @click="emit('openFile', artifacts[0]!)"
      >
        <AppIcon name="tabler:layout-columns" :size="13" class="panel-btn-icon" />
        <span>{{ t('workspace.openPanel') }}</span>
      </button>
    </div>

    <!-- 多文件场景：轻量标头统计，下方横向优雅流式文件胶囊列表（多于 3 行时折叠展开） -->
    <div v-else class="flex min-w-0 flex-col gap-1.5 p-0.5">
      <header class="flex items-center justify-between gap-2 px-1 pt-0.5">
        <div class="flex items-center gap-1.5 text-agent-ink-muted">
          <AppIcon name="tabler:folder-check" :size="13" class="text-agent-accent shrink-0" />
          <span class="text-[11.5px] font-medium text-agent-ink-muted">
            {{ t('workspace.files') }}
            <span class="ml-0.5 tabular-nums text-agent-ink-faint">({{ artifacts.length }})</span>
          </span>
        </div>

        <button
          type="button"
          :disabled="opening"
          :aria-label="t('workspace.openPanel')"
          class="artifact-panel-btn"
          @click="emit('openFile', artifacts[0]!)"
        >
          <AppIcon name="tabler:layout-columns" :size="13" class="panel-btn-icon" />
          <span>{{ t('workspace.openPanel') }}</span>
        </button>
      </header>

      <div
        ref="containerRef"
        class="artifacts-grid flex min-w-0 flex-wrap items-center gap-1.5 px-0.5"
        :class="{ 'is-clamped': hasOverflow && isClamped, 'is-animating': isAnimating }"
      >
        <button
          v-for="file in artifacts"
          :key="file.path"
          type="button"
          :disabled="opening"
          :title="file.path"
          :aria-label="t('workspace.openFile', { path: file.path })"
          class="group inline-flex h-7 max-w-full items-center gap-1.5 rounded-lg border border-agent-border-soft/60 bg-agent-surface/80 px-2 text-left shadow-2xs transition-all hover:border-agent-border hover:bg-agent-surface hover:shadow-xs focus-visible:outline-2 focus-visible:outline-agent-focus disabled:cursor-wait disabled:opacity-50"
          @click="emit('openFile', file)"
        >
          <AppIcon :name="workspaceFileType(file.path).icon" :size="14" class="shrink-0 transition-transform group-hover:scale-105" />
          <span class="min-w-0 truncate font-mono text-[12px] font-medium text-agent-ink group-hover:text-agent-ink-soft">
            {{ file.path }}
          </span>
          <span class="shrink-0 text-[10.5px] tabular-nums text-agent-ink-muted/80">
            {{ formatBytes(file.bytes) }}
          </span>
        </button>
      </div>

      <div v-if="hasOverflow" class="artifacts-expander-row flex items-center justify-center pt-1.5 pb-0.5">
        <button
          type="button"
          :aria-expanded="isExpanded"
          :aria-label="isExpanded ? t('workspace.collapseFiles') : t('workspace.expandFiles', { n: artifacts.length })"
          :title="isExpanded ? t('workspace.collapseFiles') : t('workspace.expandFiles', { n: artifacts.length })"
          class="artifacts-expander-pill group"
          @click="toggleExpand"
        >
          <AppIcon
            name="tabler:chevron-down"
            :size="14"
            class="expander-chevron"
            :class="{ 'is-expanded': isExpanded }"
          />
        </button>
      </div>
    </div>
  </section>
</template>

<style scoped>
.artifact-panel-btn {
  display: inline-flex;
  height: 25px;
  flex-shrink: 0;
  align-items: center;
  gap: 6px;
  border-radius: 6px;
  border: 1px solid var(--agent-border-soft);
  background: var(--agent-surface-sunken);
  padding: 0 10px;
  font-size: 11.5px;
  font-weight: 500;
  line-height: 1;
  color: var(--agent-ink);
  box-shadow: 0 1px 2px 0 rgb(0 0 0 / 0.04);
  transition: all 160ms cubic-bezier(0.16, 1, 0.3, 1);
  cursor: pointer;
  outline: none;
}

.artifact-panel-btn:focus-visible {
  outline: 2px solid var(--agent-focus);
}

.artifact-panel-btn:hover:not(:disabled) {
  border-color: var(--agent-border);
  background: var(--agent-surface);
  color: var(--agent-ink);
}

.artifact-panel-btn:active:not(:disabled) {
  transform: scale(0.98);
}

.artifact-panel-btn:disabled {
  opacity: 0.5;
  cursor: wait;
}

.panel-btn-icon {
  flex-shrink: 0;
  color: var(--agent-ink-muted);
  transition: color 160ms ease;
}

.artifact-panel-btn:hover:not(:disabled) .panel-btn-icon {
  color: var(--agent-ink);
}

/* 暗色主题衬托：深橄榄余烬微光，边框与图标呼应主题琥珀金色 */
[data-agent-workspace-theme='olive-ember'] .artifact-panel-btn {
  border-color: color-mix(in oklch, var(--agent-accent) 30%, var(--agent-border-soft));
  background: color-mix(in oklch, var(--agent-accent) 12%, var(--agent-surface-sunken));
  color: var(--agent-ink-soft);
  box-shadow: 0 1px 3px 0 rgb(0 0 0 / 0.25);
}

[data-agent-workspace-theme='olive-ember'] .artifact-panel-btn .panel-btn-icon {
  color: var(--agent-accent);
}

[data-agent-workspace-theme='olive-ember'] .artifact-panel-btn:hover:not(:disabled) {
  border-color: color-mix(in oklch, var(--agent-accent) 55%, var(--agent-border-soft));
  background: color-mix(in oklch, var(--agent-accent) 20%, var(--agent-surface-sunken));
  color: var(--agent-ink);
}

.artifacts-grid {
  will-change: height;
}

.artifacts-grid.is-clamped,
.artifacts-grid.is-animating {
  overflow: hidden;
}

.artifacts-grid.is-clamped {
  max-height: 96px;
}

@media (prefers-reduced-motion: reduce) {
  .artifacts-grid {
    transition: none !important;
  }
}

.artifacts-expander-row {
  display: flex;
  width: 100%;
  align-items: center;
  justify-content: center;
  padding-top: 6px;
  padding-bottom: 2px;
}

.artifacts-expander-pill {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 52px;
  height: 22px;
  border-radius: 9999px;
  border: 1px solid var(--agent-border-soft);
  background: var(--agent-surface);
  box-shadow: 0 1px 3px 0 rgb(0 0 0 / 0.05), 0 1px 2px -1px rgb(0 0 0 / 0.05);
  cursor: pointer;
  outline: none;
  transition: all 180ms cubic-bezier(0.16, 1, 0.3, 1);
}

.artifacts-expander-pill:hover {
  border-color: color-mix(in oklch, var(--agent-accent) 45%, var(--agent-border-soft));
  background: var(--agent-surface-raised);
  box-shadow: 0 3px 8px -1px rgb(0 0 0 / 0.08), 0 1px 3px 0 rgb(0 0 0 / 0.04);
  transform: translateY(-0.5px);
}

.artifacts-expander-pill:active {
  transform: translateY(0.5px) scale(0.95);
}

.artifacts-expander-pill:focus-visible {
  outline: 2px solid var(--agent-focus);
  outline-offset: 2px;
}

.expander-chevron {
  color: var(--agent-ink-muted);
  transition: transform 260ms cubic-bezier(0.16, 1, 0.3, 1), color 180ms ease;
}

.expander-chevron.is-expanded {
  transform: rotate(180deg);
}

.artifacts-expander-pill:hover .expander-chevron {
  color: var(--agent-accent);
}

[data-agent-workspace-theme='olive-ember'] .artifact-panel-btn:hover:not(:disabled) .panel-btn-icon {
  color: var(--agent-accent);
}

[data-agent-workspace-theme='olive-ember'] .artifacts-expander-pill {
  border-color: color-mix(in oklch, var(--agent-accent) 25%, var(--agent-border-soft));
  background: color-mix(in oklch, var(--agent-surface-raised) 90%, black);
  box-shadow: 0 1px 3px 0 rgb(0 0 0 / 0.3);
}

[data-agent-workspace-theme='olive-ember'] .artifacts-expander-pill .expander-chevron {
  color: var(--agent-ink-soft);
}

[data-agent-workspace-theme='olive-ember'] .artifacts-expander-pill:hover {
  border-color: color-mix(in oklch, var(--agent-accent) 55%, var(--agent-border-soft));
  background: color-mix(in oklch, var(--agent-accent) 18%, var(--agent-surface-raised));
  box-shadow: 0 2px 8px -1px rgb(0 0 0 / 0.5);
  transform: translateY(-0.5px);
}

[data-agent-workspace-theme='olive-ember'] .artifacts-expander-pill:active {
  transform: translateY(0.5px) scale(0.95);
}

[data-agent-workspace-theme='olive-ember'] .artifacts-expander-pill:hover .expander-chevron {
  color: var(--agent-accent);
}
</style>
