<script setup lang="ts">
import type { RunDetail } from '../run.model'
import { CopyOutlined } from '@ant-design/icons-vue'
import { App as AntApp } from 'ant-design-vue'
import { useI18n } from 'vue-i18n'

import RunStatusTag from '../components/RunStatusTag.vue'
import {
  formatDateTime,
  formatDuration,
  formatRequestedModel,
  formatTokens,
} from '../run.utils'

const props = defineProps<{
  run: RunDetail
  requestCount: number
}>()

const { message } = AntApp.useApp()
const { locale, t } = useI18n()

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
    <div class="trace-header__identity">
      <div class="trace-header__run-id">
        <span>{{ t('runTrace.header.runId') }}</span>
        <code :title="run.id">{{ run.id }}</code>
        <button
          type="button"
          class="trace-header__copy"
          :aria-label="t('runTrace.header.copyRunId')"
          :title="t('runTrace.header.copyRunId')"
          @click="copyRunId"
        >
          <CopyOutlined aria-hidden="true" />
        </button>
        <RouterLink
          class="trace-header__conversation"
          :to="{ name: 'conversation-detail', params: { conversationId: run.conversationId } }"
          :title="run.conversationId"
        >
          {{ t('runTrace.header.conversation') }} · {{ run.conversationId }}
        </RouterLink>
      </div>
      <RunStatusTag :status="run.status" />
    </div>

    <dl class="trace-header__metrics">
      <div>
        <dt>{{ t('runDetail.fields.duration') }}</dt>
        <dd>{{ formatDuration(run.durationMs) }}</dd>
      </div>
      <div>
        <dt>{{ t('runTrace.header.requests') }}</dt>
        <dd>{{ requestCount.toLocaleString(locale) }}</dd>
      </div>
      <div>
        <dt>{{ t('runDetail.fields.toolCalls') }}</dt>
        <dd>{{ run.toolCallCount.toLocaleString(locale) }}</dd>
      </div>
      <div>
        <dt>{{ t('runDetail.fields.totalTokens') }}</dt>
        <dd>{{ formatTokens(run.totalTokens, locale) }}</dd>
      </div>
      <div class="trace-header__model">
        <dt>{{ t('runDetail.fields.model') }}</dt>
        <dd :title="formatRequestedModel(run.requestedModel, t('runs.defaultModel'))">
          {{ formatRequestedModel(run.requestedModel, t('runs.defaultModel')) }}
        </dd>
      </div>
      <div>
        <dt>{{ t('runDetail.fields.inputTokens') }}</dt>
        <dd>{{ formatTokens(run.inputTokens, locale) }}</dd>
      </div>
      <div>
        <dt>{{ t('runDetail.fields.outputTokens') }}</dt>
        <dd>{{ formatTokens(run.outputTokens, locale) }}</dd>
      </div>
      <div>
        <dt>{{ t('runDetail.fields.reasoningTokens') }}</dt>
        <dd>{{ formatTokens(run.reasoningTokens, locale) }}</dd>
      </div>
      <div>
        <dt>{{ t('runDetail.fields.promptCacheHitTokens') }}</dt>
        <dd>{{ formatTokens(run.promptCacheHitTokens, locale) }}</dd>
      </div>
      <div>
        <dt>{{ t('runDetail.fields.promptCacheMissTokens') }}</dt>
        <dd>{{ formatTokens(run.promptCacheMissTokens, locale) }}</dd>
      </div>
    </dl>

    <dl class="trace-header__times">
      <div>
        <dt>{{ t('runDetail.fields.created') }}</dt>
        <dd>{{ formatDateTime(run.createdAt, locale) }}</dd>
      </div>
      <div>
        <dt>{{ t('runDetail.fields.started') }}</dt>
        <dd>{{ formatDateTime(run.startedAt, locale) }}</dd>
      </div>
      <div>
        <dt>{{ t('runDetail.fields.ended') }}</dt>
        <dd>{{ formatDateTime(run.endedAt, locale) }}</dd>
      </div>
    </dl>
  </header>
</template>

<style scoped>
.trace-header {
  display: grid;
  flex: none;
  grid-template-columns: minmax(280px, 1.1fr) minmax(560px, 2.9fr);
  min-width: 0;
  border-bottom: 1px solid var(--admin-border);
  background: var(--admin-surface);
}

.trace-header__identity {
  display: flex;
  min-width: 0;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 15px 18px 13px;
  border-right: 1px solid var(--admin-border);
}

.trace-header__run-id {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 28px;
  min-width: 0;
  align-items: center;
  gap: 5px 6px;
}

.trace-header__run-id > span {
  grid-column: 1 / -1;
  color: var(--admin-text-muted);
  font-size: var(--admin-font-2xs);
  font-weight: 700;
  letter-spacing: 0.07em;
  text-transform: uppercase;
}

.trace-header__conversation {
  grid-column: 1 / -1;
  overflow: hidden;
  color: var(--admin-primary);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: var(--admin-font-xs);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.trace-header__run-id code {
  min-width: 0;
  overflow: hidden;
  color: var(--admin-text);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: var(--admin-font-md);
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.trace-header__copy {
  display: inline-grid;
  width: 28px;
  height: 28px;
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

.trace-header__identity :deep(.run-status-tag) {
  min-width: 78px;
  font-size: var(--admin-font-2xs);
}

.trace-header__metrics,
.trace-header__times {
  display: grid;
  min-width: 0;
  margin: 0;
}

.trace-header__metrics {
  grid-template-columns: repeat(4, minmax(88px, 1fr));
  padding: 11px 14px 9px;
}

.trace-header__metrics > div,
.trace-header__times > div {
  min-width: 0;
}

.trace-header__metrics > div {
  padding: 3px 11px;
  border-left: 1px solid var(--admin-border);
}

.trace-header__metrics > div:nth-child(4n + 1) {
  border-left: 0;
}

.trace-header__model {
  grid-column: span 2;
}

.trace-header dt {
  overflow: hidden;
  color: var(--admin-text-muted);
  font-size: var(--admin-font-xs);
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.trace-header dd {
  min-width: 0;
  margin: 4px 0 0;
  overflow: hidden;
  color: var(--admin-text);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: var(--admin-font-sm);
  font-variant-numeric: tabular-nums;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.trace-header__times {
  grid-column: 1 / -1;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  padding: 8px 18px;
  border-top: 1px solid var(--admin-border);
  background: var(--admin-surface-muted);
}

.trace-header__times > div {
  display: grid;
  grid-template-columns: max-content minmax(0, 1fr);
  align-items: center;
  gap: 8px;
}

.trace-header__times dd {
  margin: 0;
  color: var(--admin-text-muted);
  font-size: var(--admin-font-xs);
}

@container run-trace (max-width: 880px) {
  .trace-header {
    grid-template-columns: 1fr;
  }

  .trace-header__identity {
    border-right: 0;
  }

  .trace-header__times {
    grid-column: auto;
  }
}
</style>
