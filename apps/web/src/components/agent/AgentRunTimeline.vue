<script setup lang="ts">
import type { TurnRunStep } from '../../types/chat'

import { computed, reactive } from 'vue'
import { useI18n } from 'vue-i18n'

import { runStepText, safeHref, siteName } from '@/utils/run-status'

const props = defineProps<{
  steps: TurnRunStep[]
}>()

/** 搜索来源最多列 5 条，其余写「还有 k 条」。 */
const MAX_SOURCES = 5
/** 网站图标加载失败时的首字母底色：按域名固定取一个。 */
const FALLBACK_COLORS = ['#b4552b', '#3d7a5a', '#4a6fa5', '#8a5a9e', '#9a7b2f', '#5b6b73']

const { t, locale } = useI18n()
const open = reactive<Record<number, boolean>>({})
/** 打开过的行才渲染内容：网站图标只在用户点开那一步时才去请求。 */
const rendered = reactive<Record<number, boolean>>({})
/** 按图标地址记加载失败的，失败的换成首字母。 */
const brokenIcons = reactive<Record<string, boolean>>({})

// 步骤按下标识别：不同轮次的 callId 可能重复。
const items = computed(() => props.steps.map((step, index) => {
  const failed = step.status === 'failed'
  const pageHref = step.toolName === 'web_fetch' && step.status === 'ok' ? safeHref(step.finalUrl) : undefined
  const sources = step.toolName === 'web_search' && step.status === 'ok'
    ? (step.results ?? []).flatMap((source) => {
        const href = safeHref(source.url)

        return href
          ? [{ href, title: source.title || href, site: siteName(href), icon: `https://${new URL(href).host}/favicon.ico` }]
          : []
      })
    : []

  return {
    index,
    step,
    failed,
    icon: failed ? 'fail' : step.toolName === 'web_search' ? 'search' : step.toolName === 'web_fetch' ? 'page' : 'tool',
    text: runStepText(step, t, locale.value),
    pageHref,
    sources: sources.slice(0, MAX_SOURCES),
    moreSources: Math.max(0, sources.length - MAX_SOURCES),
    reason: failed
      ? t(step.failure === 'timeout'
          ? 'conversation.run.reason.timeout'
          : step.toolName === 'web_fetch' ? 'conversation.run.reason.fetchFailed' : 'conversation.run.reason.failed')
      : undefined,
    expandable: failed || !!pageHref || sources.length > 0,
  }
}))

function toggle(index: number) {
  rendered[index] = true
  open[index] = !open[index]
}

function fallbackColor(site: string): string {
  return FALLBACK_COLORS[[...site].reduce((sum, char) => sum + char.charCodeAt(0), 0) % FALLBACK_COLORS.length]!
}
</script>

<template>
  <ol class="run-timeline" data-run-timeline>
    <li
      v-for="item in items"
      :key="item.index"
      class="run-tl-item"
      :class="{ 'is-failed': item.failed }"
    >
      <span class="run-tl-icon" aria-hidden="true">
        <span>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <template v-if="item.icon === 'search'">
              <circle cx="11" cy="11" r="6.5" /><path d="M20 20l-4-4" />
            </template>
            <template v-else-if="item.icon === 'page'">
              <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5M9 13h6M9 17h4" />
            </template>
            <template v-else-if="item.icon === 'fail'">
              <circle cx="12" cy="12" r="9" opacity=".3" /><path d="M12 8v5M12 16.5v.01" />
            </template>
            <template v-else>
              <path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L4 17v3h3l5.3-5.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.4-.6-.6-2.4z" />
            </template>
          </svg>
        </span>
      </span>
      <div
        class="run-tl-head"
        :role="item.expandable ? 'button' : undefined"
        :tabindex="item.expandable ? 0 : undefined"
        :aria-expanded="item.expandable ? !!open[item.index] : undefined"
        @click="item.expandable && toggle(item.index)"
        @keydown.enter.space.prevent="item.expandable && toggle(item.index)"
      >
        <span class="run-tl-verb">{{ item.text.verb }}</span>
        <span class="run-tl-object">{{ item.text.object }}</span>
        <span v-if="item.text.meta" class="run-tl-meta">{{ item.text.meta }}</span>
        <svg v-if="item.expandable" class="run-tl-caret" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M9 6l6 6-6 6" />
        </svg>
      </div>
      <div v-if="item.expandable" class="run-tl-body" :class="{ 'is-open': open[item.index] }" :inert="!open[item.index]">
        <div>
          <div v-if="rendered[item.index]" class="run-tl-body-inner">
            <template v-if="item.sources.length">
              <a
                v-for="(source, sourceIndex) in item.sources"
                :key="sourceIndex"
                class="run-source"
                :href="source.href"
                target="_blank"
                rel="noopener noreferrer"
              >
                <img
                  v-if="!brokenIcons[source.icon]"
                  class="run-favicon"
                  :src="source.icon"
                  alt=""
                  referrerpolicy="no-referrer"
                  @error="brokenIcons[source.icon] = true"
                >
                <span v-else class="run-favicon" :style="{ background: fallbackColor(source.site) }">{{ source.site.charAt(0).toUpperCase() }}</span>
                <span class="run-source-title">{{ source.title }}</span>
                <span class="run-source-site">{{ source.site }}</span>
              </a>
              <div v-if="item.moreSources" class="run-source-more">
                {{ t('conversation.run.moreResults', { n: item.moreSources }) }}
              </div>
            </template>
            <a
              v-else-if="item.pageHref"
              class="run-note-link"
              :href="item.pageHref"
              target="_blank"
              rel="noopener noreferrer"
            >{{ t('conversation.run.openPage') }} ↗</a>
            <p v-else-if="item.reason" class="run-note">
              {{ item.reason }}
            </p>
          </div>
        </div>
      </div>
    </li>
  </ol>
