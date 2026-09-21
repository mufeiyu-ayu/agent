<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import AppIcon from '@/components/common/AppIcon.vue'
import AppTooltip from '@/components/common/AppTooltip.vue'
import { useCopyFeedback } from '@/hooks/useCopyFeedback'
import { useWorkspaceTheme } from '@/hooks/useWorkspaceTheme'
import { highlightCode } from '@/utils/code-highlighter'

const props = defineProps<{
  code: string
  language?: string
  isStreaming?: boolean
}>()

const { t } = useI18n()
const { workspaceTheme } = useWorkspaceTheme()
const isDark = computed(() => workspaceTheme.value === 'olive-ember')
const { copied, copy } = useCopyFeedback()
const copyLabel = computed(() => t(copied.value ? 'conversation.actions.codeBlock.copied' : 'conversation.actions.codeBlock.copy'))
const displayLanguage = computed(() => {
  const language = props.language?.trim().toLowerCase()
  return !language || language === 'text' ? 'CODE' : language.toUpperCase()
})
const highlightedHtml = computed(() => highlightCode(props.code, props.language))
const codeScrollContainerRef = ref<HTMLElement | null>(null)
let scrollRafId: number | undefined
let userInterruptedScroll = false

function onScroll() {
  const viewport = codeScrollContainerRef.value
  if (viewport)
    userInterruptedScroll = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight > 32
}

watch(
  [highlightedHtml, () => props.isStreaming],
  ([, streaming], [, wasStreaming]) => {
    if (!(streaming || wasStreaming) || userInterruptedScroll || scrollRafId !== undefined)
      return
    // 高亮 HTML 提交之后再滚动，终态补齐也走同一帧调度。
    scrollRafId = requestAnimationFrame(() => {
      scrollRafId = undefined
      const viewport = codeScrollContainerRef.value
      if (viewport && !userInterruptedScroll)
        viewport.scrollTop = viewport.scrollHeight
    })
  },
  { flush: 'post', immediate: true },
)

onUnmounted(() => {
  if (scrollRafId !== undefined)
    cancelAnimationFrame(scrollRafId)
})
</script>

<template>
  <div
    class="agent-code-card my-3.5 flex max-h-[380px] min-w-0 flex-col overflow-hidden rounded-2xl border transition-colors motion-reduce:transition-none"
    :data-dark="isDark"
    :class="isDark
      ? 'border-white/[0.08] bg-[#1e1e20] shadow-[0_4px_16px_rgba(0,0,0,0.25)]'
      : 'border-black/[0.07] bg-[#f4f4f5] shadow-[0_1px_4px_rgb(0_0_0/0.05)]'"
  >
    <div
      class="flex h-10 shrink-0 items-center justify-between gap-2 border-b px-4 py-2 text-xs select-none"
      :class="isDark ? 'border-white/[0.06] text-[#abb2bf]' : 'border-black/[0.05] text-agent-ink-muted'"
    >
      <div class="flex min-w-0 items-center gap-2">
        <AppIcon name="tabler:terminal-2" :size="16" class="shrink-0" />
        <span class="truncate font-mono text-[11px] font-bold tracking-wider">{{ displayLanguage }}</span>
      </div>
      <div class="flex shrink-0 items-center gap-1.5">
        <AppTooltip v-if="props.isStreaming" :content="t('conversation.actions.codeBlock.generating')">
          <span class="flex size-7 items-center justify-center" role="status" :aria-label="t('conversation.actions.codeBlock.generating')">
            <AppIcon name="tabler:loader-2" :size="15" class="animate-spin motion-reduce:animate-none" />
          </span>
        </AppTooltip>
        <template v-else>
          <AppTooltip :content="t('conversation.actions.codeBlock.code')">
            <button
              type="button"
              :aria-label="t('conversation.actions.codeBlock.code')"
              aria-pressed="true"
              class="code-action shadow-xs"
              :class="isDark ? 'bg-white/10 text-white' : 'bg-white text-agent-ink'"
            >
              <AppIcon name="tabler:code" :size="15" />
            </button>
          </AppTooltip>
          <AppTooltip :content="t('conversation.actions.codeBlock.preview')">
            <button
              type="button"
              :aria-label="t('conversation.actions.codeBlock.preview')"
              aria-disabled="true"
              class="code-action cursor-not-allowed opacity-60"
            >
              <AppIcon name="tabler:player-play" :size="14" />
            </button>
          </AppTooltip>
          <AppTooltip :content="copyLabel">
            <button
              type="button"
              :aria-label="copyLabel"
              class="code-action"
              :class="copied ? 'text-agent-moss' : ''"
              @click="copy(props.code)"
            >
              <AppIcon :name="copied ? 'tabler:check' : 'tabler:copy'" :size="15" />
            </button>
          </AppTooltip>
        </template>
      </div>
    </div>
    <div
      ref="codeScrollContainerRef"
      data-agent-code-scroll
      class="agent-code-scroll min-h-0 flex-1 overflow-auto overscroll-contain px-4 pt-2.5 pb-4"
      @scroll="onScroll"
    >
      <pre class="agent-code-pre m-0 p-0 text-[13.5px] leading-[1.65]"><code class="hljs" v-html="highlightedHtml" /><span v-if="props.isStreaming" class="ml-0.5 inline-block h-3.5 w-1.5 translate-y-[2px] rounded-[1px] animate-pulse motion-reduce:animate-none" :class="isDark ? 'bg-[#61afef]' : 'bg-agent-accent'" /></pre>
    </div>
  </div>
