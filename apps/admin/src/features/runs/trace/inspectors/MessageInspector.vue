<script setup lang="ts">
import type {
  AdminAssistantOutputStep,
  AdminLoadConversationHistoryStep,
  AdminReceiveUserMessageStep,
} from '@agent/contracts'
import { TabPane, Tabs } from 'ant-design-vue'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import { formatDateTime, formatDuration } from '../../run.utils'
import InspectorFieldList from './InspectorFieldList.vue'

type MessageStep
  = | AdminAssistantOutputStep
    | AdminLoadConversationHistoryStep
    | AdminReceiveUserMessageStep

const props = defineProps<{
  contentPreview: string | null
  item: MessageStep
}>()

const { locale, t } = useI18n()
const unavailable = computed(() => t('runTrace.inspector.unavailable'))

const summaryFields = computed(() => {
  const common = [
    { label: t('runTrace.inspector.fields.status'), value: props.item.status },
    { label: t('eventDetail.fields.sequence'), value: props.item.sequence },
    { label: t('eventDetail.fields.hasError'), value: yesNo(props.item.hasError) },
  ]

  switch (props.item.type) {
    case 'receive_user_message':
      return [
        ...common,
        { label: t('eventDetail.fields.messageId'), value: show(props.item.messageId), mono: true },
        { label: t('eventDetail.fields.messageLength'), value: chars(props.item.messageLength) },
      ]
    case 'load_conversation_history':
      return [
        ...common,
        { label: t('eventDetail.fields.historyLimit'), value: show(props.item.historyLimit) },
        { label: t('eventDetail.fields.messageCount'), value: show(props.item.messageCount) },
      ]
    case 'assistant_output':
      return [
        ...common,
        { label: t('eventDetail.fields.assistantMessageId'), value: show(props.item.assistantMessageId), mono: true },
        { label: t('eventDetail.fields.contentLength'), value: chars(props.item.contentLength) },
      ]
  }

  return common
})

const safeContentFields = computed(() => [
  { label: t('eventDetail.safeInput'), value: show(props.item.inputSummary) },
  { label: t('eventDetail.safeOutput'), value: show(props.item.outputSummary) },
])

const timingFields = computed(() => [
  { label: t('eventDetail.fields.startedAt'), value: dateTime(props.item.startedAt) },
  { label: t('eventDetail.fields.endedAt'), value: dateTime(props.item.endedAt) },
  { label: t('eventDetail.fields.duration'), value: duration(props.item.durationMs) },
])

function show(value: string | number | null): string | number {
  return value ?? unavailable.value
}

function chars(value: number | null): string {
  return value === null ? unavailable.value : t('common.chars', { count: value })
}

function yesNo(value: boolean): string {
  return value ? t('common.yes') : t('common.no')
}

function dateTime(value: string | null): string {
  return value === null ? unavailable.value : formatDateTime(value, locale.value)
}

function duration(value: number | null): string {
  return value === null ? unavailable.value : formatDuration(value)
}
</script>

<template>
  <Tabs class="trace-inspector-tabs" size="small">
    <TabPane key="summary" :tab="t('runTrace.inspector.tabs.summary')">
      <InspectorFieldList :items="summaryFields" />
    </TabPane>

    <TabPane key="content" :tab="t('runTrace.inspector.tabs.content')">
      <article class="message-preview">
        <span>{{ t('runTrace.inspector.fields.messagePreview') }}</span>
        <p :title="contentPreview ?? unavailable">
          {{ contentPreview ?? unavailable }}
        </p>
      </article>
      <InspectorFieldList :items="safeContentFields" />
    </TabPane>

    <TabPane key="timing" :tab="t('runTrace.inspector.tabs.timing')">
      <InspectorFieldList :items="timingFields" />
    </TabPane>
  </Tabs>
</template>

<style scoped>
.message-preview {
  min-width: 0;
  margin-bottom: 20px;
  padding: 15px;
  border: 1px solid var(--admin-border);
  border-radius: var(--admin-radius);
  background: var(--admin-bg-deep);
}

.message-preview span {
  color: var(--admin-text-muted);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.07em;
  text-transform: uppercase;
}

.message-preview p {
  margin: 9px 0 0;
  color: var(--admin-text);
  font-size: 13px;
  line-height: 1.65;
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}
</style>
