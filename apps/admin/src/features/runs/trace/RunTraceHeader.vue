<script setup lang="ts">
import type { RunDetail } from '../run.model'
import { CopyOutlined, DownOutlined } from '@ant-design/icons-vue'
import { App as AntApp, Popover } from 'ant-design-vue'
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import RunStatusTag from '../components/RunStatusTag.vue'
import { formatDateTime, formatTokens } from '../run.utils'
import { writeClipboardText } from './clipboard'

const props = defineProps<{
  run: RunDetail
}>()

const { message } = AntApp.useApp()
const { locale, t } = useI18n()
const detailsOpen = ref(false)
// 失败类别只对 FAILED / ABORTED 有意义；字段上线前的旧 Run 为 null，显示「未记录」。
const showErrorCode = computed(() => props.run.status === 'FAILED' || props.run.status === 'ABORTED')
const errorCodeLabel = computed(() => (
  props.run.errorCode
    ? t(`runTrace.errorCodes.${props.run.errorCode}`)
    : t('runTrace.inspector.unavailable')
))

async function copyRunId() {
  try {
    await writeClipboardText(props.run.id)
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
    <span v-if="showErrorCode" class="trace-header__failure">
      <span class="trace-header__label">{{ t('runTrace.header.errorCode') }}</span>
      <span class="trace-header__failure-value" :class="{ 'is-unrecorded': !run.errorCode }">{{ errorCodeLabel }}</span>
      <code v-if="run.errorCode" class="trace-header__failure-code">{{ run.errorCode }}</code>
    </span>
    <RouterLink
      class="trace-header__conversation"
      :to="{ name: 'conversation-detail', params: { conversationId: run.conversationId } }"
      :title="run.conversationId"
    >
      {{ t('runTrace.header.conversation') }} · {{ run.conversationId }}
    </RouterLink>

    <div class="trace-header__meta">
      <span class="trace-header__stat">
        <span class="trace-header__stat-label">{{ t('runDetail.fields.totalTokens') }}</span>
        <span class="trace-header__stat-value">{{ formatTokens(run.usage.totalTokens, locale) }}</span>
      </span>

      <Popover v-model:open="detailsOpen" trigger="click" placement="leftTop">
        <template #content>
          <dl class="trace-header__details">
            <dt>{{ t('runDetail.fields.inputTokens') }}</dt>
            <dd>{{ formatTokens(run.usage.inputTokens, locale) }}</dd>
            <dt>{{ t('runDetail.fields.outputTokens') }}</dt>
            <dd>{{ formatTokens(run.usage.outputTokens, locale) }}</dd>
            <dt>{{ t('runDetail.fields.reasoningTokens') }}</dt>
            <dd>{{ formatTokens(run.usage.reasoningTokens, locale) }}</dd>
            <dt>{{ t('runDetail.fields.promptCacheHitTokens') }}</dt>
            <dd>{{ formatTokens(run.usage.promptCacheHitTokens, locale) }}</dd>
            <dt>{{ t('runDetail.fields.promptCacheMissTokens') }}</dt>
            <dd>{{ formatTokens(run.usage.promptCacheMissTokens, locale) }}</dd>
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

.trace-header__failure {
  display: inline-flex;
  min-width: 0;
  align-items: baseline;
  gap: 6px;
}

.trace-header__failure-value {
  color: var(--admin-danger-strong);
  font-size: var(--admin-font-xs);
  font-weight: 600;
  white-space: nowrap;
}

.trace-header__failure-value.is-unrecorded {
  color: var(--admin-text-muted);
  font-weight: 500;
}

.trace-header__failure-code {
  color: var(--admin-text-muted);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: var(--admin-font-xs);
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
  min-width: 480px;
  /* 两组「名称 值」并排：弹层矮一半，展开时不会压到右侧检查器的标签栏。 */
  grid-template-columns: max-content minmax(0, 1fr) max-content minmax(0, 1fr);
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
