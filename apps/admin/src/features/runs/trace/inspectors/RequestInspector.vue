<script setup lang="ts">
import type {
  AdminContextInspectorOutcome,
  AdminModelSamplingStep,
} from '@agent/contracts'
import { TabPane, Tabs } from 'ant-design-vue'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import {
  formatDateTime,
  formatDuration,
  formatPercentage,
  formatTokens,
} from '../../run.utils'
import DebugJsonPane from './DebugJsonPane.vue'
import InspectorFieldList from './InspectorFieldList.vue'

const props = defineProps<{
  item: AdminModelSamplingStep
}>()

const { locale, t } = useI18n()
const unavailable = computed(() => t('runTrace.inspector.unavailable'))

const summaryFields = computed(() => [
  { label: t('eventDetail.fields.sequence'), value: props.item.sequence },
  { label: t('eventDetail.fields.samplingIndex'), value: show(props.item.samplingIndex) },
  { label: t('eventDetail.fields.attemptId'), value: show(props.item.samplingAttemptId), mono: true },
  { label: t('eventDetail.fields.resolvedModel'), value: show(props.item.contextInspector.resolvedModel), mono: true },
  { label: t('eventDetail.fields.providerId'), value: show(props.item.contextInspector.providerId), mono: true },
  { label: t('eventDetail.fields.modelId'), value: show(props.item.contextInspector.modelId), mono: true },
  { label: t('eventDetail.fields.finishReason'), value: show(props.item.finishReason) },
  { label: t('eventDetail.fields.toolCalls'), value: items(props.item.toolCallCount) },
  { label: t('eventDetail.fields.hasError'), value: yesNo(props.item.hasError) },
])

const budgetFields = computed(() => {
  const context = props.item.contextInspector
  const budgetUsageRatio = context.resolvedInputBudgetTokens !== null
    && context.resolvedInputBudgetTokens > 0
    && context.estimatedInputTokens !== null
    ? context.estimatedInputTokens / context.resolvedInputBudgetTokens
    : null

  return [
    { label: t('eventDetail.fields.resolvedModel'), value: show(context.resolvedModel), mono: true },
    { label: t('eventDetail.fields.resolvedInputBudget'), value: tokens(context.resolvedInputBudgetTokens) },
    { label: t('eventDetail.fields.estimatedInput'), value: tokens(context.estimatedInputTokens) },
    { label: t('eventDetail.fields.budgetUsage'), value: percentage(budgetUsageRatio) },
  ]
})

const adjustmentFields = computed(() => [
  { label: t('eventDetail.fields.contextOutcome'), value: contextOutcome(props.item.contextInspector.outcome) },
])

const usageFields = computed(() => [
  { label: t('eventDetail.fields.inputTokens'), value: tokens(props.item.usage?.inputTokens ?? null) },
  { label: t('eventDetail.fields.outputTokens'), value: tokens(props.item.usage?.outputTokens ?? null) },
  { label: t('eventDetail.fields.totalTokens'), value: tokens(props.item.usage?.totalTokens ?? null) },
  { label: t('eventDetail.fields.reasoningTokens'), value: tokens(props.item.usage?.reasoningTokens ?? null) },
  { label: t('eventDetail.fields.promptCacheHitTokens'), value: tokens(props.item.usage?.promptCacheHitTokens ?? null) },
  { label: t('eventDetail.fields.promptCacheMissTokens'), value: tokens(props.item.usage?.promptCacheMissTokens ?? null) },
])

const timingFields = computed(() => [
  { label: t('eventDetail.fields.startedAt'), value: dateTime(props.item.startedAt) },
  { label: t('eventDetail.fields.endedAt'), value: dateTime(props.item.endedAt) },
  { label: t('eventDetail.fields.duration'), value: duration(props.item.durationMs) },
])

function show(value: string | number | null): string | number {
  return value ?? unavailable.value
}

function items(value: number | null): string {
  return value === null ? unavailable.value : t('common.items', { count: value })
}

function tokens(value: number | null): string {
  return value === null ? unavailable.value : formatTokens(value, locale.value)
}

function percentage(value: number | null): string {
  return value === null ? unavailable.value : formatPercentage(value, locale.value)
}

function dateTime(value: string | null): string {
  return value === null ? unavailable.value : formatDateTime(value, locale.value)
}

function duration(value: number | null): string {
  return value === null ? unavailable.value : formatDuration(value)
}

function yesNo(value: boolean): string {
  return value ? t('common.yes') : t('common.no')
}

function contextOutcome(value: AdminContextInspectorOutcome | null): string {
  return value === null ? unavailable.value : t(`eventDetail.context.outcome.${value}`)
}
</script>

<template>
  <Tabs class="trace-inspector-tabs" size="small">
    <TabPane key="summary" :tab="t('runTrace.inspector.tabs.summary')">
      <InspectorFieldList :items="summaryFields" />
    </TabPane>

    <TabPane key="context" :tab="t('runTrace.inspector.tabs.context')">
      <InspectorFieldList :title="t('eventDetail.sections.contextBudget')" :items="budgetFields" />
      <InspectorFieldList :title="t('eventDetail.sections.contextAdjustments')" :items="adjustmentFields" />
    </TabPane>

    <TabPane key="usage" :tab="t('runTrace.inspector.tabs.usage')">
      <InspectorFieldList :items="usageFields" />
    </TabPane>

    <TabPane key="timing" :tab="t('runTrace.inspector.tabs.timing')">
      <InspectorFieldList :items="timingFields" />
    </TabPane>

    <TabPane key="request-body" :tab="t('runTrace.inspector.tabs.requestBody')">
      <DebugJsonPane :capture="item.debugRequestBody" />
    </TabPane>

    <TabPane key="raw-response" :tab="t('runTrace.inspector.tabs.rawResponse')">
      <DebugJsonPane :capture="item.debugRawResponse" response-capture />
    </TabPane>
  </Tabs>
</template>
