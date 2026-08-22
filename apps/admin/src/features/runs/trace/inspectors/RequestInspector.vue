<script setup lang="ts">
import type {
  AdminContextInspectorAvailability,
  AdminContextInspectorOutcome,
  AdminContextObservationSummary,
  AdminInitialHistoryExcludedReason,
  AdminModelSamplingStep,
} from '@agent/contracts'
import { TabPane, Tabs } from 'ant-design-vue'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import {
  formatDateTime,
  formatDuration,
  formatPercentage,
  formatRequestedModel,
  formatTokens,
} from '../../run.utils'
import DebugJsonPane from './DebugJsonPane.vue'
import InspectorFieldList from './InspectorFieldList.vue'

const props = defineProps<{
  item: AdminModelSamplingStep
  requestNumber: number
}>()

const { locale, t } = useI18n()
const unavailable = computed(() => t('runTrace.inspector.unavailable'))

const summaryFields = computed(() => [
  { label: t('runTrace.inspector.fields.request'), value: t('runTrace.inspector.requestLabel', { number: props.requestNumber }) },
  { label: t('runTrace.inspector.fields.status'), value: props.item.status },
  { label: t('eventDetail.fields.sequence'), value: props.item.sequence },
  { label: t('eventDetail.fields.samplingIndex'), value: show(props.item.samplingIndex) },
  { label: t('eventDetail.fields.attemptId'), value: show(props.item.samplingAttemptId), mono: true },
  { label: t('eventDetail.fields.resolvedModel'), value: show(props.item.contextInspector.resolvedModel), mono: true },
  { label: t('eventDetail.fields.requestedOverride'), value: formatRequestedModel(props.item.requestedModel, t('eventDetail.context.noOverride')), mono: true },
  { label: t('eventDetail.fields.finishReason'), value: show(props.item.finishReason) },
  { label: t('eventDetail.fields.providerItems'), value: items(props.item.providerItemCount) },
  { label: t('eventDetail.fields.toolDeclarations'), value: items(props.item.toolCount) },
  { label: t('eventDetail.fields.toolCalls'), value: items(props.item.toolCallCount) },
  { label: t('eventDetail.fields.textChars'), value: chars(props.item.textChars) },
  { label: t('eventDetail.fields.intermediateText'), value: chars(props.item.intermediateTextChars) },
  { label: t('eventDetail.fields.hasError'), value: yesNo(props.item.hasError) },
])

const budgetFields = computed(() => {
  const context = props.item.contextInspector

  return [
    { label: t('eventDetail.fields.resolvedModel'), value: show(context.resolvedModel), mono: true },
    { label: t('eventDetail.fields.requestedOverride'), value: formatRequestedModel(context.requestedModel, t('eventDetail.context.noOverride')), mono: true },
    { label: t('eventDetail.fields.estimatorStrategy'), value: show(context.estimatorStrategyId), mono: true },
    { label: t('eventDetail.fields.contextWindow'), value: tokens(context.contextWindowTokens) },
    { label: t('eventDetail.fields.applicationInputCap'), value: tokens(context.applicationInputCapTokens) },
    { label: t('eventDetail.fields.outputReserve'), value: tokens(context.outputReserveTokens) },
    { label: t('eventDetail.fields.safetyMargin'), value: tokens(context.safetyMarginTokens) },
    { label: t('eventDetail.fields.resolvedInputBudget'), value: tokens(context.resolvedInputBudgetTokens) },
    { label: t('eventDetail.fields.estimatedInput'), value: tokens(context.estimatedInputTokens) },
    { label: t('eventDetail.fields.budgetUsage'), value: percentage(context.budgetUsageRatio) },
  ]
})

const sourceFields = computed(() => {
  const context = props.item.contextInspector

  return [
    { label: t('eventDetail.fields.prePlanItems'), value: items(context.prePlanItemCount) },
    { label: t('eventDetail.fields.providerItems'), value: items(context.providerItemCount) },
    { label: t('eventDetail.fields.historyCandidates'), value: items(context.historyCandidateCount) },
    { label: t('eventDetail.fields.historyIncluded'), value: items(context.historyIncludedCount) },
    { label: t('eventDetail.fields.historyExcluded'), value: items(context.historyExcludedCount) },
    { label: t('eventDetail.fields.toolExchanges'), value: items(context.toolExchangeCount) },
    { label: t('eventDetail.fields.observations'), value: items(context.observations?.length ?? null) },
  ]
})

