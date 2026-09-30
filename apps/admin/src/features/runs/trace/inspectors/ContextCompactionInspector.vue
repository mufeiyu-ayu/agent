<script setup lang="ts">
import type { AdminContextCompactionStep } from '@agent/contracts'
import { TabPane, Tabs } from 'ant-design-vue'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import { formatDateTime, formatDuration, formatTokens } from '../../run.utils'
import InspectorFieldList from './InspectorFieldList.vue'
import InspectorTextBlock from './InspectorTextBlock.vue'

const props = defineProps<{
  item: AdminContextCompactionStep
  /** 历史压缩写成的那条记录的摘要；本轮压缩的前缀摘要在 Step 自己身上。 */
  historySummary: string | null
}>()

const { locale, t } = useI18n()
const unavailable = computed(() => t('runTrace.inspector.unavailable'))

const summaryFields = computed(() => [
  { label: t('runTrace.inspector.fields.status'), value: props.item.status },
  { label: t('eventDetail.fields.sequence'), value: props.item.sequence },
  { label: t('eventDetail.fields.compactionLayer'), value: props.item.layer ? t(`eventDetail.compaction.layers.${props.item.layer}`) : unavailable.value },
  { label: t('eventDetail.fields.tokensBefore'), value: tokens(props.item.tokensBefore) },
  ...(props.item.layer === 'turn'
    ? [{ label: t('eventDetail.fields.keptFrom'), value: show(props.item.keptFromSamplingAttemptId), mono: true }]
    : [{ label: t('eventDetail.fields.compactionId'), value: show(props.item.compactionId), mono: true }]),
  { label: t('eventDetail.fields.failureReason'), value: props.item.errorMessage ?? '—' },
])

const summary = computed(() => props.item.layer === 'turn' ? props.item.summary : props.historySummary)

const usageFields = computed(() => [
  { label: t('eventDetail.fields.inputTokens'), value: tokens(props.item.usage?.inputTokens ?? null) },
  { label: t('eventDetail.fields.outputTokens'), value: tokens(props.item.usage?.outputTokens ?? null) },
  { label: t('eventDetail.fields.reasoningTokens'), value: tokens(props.item.usage?.reasoningTokens ?? null) },
  { label: t('eventDetail.fields.promptCacheHitTokens'), value: tokens(props.item.usage?.promptCacheHitTokens ?? null) },
])

const timingFields = computed(() => [
  { label: t('eventDetail.fields.startedAt'), value: dateTime(props.item.startedAt) },
  { label: t('eventDetail.fields.endedAt'), value: dateTime(props.item.endedAt) },
  { label: t('eventDetail.fields.duration'), value: duration(props.item.durationMs) },
])

function show(value: string | null): string {
  return value ?? unavailable.value
}

function tokens(value: number | null): string {
  return value === null ? unavailable.value : formatTokens(value, locale.value)
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
      <!-- 失败的压缩没有摘要；按 Step 重建，切换条目时折叠状态不带过去。 -->
      <InspectorTextBlock
        v-if="item.status === 'COMPLETED'"
        :key="item.id"
        :title="t('eventDetail.fields.compactionSummary')"
        :text="summary"
        :empty-text="unavailable"
        collapsible
        data-testid="compaction-summary"
      />
    </TabPane>

    <TabPane key="usage" :tab="t('runTrace.inspector.tabs.usage')">
      <InspectorFieldList :items="usageFields" />
    </TabPane>

    <TabPane key="timing" :tab="t('runTrace.inspector.tabs.timing')">
      <InspectorFieldList :items="timingFields" />
    </TabPane>
  </Tabs>
</template>
