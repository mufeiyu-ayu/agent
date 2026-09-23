<script setup lang="ts">
/**
 * 正文类字段（工具参数、observation、模型文本）的纯文本展示块。
 *
 * 内容来自模型或工具，属于不可信数据：只用插值渲染，浏览器按文本显示，
 * 其中的 `<script>`、HTML 标签都原样可见，不会被解析。
 */
defineProps<{
  title: string
  /** null 表示没有落库，显示 emptyText。 */
  text: string | null
  emptyText: string
  /** 默认折叠，适合 observation / reasoning 这类可能很长的内容。 */
  collapsible?: boolean
  /** 标题旁的补充信息，如字符数。 */
  meta?: string
}>()
</script>

<template>
  <details v-if="collapsible" class="inspector-text-block">
    <summary>
      <span>{{ title }}</span>
      <small v-if="meta">{{ meta }}</small>
    </summary>
    <pre>{{ text ?? emptyText }}</pre>
  </details>

  <section v-else class="inspector-text-block">
    <h4>
      <span>{{ title }}</span>
      <small v-if="meta">{{ meta }}</small>
    </h4>
    <pre>{{ text ?? emptyText }}</pre>
  </section>
</template>

<style scoped>
.inspector-text-block {
  min-width: 0;
  margin-top: 12px;
  padding: 14px 16px;
  border: 1px solid var(--admin-border);
  border-radius: var(--admin-radius-md);
  background: var(--admin-surface-raised);
  box-shadow: var(--admin-shadow-sm);
}

.inspector-text-block h4,
.inspector-text-block summary {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin: 0;
  color: var(--admin-text-muted);
  font-size: var(--admin-font-2xs);
  font-weight: 700;
  letter-spacing: 0.07em;
}

.inspector-text-block summary {
  cursor: pointer;
}

.inspector-text-block small {
  font-weight: 500;
  letter-spacing: 0;
}

.inspector-text-block pre {
  max-height: 60vh;
  margin: 10px 0 0;
  overflow: auto;
  color: var(--admin-text);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: var(--admin-font-xs);
  line-height: 1.6;
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}
</style>
