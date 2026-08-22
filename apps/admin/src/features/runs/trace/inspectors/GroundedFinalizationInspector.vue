<script setup lang="ts">
import type { AdminGroundedFinalizationStep } from '@agent/contracts'
import { TabPane, Tabs } from 'ant-design-vue'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import { formatDateTime, formatDuration, formatTokens } from '../../run.utils'
import InspectorFieldList from './InspectorFieldList.vue'

const props = defineProps<{
  item: AdminGroundedFinalizationStep
}>()

const { locale, t } = useI18n()
const unavailable = computed(() => t('runTrace.inspector.unavailable'))

const summaryFields = computed(() => [
  { label: t('runTrace.inspector.fields.status'), value: props.item.status },
  { label: t('eventDetail.fields.sequence'), value: props.item.sequence },
  {
    label: t('retrieval.fields.validation'),
    value: t(`retrieval.validation.${props.item.validation}`),
  },
  {
    label: t('retrieval.fields.evidenceAvailability'),
    value: props.item.evidenceAvailability === null
      ? unavailable.value
      : t(`retrieval.evidenceAvailability.${props.item.evidenceAvailability}`),
  },
  {
    label: t('retrieval.fields.outcome'),
    value: props.item.outcome === null
      ? unavailable.value
      : t(`retrieval.outcome.${props.item.outcome}`),
  },
  {
    label: t('retrieval.fields.failureReason'),
    value: props.item.failureReason ?? unavailable.value,
    mono: true,
  },
  { label: t('eventDetail.fields.hasError'), value: yesNo(props.item.hasError) },
])

const auditFields = computed(() => [
  {
    label: t('retrieval.fields.attempts'),
    value: props.item.attemptCount === null
      ? unavailable.value
      : `${props.item.attemptCount} / ${props.item.maxAttempts}`,
  },
  {
    label: t('retrieval.fields.registryRefCount'),
    value: show(props.item.registryRefCount),
  },
  {
    label: t('retrieval.fields.registryTruncated'),
    value: showBoolean(props.item.registryTruncated),
  },
  {
    label: t('retrieval.fields.citationCount'),
    value: show(props.item.citationCount),
  },
  {
    label: t('retrieval.fields.assistantMessageId'),
    value: show(props.item.assistantMessageId),
    mono: true,
  },
  { label: t('eventDetail.safeInput'), value: show(props.item.inputSummary) },
  { label: t('eventDetail.safeOutput'), value: show(props.item.outputSummary) },
])

const timingFields = computed(() => [
  { label: t('eventDetail.fields.startedAt'), value: dateTime(props.item.startedAt) },
  { label: t('eventDetail.fields.endedAt'), value: dateTime(props.item.endedAt) },
  { label: t('eventDetail.fields.duration'), value: duration(props.item.durationMs) },
])

const usageFields = computed(() => [
  { label: t('eventDetail.fields.inputTokens'), value: tokens(props.item.usage?.inputTokens ?? null) },
  { label: t('eventDetail.fields.outputTokens'), value: tokens(props.item.usage?.outputTokens ?? null) },
  { label: t('eventDetail.fields.totalTokens'), value: tokens(props.item.usage?.totalTokens ?? null) },
  { label: t('eventDetail.fields.reasoningTokens'), value: tokens(props.item.usage?.reasoningTokens ?? null) },
  { label: t('eventDetail.fields.promptCacheHitTokens'), value: tokens(props.item.usage?.promptCacheHitTokens ?? null) },
  { label: t('eventDetail.fields.promptCacheMissTokens'), value: tokens(props.item.usage?.promptCacheMissTokens ?? null) },
])

function show(value: string | number | null): string | number {
  return value ?? unavailable.value
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

function tokens(value: number | null): string {
  return value === null ? unavailable.value : formatTokens(value, locale.value)
}
</script>

<template>
  <Tabs class="trace-inspector-tabs" size="small">
    <TabPane key="summary" :tab="t('runTrace.inspector.tabs.summary')">
      <InspectorFieldList :items="summaryFields" />
    </TabPane>

    <TabPane key="audit" :tab="t('runTrace.inspector.tabs.safeIo')">
      <InspectorFieldList :items="auditFields" />
    </TabPane>

    <TabPane key="usage" :tab="t('runTrace.inspector.tabs.usage')">
      <InspectorFieldList :items="usageFields" />
    </TabPane>

    <TabPane key="timing" :tab="t('runTrace.inspector.tabs.timing')">
      <InspectorFieldList :items="timingFields" />
    </TabPane>
  </Tabs>
</template>
