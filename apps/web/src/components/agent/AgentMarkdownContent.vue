<script setup lang="ts">
import { useStreamingMarkdown } from '@/hooks/useStreamingMarkdown'

import AgentCodeBlock from './AgentCodeBlock.vue'

const props = defineProps<{
  text: string
  isStreaming?: boolean
}>()

// 平滑放出、按顶层块记忆化与尾块补齐都在 hook 里；这里只渲染块列表。
const blocks = useStreamingMarkdown(() => props.text, () => !!props.isStreaming)
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

/* 每个顶层块各占一个 wrapper：块间距由 wrapper 给出，与块内元素自身的上边距折叠取大者。 */
.agent-markdown-prose + .agent-markdown-prose {
  margin-top: 1rem;
}

.agent-markdown-prose:has(> h1, > h2, > h3, > h4) + .agent-markdown-prose {
  margin-top: 0;
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

.agent-markdown-prose:first-child :deep(:is(h1, h2, h3, h4):first-child) {
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
  /* Tailwind preflight 把列表标记清成 none；revert 回到浏览器默认：圆点 / 序号，嵌套层级依次空心圆、方块。 */
  list-style: revert;
}

.agent-markdown-prose:first-child :deep(:is(ol, ul):first-child) {
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
