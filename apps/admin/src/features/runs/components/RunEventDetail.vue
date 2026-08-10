<script setup lang="ts">
import type { RunTimelineItem } from '../run.model'
import {
  Descriptions,
  DescriptionsItem,
  Empty,
  Tag,
} from 'ant-design-vue'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import {
  formatDateTime,
  formatDuration,
  formatRequestedModel,
  formatTokens,
  knownTimelineInspectorKeys,
  knownTimelineTitleKeys,
} from '../run.utils'
import RunStatusTag from './RunStatusTag.vue'

interface DetailSection {
  title: string
  items: Array<{ label: string, value: string | number }>
}

interface DetailPreview {
  label: string
  text: string
}

const props = defineProps<{
  item: RunTimelineItem | undefined
}>()

const { locale, t } = useI18n()
const inspectorLabel = computed(() => {
  const item = props.item
  return item?.kind === 'known'
    ? t(knownTimelineInspectorKeys[item.type])
    : t('timeline.inspectors.generic')
})
const timelineTitle = computed(() => {
  const item = props.item
  return item?.kind === 'known' ? t(knownTimelineTitleKeys[item.type]) : item?.title
})

const sections = computed<DetailSection[]>(() => {
  const item = props.item

  if (!item)
    return []

  const common: DetailSection = {
    title: t('eventDetail.sections.metadata'),
    items: [
      { label: t('eventDetail.fields.sequence'), value: item.sequence },
      { label: t('eventDetail.fields.startedAt'), value: formatDateTime(item.startedAt, locale.value) },
      { label: t('eventDetail.fields.endedAt'), value: formatDateTime(item.endedAt, locale.value) },
      { label: t('eventDetail.fields.duration'), value: formatDuration(item.durationMs) },
      { label: t('eventDetail.fields.hasError'), value: yesNo(item.hasError) },
    ],
  }

  if (item.kind === 'generic')
    return [common]

  switch (item.type) {
    case 'receive_user_message':
      return [common, {
        title: t('eventDetail.sections.messageIntake'),
        items: [
          { label: t('eventDetail.fields.messageId'), value: show(item.messageId) },
          { label: t('eventDetail.fields.messageLength'), value: chars(item.messageLength) },
        ],
      }]
    case 'load_conversation_history':
      return [common, {
        title: t('eventDetail.sections.historyProjection'),
        items: [
          { label: t('eventDetail.fields.historyLimit'), value: show(item.historyLimit) },
          { label: t('eventDetail.fields.messageCount'), value: show(item.messageCount) },
        ],
      }]
    case 'model_sampling':
      return [
        common,
        {
          title: t('eventDetail.sections.samplingRequest'),
          items: [
            { label: t('eventDetail.fields.samplingIndex'), value: show(item.samplingIndex) },
            { label: t('eventDetail.fields.attemptId'), value: show(item.samplingAttemptId) },
            { label: t('eventDetail.fields.requestedModel'), value: formatRequestedModel(item.requestedModel, t('runs.defaultModel')) },
            { label: t('eventDetail.fields.messageCount'), value: show(item.messageCount) },
            { label: t('eventDetail.fields.toolDeclarations'), value: show(item.toolCount) },
          ],
        },
        {
          title: t('eventDetail.sections.usageOutput'),
          items: [
            { label: t('eventDetail.fields.finishReason'), value: show(item.finishReason) },
            { label: t('eventDetail.fields.inputTokens'), value: formatTokens(item.usage?.inputTokens ?? null, locale.value) },
            { label: t('eventDetail.fields.outputTokens'), value: formatTokens(item.usage?.outputTokens ?? null, locale.value) },
            { label: t('eventDetail.fields.totalTokens'), value: formatTokens(item.usage?.totalTokens ?? null, locale.value) },
            { label: t('eventDetail.fields.toolCalls'), value: show(item.toolCallCount) },
            { label: t('eventDetail.fields.textChars'), value: chars(item.textChars) },
            { label: t('eventDetail.fields.intermediateText'), value: chars(item.intermediateTextChars) },
            { label: t('eventDetail.fields.recordedDuration'), value: formatDuration(item.recordedDurationMs) },
          ],
        },
      ]
    case 'tool_execution':
      return [
        common,
        {
          title: t('eventDetail.sections.toolInvocation'),
          items: [
            { label: t('eventDetail.fields.callId'), value: show(item.callId) },
            { label: t('eventDetail.fields.tool'), value: show(item.toolName) },
            { label: t('eventDetail.fields.version'), value: show(item.toolVersion) },
            { label: t('eventDetail.fields.samplingAttempt'), value: show(item.samplingAttemptId) },
            { label: t('eventDetail.fields.executionAttempt'), value: show(item.executionAttempt) },
            { label: t('eventDetail.fields.rawArguments'), value: chars(item.rawArgumentsChars) },
          ],
        },
        {
          title: t('eventDetail.sections.safeResult'),
          items: [
            { label: t('eventDetail.fields.ok'), value: showBoolean(item.ok) },
            { label: t('eventDetail.fields.code'), value: show(item.code) },
            { label: t('eventDetail.fields.retryable'), value: showBoolean(item.retryable) },
            { label: t('eventDetail.fields.original'), value: chars(item.originalChars) },
            { label: t('eventDetail.fields.observation'), value: chars(item.observationChars) },
            { label: t('eventDetail.fields.truncated'), value: showBoolean(item.truncated) },
            { label: t('eventDetail.fields.recordedDuration'), value: formatDuration(item.recordedDurationMs) },
          ],
        },
      ]
    case 'assistant_output':
      return [common, {
        title: t('eventDetail.sections.assistantOutput'),
        items: [
          { label: t('eventDetail.fields.assistantMessageId'), value: show(item.assistantMessageId) },
          { label: t('eventDetail.fields.contentLength'), value: chars(item.contentLength) },
        ],
      }]
  }

  return [common]
})

