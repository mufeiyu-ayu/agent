<script setup lang="ts">
import type { AdminToolExecutionStep } from '@agent/contracts'
import { TabPane, Tabs } from 'ant-design-vue'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import { formatDateTime, formatDuration } from '../../run.utils'
import InspectorFieldList from './InspectorFieldList.vue'

const props = defineProps<{
  item: AdminToolExecutionStep
}>()

const { locale, t } = useI18n()
const unavailable = computed(() => t('runTrace.inspector.unavailable'))

const summaryFields = computed(() => [
  { label: t('runTrace.inspector.fields.status'), value: props.item.status },
  { label: t('eventDetail.fields.sequence'), value: props.item.sequence },
  { label: t('eventDetail.fields.tool'), value: show(props.item.toolName), mono: true },
  { label: t('eventDetail.fields.version'), value: show(props.item.toolVersion), mono: true },
  { label: t('eventDetail.fields.callId'), value: show(props.item.callId), mono: true },
  { label: t('eventDetail.fields.samplingAttempt'), value: show(props.item.samplingAttemptId), mono: true },
  { label: t('eventDetail.fields.executionAttempt'), value: show(props.item.executionAttempt) },
  { label: t('eventDetail.fields.hasError'), value: yesNo(props.item.hasError) },
])

const safeIoFields = computed(() => [
  { label: t('runTrace.inspector.fields.rawArgumentsChars'), value: chars(props.item.rawArgumentsChars) },
  { label: t('eventDetail.fields.ok'), value: showBoolean(props.item.ok) },
  { label: t('eventDetail.fields.code'), value: show(props.item.code) },
  { label: t('eventDetail.fields.retryable'), value: showBoolean(props.item.retryable) },
  { label: t('runTrace.inspector.fields.originalChars'), value: chars(props.item.originalChars) },
  { label: t('runTrace.inspector.fields.observationChars'), value: chars(props.item.observationChars) },
  { label: t('eventDetail.fields.truncated'), value: showBoolean(props.item.truncated) },
  { label: t('eventDetail.safeInput'), value: show(props.item.inputSummary) },
  { label: t('eventDetail.safeOutput'), value: show(props.item.outputSummary) },
])

const timingFields = computed(() => [
  { label: t('eventDetail.fields.startedAt'), value: dateTime(props.item.startedAt) },
  { label: t('eventDetail.fields.endedAt'), value: dateTime(props.item.endedAt) },
  { label: t('eventDetail.fields.duration'), value: duration(props.item.durationMs) },
  { label: t('eventDetail.fields.recordedDuration'), value: duration(props.item.recordedDurationMs) },
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
    </TabPane>

    <TabPane key="safe-io" :tab="t('runTrace.inspector.tabs.safeIo')">
      <InspectorFieldList :items="safeIoFields" />
    </TabPane>

    <TabPane key="timing" :tab="t('runTrace.inspector.tabs.timing')">
      <InspectorFieldList :items="timingFields" />
    </TabPane>
  </Tabs>
</template>
