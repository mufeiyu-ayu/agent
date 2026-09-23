<script setup lang="ts">
import type { AdminToolExecutionStep } from '@agent/contracts'
import { TabPane, Tabs } from 'ant-design-vue'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import { formatDateTime, formatDuration, formatJsonText } from '../../run.utils'
import InspectorFieldList from './InspectorFieldList.vue'
import InspectorTextBlock from './InspectorTextBlock.vue'

const props = defineProps<{
  item: AdminToolExecutionStep
}>()

const { locale, t } = useI18n()
const unavailable = computed(() => t('runTrace.inspector.unavailable'))

const summaryFields = computed(() => [
  { label: t('runTrace.inspector.fields.status'), value: props.item.status },
  { label: t('eventDetail.fields.sequence'), value: props.item.sequence },
  { label: t('eventDetail.fields.tool'), value: show(props.item.toolName), mono: true },
  { label: t('eventDetail.fields.callId'), value: show(props.item.callId), mono: true },
  { label: t('eventDetail.fields.samplingAttempt'), value: show(props.item.samplingAttemptId), mono: true },
  { label: t('eventDetail.fields.hasError'), value: yesNo(props.item.hasError) },
])

// 比 API 旧的构建没有这两个字段（undefined），与 null 一样按未记录处理。
const formattedArguments = computed(() => props.item.arguments == null
  ? null
  : formatJsonText(props.item.arguments))

const safeIoFields = computed(() => [
  { label: t('eventDetail.fields.ok'), value: showBoolean(props.item.ok) },
  { label: t('eventDetail.fields.code'), value: show(props.item.code) },
  { label: t('runTrace.inspector.fields.originalChars'), value: chars(props.item.originalChars) },
  { label: t('runTrace.inspector.fields.observationChars'), value: chars(props.item.observationChars) },
  { label: t('eventDetail.fields.truncated'), value: showBoolean(props.item.truncated) },
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

function showBoolean(value: boolean | null): string {
  return value === null ? unavailable.value : yesNo(value)
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
      <InspectorTextBlock
        :title="t('runTrace.inspector.fields.arguments')"
        :text="formattedArguments"
        :empty-text="unavailable"
        data-testid="tool-arguments"
      />
      <!-- 按 Step 重建：同类条目之间切换时组件实例复用，折叠状态不能带到下一条。 -->
      <InspectorTextBlock
        :key="item.id"
        :title="t('runTrace.inspector.fields.observation')"
        :text="item.observation"
        :empty-text="unavailable"
        :meta="chars(item.observationChars)"
        collapsible
        data-testid="tool-observation"
      />
    </TabPane>

    <TabPane key="safe-io" :tab="t('runTrace.inspector.tabs.safeIo')">
      <InspectorFieldList :items="safeIoFields" />
    </TabPane>

    <TabPane key="timing" :tab="t('runTrace.inspector.tabs.timing')">
      <InspectorFieldList :items="timingFields" />
    </TabPane>
  </Tabs>
</template>