const adjustmentFields = computed(() => {
  const context = props.item.contextInspector
  const observations = context.observations

  return [
    { label: t('eventDetail.fields.contextAvailability'), value: contextAvailability(context.availability) },
    { label: t('eventDetail.fields.contextOutcome'), value: contextOutcome(context.outcome) },
    { label: t('eventDetail.fields.initialHistoryReason'), value: initialHistoryReason(context.resolvedModel !== null, context.initialHistoryExcludedReason) },
    { label: t('eventDetail.fields.samplingHistoryExcluded'), value: items(context.samplingHistoryExcludedCount) },
    { label: t('eventDetail.fields.toolCeilingTruncations'), value: items(countTruncations(observations, 'toolCeilingTruncated')) },
    { label: t('eventDetail.fields.contextBudgetTruncations'), value: items(countTruncations(observations, 'contextBudgetTruncated')) },
    ...(observations ?? []).map(observation => ({
      label: t('eventDetail.fields.observationIndex', { index: observation.exchangeIndex + 1 }),
      value: formatObservation(observation),
    })),
  ]
})

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
  { label: t('eventDetail.fields.recordedDuration'), value: duration(props.item.recordedDurationMs) },
])

const safeIoFields = computed(() => [
  { label: t('eventDetail.safeInput'), value: show(props.item.inputSummary) },
  { label: t('eventDetail.safeOutput'), value: show(props.item.outputSummary) },
])

function show(value: string | number | null): string | number {
  return value ?? unavailable.value
}

function chars(value: number | null): string {
  return value === null ? unavailable.value : t('common.chars', { count: value })
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

function contextAvailability(value: AdminContextInspectorAvailability): string {
  return t(`eventDetail.context.availability.${value}`)
}

function contextOutcome(value: AdminContextInspectorOutcome): string {
  return t(`eventDetail.context.outcome.${value}`)
}

function initialHistoryReason(
  hasInitialContext: boolean,
  value: AdminInitialHistoryExcludedReason | null,
): string {
  if (!hasInitialContext)
    return unavailable.value

  return value === null
    ? t('eventDetail.context.historyExcludedReason.none')
    : t(`eventDetail.context.historyExcludedReason.${value}`)
}

function countTruncations(
  observations: AdminContextObservationSummary[] | null,
  key: 'contextBudgetTruncated' | 'toolCeilingTruncated',
): number | null {
  return observations?.filter(observation => observation[key]).length ?? null
}

function formatObservation(observation: AdminContextObservationSummary): string {
  return t('eventDetail.context.observationSummary', {
    original: observation.originalChars.toLocaleString(locale.value),
    toolCeiling: observation.toolCeilingChars.toLocaleString(locale.value),
    final: observation.finalChars.toLocaleString(locale.value),
    toolCeilingTruncated: yesNo(observation.toolCeilingTruncated),
    contextBudgetTruncated: yesNo(observation.contextBudgetTruncated),
  })
}
</script>

<template>
  <Tabs class="trace-inspector-tabs" size="small">
    <TabPane key="summary" :tab="t('runTrace.inspector.tabs.summary')">
      <InspectorFieldList :items="summaryFields" />
    </TabPane>

    <TabPane key="context" :tab="t('runTrace.inspector.tabs.context')">
      <InspectorFieldList :title="t('eventDetail.sections.contextBudget')" :items="budgetFields" />
      <InspectorFieldList :title="t('eventDetail.sections.contextSources')" :items="sourceFields" />
      <InspectorFieldList :title="t('eventDetail.sections.contextAdjustments')" :items="adjustmentFields" />
    </TabPane>

    <TabPane key="usage" :tab="t('runTrace.inspector.tabs.usage')">
      <InspectorFieldList :items="usageFields" />
    </TabPane>

    <TabPane key="timing" :tab="t('runTrace.inspector.tabs.timing')">
      <InspectorFieldList :items="timingFields" />
    </TabPane>

    <TabPane key="safe-io" :tab="t('runTrace.inspector.tabs.safeIo')">
      <InspectorFieldList :items="safeIoFields" />
    </TabPane>

    <TabPane key="request-body" :tab="t('runTrace.inspector.tabs.requestBody')">
      <DebugJsonPane :capture="item.debugRequestBody" />
    </TabPane>

    <TabPane key="raw-response" :tab="t('runTrace.inspector.tabs.rawResponse')">
      <DebugJsonPane :capture="item.debugRawResponse" />
    </TabPane>
  </Tabs>
</template>
