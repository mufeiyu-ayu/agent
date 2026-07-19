<script setup lang="ts">
import type { RunTimelineItem } from '../run.model'
import {
  Descriptions,
  DescriptionsItem,
  Empty,
  Tag,
} from 'ant-design-vue'
import { computed } from 'vue'

import { formatDateTime, formatDuration, formatTokens } from '../run.utils'
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

const sections = computed<DetailSection[]>(() => {
  const item = props.item

  if (!item)
    return []

  switch (item.type) {
    case 'run_lifecycle':
      return [{
        title: 'Run lifecycle',
        items: [
          { label: 'Event', value: item.event },
          { label: 'Source', value: 'AgentRun-derived UI event' },
          { label: 'Occurred At', value: formatDateTime(item.startedAt) },
          { label: 'Durable Step', value: 'No' },
        ],
      }]
    case 'receive_user_message':
      return [{
        title: 'Message intake',
        items: [
          { label: 'Message ID', value: item.messageId },
          { label: 'Content Length', value: `${item.contentLength} chars` },
          { label: 'Created At', value: formatDateTime(item.createdAt) },
          { label: 'Duration', value: formatDuration(item.durationMs) },
        ],
      }]
    case 'load_conversation_history':
      return [{
        title: 'History projection',
        items: [
          { label: 'History Limit', value: item.historyLimit },
          { label: 'Message Count', value: item.messageCount },
          { label: 'Truncated', value: yesNo(item.truncated) },
          { label: 'Duration', value: formatDuration(item.durationMs) },
        ],
      }]
    case 'model_sampling':
      return [
        {
          title: 'Sampling request',
          items: [
            { label: 'Sampling Index', value: item.samplingIndex },
            { label: 'Attempt ID', value: item.samplingAttemptId },
            { label: 'Requested Model', value: item.requestedModel },
            { label: 'Message Count', value: item.messageCount },
            { label: 'Tool Declarations', value: item.toolCount },
            { label: 'Finish Reason', value: item.finishReason ?? 'Unavailable' },
          ],
        },
        {
          title: 'Usage & output',
          items: [
            { label: 'Input Tokens', value: formatTokens(item.inputTokens) },
            { label: 'Output Tokens', value: formatTokens(item.outputTokens) },
            { label: 'Total Tokens', value: formatTokens(item.totalTokens) },
            { label: 'Text Chars', value: item.textChars },
            { label: 'Duration', value: formatDuration(item.durationMs) },
          ],
        },
      ]
    case 'tool_execution':
      return [
        {
          title: 'Tool invocation',
          items: [
            { label: 'Call ID', value: item.callId },
            { label: 'Tool', value: item.toolName },
            { label: 'Version', value: item.toolVersion ?? 'Unavailable' },
            { label: 'Sampling Attempt', value: item.samplingAttemptId },
            { label: 'Execution Attempt', value: item.executionAttempt },
            { label: 'Validation', value: item.validation },
          ],
        },
        {
          title: 'Safe result summary',
          items: [
            { label: 'OK', value: item.ok === null ? 'Unavailable' : yesNo(item.ok) },
            { label: 'Code', value: item.code ?? '—' },
            {
              label: 'Retryable',
              value: item.retryable === null ? 'Unavailable' : yesNo(item.retryable),
            },
            { label: 'Raw Arguments', value: `${item.rawArgumentsChars} chars only` },
            { label: 'Observation', value: `${item.observationChars} chars only` },
            { label: 'Truncated', value: yesNo(item.truncated) },
            { label: 'Duration', value: formatDuration(item.durationMs) },
          ],
        },
      ]
    case 'assistant_output':
      return [{
        title: 'User-visible output',
        items: [
          { label: 'Assistant Message ID', value: item.assistantMessageId },
          {
            label: 'Content Length',
            value: item.contentLength === null ? 'Unavailable' : `${item.contentLength} chars`,
          },
          { label: 'Completed At', value: formatDateTime(item.completedAt) },
          { label: 'Duration', value: formatDuration(item.durationMs) },
        ],
      }]
  }

  return []
})

const previews = computed<DetailPreview[]>(() => {
  const item = props.item

  if (!item)
    return []

  switch (item.type) {
    case 'run_lifecycle':
      return [{ label: 'Derivation note', text: item.summary }]
    case 'receive_user_message':
      return [{ label: 'Safe content preview', text: item.contentPreview }]
    case 'load_conversation_history':
      return [{
        label: 'Projection note',
        text: '这里只展示 history limit、消息数量和是否截断，不展示 system prompt 或完整历史正文。',
      }]
    case 'model_sampling':
      return [
        { label: 'Safe input summary', text: item.inputSummary },
        { label: 'Safe output summary', text: item.outputSummary },
      ]
    case 'tool_execution':
      return [
        { label: 'Safe invocation summary', text: item.inputSummary },
        { label: 'Safe observation summary', text: item.outputSummary },
      ]
    case 'assistant_output':
      return [{
        label: item.contentPreview ? 'User-visible answer preview' : 'Durable output note',
        text: item.contentPreview
          ?? '当前 Step 没有终态 output payload；局部用户可见内容只在 Messages 中展示。',
      }]
  }

  return []
})

function yesNo(value: boolean): string {
  return value ? 'Yes' : 'No'
}
</script>

<template>
  <div v-if="item" class="event-detail">
    <header class="event-detail__header">
      <div>
        <span>
          {{ item.kind === 'derived_lifecycle' ? 'AgentRun-derived lifecycle' : 'Durable AgentStep' }}
        </span>
        <h3>{{ item.title }}</h3>
        <code>{{ item.type }}</code>
      </div>
      <div class="event-detail__badges">
        <Tag v-if="item.kind === 'derived_lifecycle'">
          Derived
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
}

.event-detail__header code {
  color: var(--admin-text-muted);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 10px;
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
}

@media (max-width: 1180px) {
  .event-detail__previews {
    grid-template-columns: 1fr;
  }
}
</style>