</template>

<style scoped>
.agent-code-card {
  --code-ink: #383a42;
  --code-keyword: #a626a4;
  --code-title: #4078f2;
  --code-string: #50a14f;
  --code-value: #986801;
  --code-tag: #e45649;
  --code-comment: #a0a1a7;
  --code-type: #c18401;
  --code-symbol: #0184bc;
  --code-scrollbar: rgba(0, 0, 0, 0.22);
}

.agent-code-card[data-dark='true'] {
  --code-ink: #abb2bf;
  --code-keyword: #c678dd;
  --code-title: #61afef;
  --code-string: #98c379;
  --code-value: #d19a66;
  --code-tag: #e06c75;
  --code-comment: #8b919c;
  --code-type: #e5c07b;
  --code-symbol: #56b6c2;
  --code-scrollbar: rgba(255, 255, 255, 0.22);
}

.code-action {
  display: flex;
  width: 1.75rem;
  height: 1.75rem;
  align-items: center;
  justify-content: center;
  border-radius: 0.5rem;
}
.code-action:not([aria-disabled]):hover { background-color: var(--code-scrollbar); }
.code-action:focus-visible { outline: 2px solid var(--agent-focus); }

.agent-code-pre,
.agent-code-pre code {
  font-family: "JetBrains Maple Mono", "Maple Mono", "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
  font-variant-ligatures: normal;
  font-feature-settings: "liga" 1, "calt" 1;
  color: var(--code-ink);
  background: transparent;
  white-space: pre;
}

.agent-code-scroll {
  scrollbar-width: thin;
  scrollbar-color: var(--code-scrollbar) transparent;
}
.agent-code-scroll::-webkit-scrollbar { width: 6px; height: 6px; }
.agent-code-scroll::-webkit-scrollbar-thumb { background: var(--code-scrollbar); border-radius: 9999px; }

:deep(.hljs-keyword), :deep(.hljs-operator), :deep(.hljs-selector-tag) { color: var(--code-keyword); font-weight: 600; }
:deep(.hljs-title) { color: var(--code-title); }
:deep(.hljs-string), :deep(.hljs-addition) { color: var(--code-string); }
:deep(.hljs-attr), :deep(.hljs-attribute), :deep(.hljs-variable),
:deep(.hljs-number), :deep(.hljs-literal), :deep(.hljs-regexp), :deep(.hljs-link) { color: var(--code-value); }
:deep(.hljs-tag), :deep(.hljs-name), :deep(.hljs-selector-id), :deep(.hljs-selector-class) { color: var(--code-tag); font-weight: 550; }
:deep(.hljs-comment), :deep(.hljs-quote), :deep(.hljs-deletion), :deep(.hljs-meta) { color: var(--code-comment); font-style: italic; }
:deep(.hljs-built_in), :deep(.hljs-type) { color: var(--code-type); }
:deep(.hljs-symbol), :deep(.hljs-bullet) { color: var(--code-symbol); }
</style>
