<script setup lang="ts">
import { computed } from 'vue'
import { renderConversationMarkdown } from './conversation-markdown'

const props = defineProps<{ content: string }>()
const html = computed(() => renderConversationMarkdown(props.content))
</script>

<template>
  <!-- 唯一允许的 HTML 入口：仅接收禁用 HTML、过滤链接且不加载图片的解析结果。 -->
  <!-- eslint-disable-next-line vue/no-v-html -->
  <div class="conversation-markdown" v-html="html" />
</template>

<style scoped>
.conversation-markdown {
  min-width: 0;
  color: var(--admin-text);
  font-size: var(--admin-font-sm);
  line-height: 1.7;
  overflow-wrap: anywhere;
}

.conversation-markdown :deep(> :first-child) {
  margin-top: 0;
}

.conversation-markdown :deep(> :last-child) {
  margin-bottom: 0;
}

.conversation-markdown :deep(p),
.conversation-markdown :deep(ul),
.conversation-markdown :deep(ol),
.conversation-markdown :deep(blockquote),
.conversation-markdown :deep(pre),
.conversation-markdown :deep(table) {
  margin-block: 0.8em;
}

.conversation-markdown :deep(h1),
.conversation-markdown :deep(h2),
.conversation-markdown :deep(h3),
.conversation-markdown :deep(h4),
.conversation-markdown :deep(h5),
.conversation-markdown :deep(h6) {
  margin-block: 1em 0.5em;
  color: inherit;
  font-size: 1.15em;
  font-weight: 650;
  line-height: 1.4;
}

.conversation-markdown :deep(h1) {
  font-size: 1.5em;
}

.conversation-markdown :deep(h2) {
  font-size: 1.3em;
}

.conversation-markdown :deep(ul),
.conversation-markdown :deep(ol) {
  padding-inline-start: 1.8em;
}

.conversation-markdown :deep(ul) {
  list-style: disc;
}

.conversation-markdown :deep(ol) {
  list-style: decimal;
}

.conversation-markdown :deep(blockquote) {
  margin-inline: 0;
  padding-inline-start: 1em;
  border-left: 3px solid var(--admin-border-strong);
  color: var(--admin-text-muted);
}

.conversation-markdown :deep(a) {
  color: var(--admin-primary);
  text-decoration: underline;
  text-underline-offset: 3px;
}

.conversation-markdown :deep(code) {
  padding: 2px 4px;
  border-radius: 4px;
  background: var(--admin-surface-muted);
  font-family: var(--admin-font-mono);
  font-size: 0.95em;
}

.conversation-markdown :deep(pre) {
  max-width: 100%;
  padding: 12px;
  overflow-x: auto;
  border: 1px solid var(--admin-border-strong);
  border-radius: var(--admin-radius-sm);
  background: var(--admin-surface-muted);
  white-space: pre;
}

.conversation-markdown :deep(pre code) {
  padding: 0;
  background: transparent;
  overflow-wrap: normal;
}

.conversation-markdown :deep(table) {
  display: block;
  max-width: 100%;
  overflow-x: auto;
  border-collapse: collapse;
}

.conversation-markdown :deep(th),
.conversation-markdown :deep(td) {
  padding: 6px 10px;
  border: 1px solid var(--admin-border-strong);
}

.conversation-markdown :deep(th) {
  background: var(--admin-surface-muted);
  font-weight: 650;
}
</style>
