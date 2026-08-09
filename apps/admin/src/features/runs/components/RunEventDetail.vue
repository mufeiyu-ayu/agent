<script setup lang="ts">
import type { RunTimelineItem } from '../run.model'
import {
  Descriptions,
  DescriptionsItem,
  Empty,
  Tag,
} from 'ant-design-vue'
import { computed } from 'vue'

import {
  formatDateTime,
  formatDuration,
  formatRequestedModel,
  formatTokens,
  getTimelineInspectorLabel,
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

const inspectorLabel = computed(() => getTimelineInspectorLabel(props.item))

const sections = computed<DetailSection[]>(() => {
  const item = props.item

  if (!item)
    return []

  const common: DetailSection = {
    title: 'Step metadata',
    items: [
      { label: 'Sequence', value: item.sequence },
      { label: 'Started At', value: formatDateTime(item.startedAt) },
      { label: 'Ended At', value: formatDateTime(item.endedAt) },
      { label: 'Duration', value: formatDuration(item.durationMs) },
      { label: 'Has Error', value: yesNo(item.hasError) },
    ],
  }

  if (item.kind === 'generic')
    return [common]

  switch (item.type) {
    case 'receive_user_message':
      return [common, {
        title: 'Message intake',
        items: [
          { label: 'Message ID', value: show(item.messageId) },
          { label: 'Message Length', value: chars(item.messageLength) },
        ],
      }]
    case 'load_conversation_history':
      return [common, {
        title: 'History projection',
        items: [
          { label: 'History Limit', value: show(item.historyLimit) },
          { label: 'Message Count', value: show(item.messageCount) },
        ],
      }]
    case 'model_sampling':
      return [
        common,
        {
          title: 'Sampling request',
          items: [
            { label: 'Sampling Index', value: show(item.samplingIndex) },
            { label: 'Attempt ID', value: show(item.samplingAttemptId) },
            { label: 'Requested Model', value: formatRequestedModel(item.requestedModel) },
            { label: 'Message Count', value: show(item.messageCount) },
            { label: 'Tool Declarations', value: show(item.toolCount) },
          ],
        },
        {
          title: 'Usage & output',
          items: [
            { label: 'Finish Reason', value: show(item.finishReason) },
            { label: 'Input Tokens', value: formatTokens(item.usage?.inputTokens ?? null) },
            { label: 'Output Tokens', value: formatTokens(item.usage?.outputTokens ?? null) },
            { label: 'Total Tokens', value: formatTokens(item.usage?.totalTokens ?? null) },
            { label: 'Tool Calls', value: show(item.toolCallCount) },
            { label: 'Text Chars', value: chars(item.textChars) },
            { label: 'Intermediate Text', value: chars(item.intermediateTextChars) },
            { label: 'Recorded Duration', value: formatDuration(item.recordedDurationMs) },
          ],
        },
      ]
    case 'tool_execution':
      return [
        common,
        {
          title: 'Tool invocation',
          items: [
            { label: 'Call ID', value: show(item.callId) },
            { label: 'Tool', value: show(item.toolName) },
            { label: 'Version', value: show(item.toolVersion) },
            { label: 'Sampling Attempt', value: show(item.samplingAttemptId) },
            { label: 'Execution Attempt', value: show(item.executionAttempt) },
            { label: 'Raw Arguments', value: chars(item.rawArgumentsChars) },
          ],
        },
        {
          title: 'Safe result summary',
          items: [
            { label: 'OK', value: showBoolean(item.ok) },
            { label: 'Code', value: show(item.code) },
            { label: 'Retryable', value: showBoolean(item.retryable) },
            { label: 'Original', value: chars(item.originalChars) },
            { label: 'Observation', value: chars(item.observationChars) },
            { label: 'Truncated', value: showBoolean(item.truncated) },
            { label: 'Recorded Duration', value: formatDuration(item.recordedDurationMs) },
          ],
        },
      ]
    case 'assistant_output':
      return [common, {
        title: 'User-visible output',
        items: [
          { label: 'Assistant Message ID', value: show(item.assistantMessageId) },
          { label: 'Content Length', value: chars(item.contentLength) },
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
      ? { label: 'Safe input summary', text: item.inputSummary }
      : undefined,
    item.outputSummary
      ? { label: 'Safe output summary', text: item.outputSummary }
      : undefined,
  ].filter((preview): preview is DetailPreview => preview !== undefined)
})

function chars(value: number | null): string {
  return value === null ? '—' : `${value} chars`
}

function show(value: string | number | null): string | number {
  return value ?? '—'
}

function showBoolean(value: boolean | null): string {
  return value === null ? '—' : yesNo(value)
}

function yesNo(value: boolean): string {
  return value ? 'Yes' : 'No'
}
</script>

<template>
  <div v-if="item" class="event-detail">
    <header class="event-detail__header">
      <div>
        <span>{{ inspectorLabel }}</span>
        <h3>{{ item.title }}</h3>
        <code>{{ item.type }}</code>
      </div>
      <div class="event-detail__badges">
        <Tag v-if="item.kind === 'generic'">
          Generic
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

  <Empty v-else description="选择一个 Timeline 节点查看详情" />
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
