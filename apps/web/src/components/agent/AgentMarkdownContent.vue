<script setup lang="ts">
import { onUnmounted, shallowRef, watch } from 'vue'

import { parseMarkdownBlocks } from '@/utils/markdown-blocks'

import AgentCodeBlock from './AgentCodeBlock.vue'

const props = defineProps<{
  text: string
  isStreaming?: boolean
}>()

const blocks = shallowRef<ReturnType<typeof parseMarkdownBlocks>>([])
let timer: ReturnType<typeof setTimeout> | undefined
let lastRenderAt = -Infinity

function render() {
  timer = undefined
  blocks.value = parseMarkdownBlocks(props.text)
  lastRenderAt = performance.now()
}

// 在入口合并解析、HTML 更新和子组件高亮，不保存每个流式前缀。
watch([() => props.text, () => props.isStreaming], () => {
  const remaining = 80 - (performance.now() - lastRenderAt)
  if (!props.isStreaming || remaining <= 0) {
    clearTimeout(timer)
    render()
  }
  else if (timer === undefined) {
    timer = setTimeout(render, remaining)
  }
}, { immediate: true })

onUnmounted(() => clearTimeout(timer))
</script>

<template>
  <div class="agent-markdown-content">
    <template v-for="(block, index) in blocks" :key="index">
      <div
        v-if="block.type === 'markdown'"
        class="agent-markdown-prose"
        v-html="block.html"
      />
      <AgentCodeBlock
        v-else
        :code="block.code"
        :language="block.language"
        :is-streaming="!!props.isStreaming && block.isOpen"
      />
    </template>
  </div>
</template>

<style scoped>
.agent-markdown-content {
  color: var(--agent-ink-soft);
  font-size: 16px;
  font-weight: 500;
  line-height: 1.7;
}

@media (min-width: 960px) {
  .agent-markdown-content {
    font-size: 15px;
    line-height: 1.65;
  }
}

.agent-markdown-content :deep(*) {
  letter-spacing: 0;
}

.agent-markdown-content :deep(p) {
  margin: 0;
}

.agent-markdown-content :deep(p + p) {
  margin-top: 1rem;
}

.agent-markdown-content :deep(strong) {
  color: var(--agent-ink);
  font-weight: 760;
}

.agent-markdown-content :deep(em) {
  color: var(--agent-ink);
  font-style: italic;
}

.agent-markdown-content :deep(h1),
.agent-markdown-content :deep(h2),
.agent-markdown-content :deep(h3),
.agent-markdown-content :deep(h4) {
  margin: 1.35rem 0 0.55rem;
  color: var(--agent-ink);
  font-weight: 800;
  line-height: 1.35;
}

.agent-markdown-content :deep(h1:first-child),
.agent-markdown-content :deep(h2:first-child),
.agent-markdown-content :deep(h3:first-child),
.agent-markdown-content :deep(h4:first-child) {
  margin-top: 0;
}

.agent-markdown-content :deep(h1) {
  font-size: 1.18em;
}

.agent-markdown-content :deep(h2) {
  font-size: 1.12em;
}

.agent-markdown-content :deep(h3),
.agent-markdown-content :deep(h4) {
  font-size: 1.04em;
}

.agent-markdown-content :deep(ol),
.agent-markdown-content :deep(ul) {
  margin: 1rem 0 0;
  padding-left: 1.5rem;
}

.agent-markdown-content :deep(ol:first-child),
.agent-markdown-content :deep(ul:first-child) {
  margin-top: 0;
}

.agent-markdown-content :deep(li) {
  margin-top: 0.52rem;
  padding-left: 0.2rem;
}

.agent-markdown-content :deep(li:first-child) {
  margin-top: 0;
}

.agent-markdown-content :deep(li > p) {
  margin: 0.2rem 0 0;
}

.agent-markdown-content :deep(li > p:first-child) {
  margin-top: 0;
}

.agent-markdown-content :deep(a) {
  color: var(--agent-accent);
  font-weight: 700;
  text-decoration: underline;
  text-decoration-thickness: 1px;
  text-underline-offset: 0.18em;
}

.agent-markdown-content :deep(a:hover) {
  color: var(--agent-primary-hover);
}

.agent-markdown-prose :deep(code) {
  border: 1px solid var(--agent-border-subtle);
  border-radius: 0.375rem;
  background: color-mix(in oklch, var(--agent-surface-raised) 82%, var(--agent-border-subtle) 18%);
  color: var(--agent-ink);
  font-family:
    "JetBrains Maple Mono",
    "Maple Mono",
    "JetBrains Mono",
    ui-monospace,
    SFMono-Regular,
    Menlo,
    Monaco,
    Consolas,
    "Liberation Mono",
    "Courier New",
    monospace;
  font-size: 0.86em;
  font-weight: 600;
  padding: 0.12rem 0.38rem;
}

.agent-markdown-prose :deep(pre) {
  max-width: 100%;
  margin: 1rem 0 0;
  overflow-x: auto;
  border: 1px solid var(--agent-border-soft);
  border-radius: 0.75rem;
  background: var(--agent-surface-raised);
  box-shadow: 0 1px 3px 0 rgb(0 0 0 / 0.04), 0 1px 2px -1px rgb(0 0 0 / 0.04);
  padding: 0.95rem 1.15rem;
}

.agent-markdown-prose :deep(pre code) {
  border: 0;
  border-radius: 0;
  background: transparent;
  padding: 0;
  color: var(--agent-ink);
  font-family:
    "JetBrains Maple Mono",
    "Maple Mono",
    "JetBrains Mono",
    ui-monospace,
    SFMono-Regular,
    Menlo,
    Monaco,
    Consolas,
    "Liberation Mono",
    "Courier New",
    monospace;
  font-size: 0.88em;
  font-weight: 450;
  line-height: 1.65;
  white-space: pre;
}

.agent-markdown-content :deep(blockquote) {
  margin: 1rem 0 0;
  border: 1px solid var(--agent-border-soft);
  border-radius: 0.75rem;
  background: color-mix(in oklch, var(--agent-surface-raised) 78%, var(--agent-accent-soft) 22%);
  padding: 0.78rem 0.95rem;
  color: var(--agent-ink-soft);
}

.agent-markdown-content :deep(table) {
  display: block;
  max-width: 100%;
  margin-top: 1rem;
  overflow-x: auto;
  border-collapse: collapse;
  font-size: 0.94em;
}

.agent-markdown-content :deep(th),
.agent-markdown-content :deep(td) {
  border: 1px solid var(--agent-border-soft);
  padding: 0.5rem 0.65rem;
  text-align: left;
  vertical-align: top;
}

.agent-markdown-content :deep(th) {
  background: var(--agent-surface-raised);
  color: var(--agent-ink);
  font-weight: 800;
}

.agent-markdown-content :deep(hr) {
  margin: 1.25rem 0;
  border: 0;
  border-top: 1px solid var(--agent-border-soft);
}
</style>