</template>

<style scoped>
/* 时间线：不套卡片，一步一行，图标用一条细竖线串起来 */
.run-timeline {
  --run-ease-out: cubic-bezier(0.22, 0.8, 0.24, 1);
  --run-ease-in-out: cubic-bezier(0.45, 0, 0.25, 1);

  margin: 0;
  padding: 2px 0 10px;
  list-style: none;
}

.run-tl-item {
  position: relative;
  display: grid;
  grid-template-columns: 16px minmax(0, 1fr);
  column-gap: 10px;
}

/* 竖线从本行图标中心连到下一行图标中心，图标底色盖住线头 */
.run-tl-item:not(:last-child)::before {
  content: '';
  position: absolute;
  top: 16px;
  bottom: -16px;
  left: 7.5px;
  width: 1px;
  background: var(--agent-border-soft);
}

.run-tl-icon {
  position: relative;
  display: grid;
  height: 32px;
  place-items: center;
}

.run-tl-icon > span {
  display: grid;
  width: 20px;
  height: 20px;
  place-items: center;
  border-radius: 50%;
  background: var(--agent-canvas);
  color: var(--agent-ink-faint);
}

.run-tl-icon svg {
  width: 13px;
  height: 13px;
}

.run-tl-item.is-failed .run-tl-icon > span {
  color: var(--agent-accent);
}

.run-tl-head {
  display: flex;
  min-width: 0;
  height: 32px;
  align-items: center;
  gap: 6px;
  border-radius: 6px;
  color: var(--agent-ink-muted);
  font-size: 13.5px;
}

.run-tl-head[role='button'] {
  cursor: pointer;
}

.run-tl-head[role='button']:hover .run-tl-object,
.run-tl-head[role='button']:hover .run-tl-verb {
  color: var(--agent-ink);
}

.run-tl-head:focus-visible {
  outline: 2px solid color-mix(in oklch, var(--agent-copper) 45%, transparent);
  outline-offset: 2px;
}

.run-tl-verb {
  flex: none;
  color: var(--agent-ink-faint);
  transition: color 0.2s;
}

.run-tl-object {
  min-width: 0;
  overflow: hidden;
  color: var(--agent-ink-soft);
  text-overflow: ellipsis;
  white-space: nowrap;
  transition: color 0.2s;
}

.run-tl-meta {
  flex: none;
  color: var(--agent-ink-faint);
  font-variant-numeric: tabular-nums;
}

.run-tl-meta::before {
  content: '·';
  margin: 0 0.45em 0 0.1em;
}

.run-tl-item.is-failed .run-tl-meta {
  color: var(--agent-accent);
}

.run-tl-caret {
  flex: none;
  width: 12px;
  height: 12px;
  color: var(--agent-ink-faint);
  opacity: 0.7;
  transition: transform 0.24s var(--run-ease-out);
}

.run-tl-head[aria-expanded='true'] .run-tl-caret {
  transform: rotate(90deg);
}

.run-tl-body {
  display: grid;
  grid-column: 2;
  grid-template-rows: 0fr;
  opacity: 0;
  transition: grid-template-rows 0.36s var(--run-ease-in-out), opacity 0.3s var(--run-ease-out);
}

.run-tl-body.is-open {
  grid-template-rows: 1fr;
  opacity: 1;
}

.run-tl-body > div {
  min-height: 0;
  overflow: hidden;
}

.run-tl-body-inner {
  padding: 2px 0 10px;
}

/* 搜索来源：一条一行，网站图标 + 标题 + 域名 */
.run-source {
  display: grid;
  grid-template-columns: 14px minmax(0, auto) auto;
  align-items: center;
  column-gap: 8px;
  width: fit-content;
  max-width: 100%;
  height: 26px;
  color: var(--agent-ink-soft);
  font-size: 13px;
  text-decoration: none;
}

.run-source:hover .run-source-title {
  text-decoration: underline;
  text-decoration-color: var(--agent-border);
  text-underline-offset: 3px;
}

.run-source-title {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.run-source-site,
.run-source-more {
  color: var(--agent-ink-faint);
  font-size: 12px;
}

.run-source-more {
  display: flex;
  height: 24px;
  align-items: center;
}

.run-favicon {
  display: grid;
  width: 14px;
  height: 14px;
  place-items: center;
  border-radius: 4px;
  color: #fff;
  font-size: 8.5px;
  font-weight: 700;
  object-fit: contain;
}

.run-note {
  margin: 0;
  color: var(--agent-ink-muted);
  font-size: 13px;
  line-height: 1.7;
}

.run-note-link {
  color: var(--agent-accent);
  font-size: 13px;
  text-underline-offset: 3px;
}

@media (prefers-reduced-motion: reduce) {
  .run-timeline *,
  .run-timeline *::before,
  .run-timeline *::after {
    animation: none !important;
    transition: none !important;
  }
}
</style>
