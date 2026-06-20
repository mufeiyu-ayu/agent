<script setup lang="ts">
import type Token from 'markdown-it/lib/token.mjs'

import MarkdownIt from 'markdown-it'
import { computed } from 'vue'

const props = defineProps<{
  text: string
}>()

const markdown = new MarkdownIt({
  breaks: true,
  html: false,
  linkify: true,
})

markdown.validateLink = (url) => {
  const normalizedUrl = url.trim().toLowerCase()

  return !/^(?:javascript|vbscript|file|data):/.test(normalizedUrl)
}

const defaultLinkOpenRenderer = markdown.renderer.rules.link_open

markdown.renderer.rules.link_open = (tokens, index, options, env, self) => {
  const token = tokens[index]

  setTokenAttr(token, 'target', '_blank')
  setTokenAttr(token, 'rel', 'noreferrer noopener')

  if (defaultLinkOpenRenderer)
    return defaultLinkOpenRenderer(tokens, index, options, env, self)

  return self.renderToken(tokens, index, options)
}

const renderedContent = computed(() => markdown.render(props.text.trim()))

function setTokenAttr(token: Token, name: string, value: string) {
  const attrIndex = token.attrIndex(name)

  if (attrIndex < 0) {
    token.attrPush([name, value])
    return
  }

  if (!token.attrs)
    return

  token.attrs[attrIndex][1] = value
}
</script>

<template>
  <div
    class="agent-markdown-content"
    v-html="renderedContent"
  />
</template>

<style scoped>
.agent-markdown-content {
  color: var(--agent-ink-soft);
  font-size: 17px;
  font-weight: 500;
  line-height: 1.72;
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

.agent-markdown-content :deep(code) {
  border: 1px solid var(--agent-border-soft);
  border-radius: 0.45rem;
  background: color-mix(in oklch, var(--agent-surface-raised) 72%, var(--agent-ink) 8%);
  color: var(--agent-ink);
  font-family:
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
  padding: 0.12rem 0.36rem;
}

.agent-markdown-content :deep(pre) {
  max-width: 100%;
  margin: 1rem 0 0;
  overflow-x: auto;
  border: 1px solid var(--agent-border-soft);
  border-radius: 0.75rem;
  background: var(--agent-surface-sunken);
  padding: 0.9rem 1rem;
}

.agent-markdown-content :deep(pre code) {
  border: 0;
  border-radius: 0;
  background: transparent;
  padding: 0;
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
