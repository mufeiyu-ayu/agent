<script setup lang="ts">
import type { RunDetail } from '../run.model'
import { CopyOutlined, DownOutlined } from '@ant-design/icons-vue'
import { App as AntApp, Popover } from 'ant-design-vue'
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'

import RunStatusTag from '../components/RunStatusTag.vue'
import {
  formatDateTime,
  formatRequestedModel,
  formatTokens,
} from '../run.utils'

const props = defineProps<{
  run: RunDetail
}>()

const { message } = AntApp.useApp()
const { locale, t } = useI18n()
const detailsOpen = ref(false)

async function copyRunId() {
  try {
    await navigator.clipboard.writeText(props.run.id)
    message.success(t('runTrace.header.copiedRunId'))
  }
  catch {
    message.error(t('runTrace.header.copyFailed'))
  }
}
</script>

<template>
  <header class="trace-header">
    <span class="trace-header__label">{{ t('runTrace.header.runId') }}</span>
    <code class="trace-header__id" :title="run.id">{{ run.id }}</code>
    <button
      type="button"
      class="trace-header__copy"
      :aria-label="t('runTrace.header.copyRunId')"
      :title="t('runTrace.header.copyRunId')"
      @click="copyRunId"
    >
      <CopyOutlined aria-hidden="true" />
    </button>
    <RunStatusTag :status="run.status" />
    <RouterLink
      class="trace-header__conversation"
      :to="{ name: 'conversation-detail', params: { conversationId: run.conversationId } }"
      :title="run.conversationId"
    >
      {{ t('runTrace.header.conversation') }} · {{ run.conversationId }}
    </RouterLink>

    <div class="trace-header__meta">
      <span class="trace-header__stat">
        <span class="trace-header__stat-label">{{ t('runDetail.fields.model') }}</span>
        <span class="trace-header__stat-value" :title="formatRequestedModel(run.requestedModel, t('runs.defaultModel'))">
          {{ formatRequestedModel(run.requestedModel, t('runs.defaultModel')) }}
        </span>
      </span>
      <span class="trace-header__stat">
        <span class="trace-header__stat-label">{{ t('runDetail.fields.totalTokens') }}</span>
        <span class="trace-header__stat-value">{{ formatTokens(run.totalTokens, locale) }}</span>
      </span>

      <Popover v-model:open="detailsOpen" trigger="click" placement="bottomRight">
        <template #content>
          <dl class="trace-header__details">
            <dt>{{ t('runDetail.fields.inputTokens') }}</dt>
            <dd>{{ formatTokens(run.inputTokens, locale) }}</dd>
            <dt>{{ t('runDetail.fields.outputTokens') }}</dt>
            <dd>{{ formatTokens(run.outputTokens, locale) }}</dd>
            <dt>{{ t('runDetail.fields.reasoningTokens') }}</dt>
            <dd>{{ formatTokens(run.reasoningTokens, locale) }}</dd>
            <dt>{{ t('runDetail.fields.promptCacheHitTokens') }}</dt>
            <dd>{{ formatTokens(run.promptCacheHitTokens, locale) }}</dd>
            <dt>{{ t('runDetail.fields.promptCacheMissTokens') }}</dt>
            <dd>{{ formatTokens(run.promptCacheMissTokens, locale) }}</dd>
            <div class="trace-header__details-sep" aria-hidden="true" />
            <dt>{{ t('runDetail.fields.created') }}</dt>
            <dd>{{ formatDateTime(run.createdAt, locale) }}</dd>
            <dt>{{ t('runDetail.fields.started') }}</dt>
            <dd>{{ formatDateTime(run.startedAt, locale) }}</dd>
            <dt>{{ t('runDetail.fields.ended') }}</dt>
            <dd>{{ formatDateTime(run.endedAt, locale) }}</dd>
          </dl>
        </template>
        <button
          type="button"
          class="trace-header__more"
          :aria-expanded="detailsOpen"
        >
          {{ t('runTrace.header.details') }}
          <DownOutlined aria-hidden="true" />
        </button>
      </Popover>
    </div>
  </header>
</template>

<style scoped>
.trace-header {
  display: flex;
  flex: none;
  min-width: 0;
  min-height: 46px;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 10px;
  padding: 6px 18px;
  border-bottom: 1px solid var(--admin-border);
  background: var(--admin-surface);
}

.trace-header__label {
  color: var(--admin-text-muted);
  font-size: var(--admin-font-2xs);
  font-weight: 700;
  letter-spacing: 0.07em;
  text-transform: uppercase;
}

.trace-header__id {
  overflow: hidden;
  max-width: 30ch;
  color: var(--admin-text);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: var(--admin-font-sm);
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.trace-header__copy {
  display: inline-grid;
  width: 26px;
  height: 26px;
  place-items: center;
  padding: 0;
  border: 0;
  border-radius: var(--admin-radius-sm);
  color: var(--admin-text-subtle);
  background: transparent;
  cursor: pointer;
  font-size: var(--admin-font-sm);
}

.trace-header__copy:hover {
  color: var(--admin-text);
  background: var(--admin-hover);
}

.trace-header__copy:active {
  transform: translateY(1px);
}

.trace-header :deep(.run-status-tag) {
  font-size: var(--admin-font-2xs);
}

.trace-header__conversation {
  overflow: hidden;
  min-width: 0;
  max-width: 34ch;
  color: var(--admin-primary);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: var(--admin-font-xs);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.trace-header__meta {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 14px;
  margin-left: auto;
}

.trace-header__stat {
  display: flex;
  min-width: 0;
  align-items: baseline;
  gap: 5px;
}

.trace-header__stat-label {
  color: var(--admin-text-muted);
  font-size: var(--admin-font-xs);
  white-space: nowrap;
}

.trace-header__stat-value {
  overflow: hidden;
  max-width: 26ch;
  color: var(--admin-text);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: var(--admin-font-sm);
  font-variant-numeric: tabular-nums;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.trace-header__more {
  display: inline-flex;
  min-height: 30px;
  align-items: center;
  gap: 5px;
  padding: 0 10px;
  border: 1px solid var(--admin-border);
  border-radius: var(--admin-radius-sm);
  color: var(--admin-text-muted);
  background: transparent;
  cursor: pointer;
  font-size: var(--admin-font-xs);
}

.trace-header__more:hover {
  border-color: var(--admin-border-strong);
  color: var(--admin-text);
  background: var(--admin-hover);
}

.trace-header__more :deep(.anticon) {
  font-size: 10px;
}

.trace-header__details {
  display: grid;
  min-width: 240px;
  grid-template-columns: max-content minmax(0, 1fr);
  gap: 7px 18px;
  margin: 0;
}

.trace-header__details dt {
  color: var(--admin-text-muted);
  font-size: var(--admin-font-xs);
  white-space: nowrap;
}

.trace-header__details dd {
  margin: 0;
  color: var(--admin-text);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: var(--admin-font-xs);
  font-variant-numeric: tabular-nums;
  text-align: right;
}

.trace-header__details-sep {
  grid-column: 1 / -1;
  height: 1px;
  margin: 4px 0;
  background: var(--admin-border);
}
</style>