const previews = computed<DetailPreview[]>(() => {
  const item = props.item

  if (!item)
    return []

  return [
    item.inputSummary
      ? { label: t('eventDetail.safeInput'), text: item.inputSummary }
      : undefined,
    item.outputSummary
      ? { label: t('eventDetail.safeOutput'), text: item.outputSummary }
      : undefined,
  ].filter((preview): preview is DetailPreview => preview !== undefined)
})

function chars(value: number | null): string {
  return value === null ? '—' : t('common.chars', { count: value })
}

function show(value: string | number | null): string | number {
  return value ?? '—'
}

function showBoolean(value: boolean | null): string {
  return value === null ? '—' : yesNo(value)
}

function yesNo(value: boolean): string {
  return value ? t('common.yes') : t('common.no')
}
</script>

<template>
  <div v-if="item" class="event-detail">
    <header class="event-detail__header">
      <div>
        <span>{{ inspectorLabel }}</span>
        <h3>{{ timelineTitle }}</h3>
        <code>{{ item.type }}</code>
      </div>
      <div class="event-detail__badges">
        <Tag v-if="item.kind === 'generic'">
          {{ t('common.generic') }}
        </Tag>
        <RunStatusTag :status="item.status" />
      </div>
    </header>

    <section v-for="section in sections" :key="section.title" class="event-detail__section">
      <h4>{{ section.title }}</h4>
      <Descriptions bordered size="small" :column="2">
        <DescriptionsItem
          v-for="entry in section.items"
          :key="entry.label"
          :label="entry.label"
        >
          <span class="event-detail__value">{{ entry.value }}</span>
        </DescriptionsItem>
      </Descriptions>
    </section>

    <section v-if="previews.length" class="event-detail__previews">
      <article v-for="preview in previews" :key="preview.label">
        <span>{{ preview.label }}</span>
        <p>{{ preview.text }}</p>
      </article>
    </section>
  </div>

  <Empty v-else :description="t('eventDetail.selectPrompt')" />
</template>

<style scoped>
.event-detail {
  min-width: 0;
}

.event-detail__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding-bottom: 15px;
  border-bottom: 1px solid var(--admin-border);
}

.event-detail__header > div:first-child {
  min-width: 0;
}

.event-detail__header span {
  color: var(--admin-text-subtle);
  font-size: 10px;
  font-weight: 650;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.event-detail__header h3 {
  margin: 5px 0 3px;
  color: var(--admin-text);
  font-size: 15px;
  font-weight: 650;
  overflow-wrap: anywhere;
}

.event-detail__header code {
  color: var(--admin-text-muted);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 10px;
  overflow-wrap: anywhere;
}

.event-detail__badges {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 6px;
}

.event-detail__badges :deep(.ant-tag) {
  margin: 0;
}

.event-detail__section {
  margin-top: 16px;
}

.event-detail__section h4 {
  margin: 0 0 8px;
  color: var(--admin-text);
  font-size: 11px;
  font-weight: 650;
  letter-spacing: 0.035em;
  text-transform: uppercase;
}

.event-detail__section :deep(.ant-descriptions-item-label) {
  width: 132px;
  color: var(--admin-text-muted);
  font-size: 11px;
}

.event-detail__section :deep(.ant-descriptions-item-content) {
  min-width: 0;
  font-size: 11px;
}

.event-detail__value {
  overflow-wrap: anywhere;
}

.event-detail__previews {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
  margin-top: 16px;
}

.event-detail__previews article {
  min-width: 0;
  padding: 12px;
  border: 1px solid var(--admin-border);
  border-radius: 7px;
  background: var(--admin-bg-deep);
}

.event-detail__previews span {
  color: var(--admin-text-subtle);
  font-size: 10px;
  font-weight: 650;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.event-detail__previews p {
  margin: 7px 0 0;
  color: var(--admin-text-muted);
  font-size: 11px;
  line-height: 1.65;
  overflow-wrap: anywhere;
}

@media (max-width: 1180px) {
  .event-detail__previews {
    grid-template-columns: 1fr;
  }
}
</style>
