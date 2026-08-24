<script setup lang="ts">
import type { AdminGenericStep } from '@agent/contracts'
import { TabPane, Tabs } from 'ant-design-vue'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import { formatDateTime, formatDuration } from '../../run.utils'
import InspectorFieldList from './InspectorFieldList.vue'

const props = defineProps<{
  item: AdminGenericStep
}>()

const { locale, t } = useI18n()
const unavailable = computed(() => t('runTrace.inspector.unavailable'))

const summaryFields = computed(() => [
  { label: t('runTrace.inspector.fields.status'), value: props.item.status },
  { label: t('eventDetail.fields.sequence'), value: props.item.sequence },
  { label: t('runTrace.inspector.fields.type'), value: props.item.type, mono: true },
  { label: t('runTrace.inspector.fields.title'), value: props.item.title },
  { label: t('eventDetail.fields.startedAt'), value: dateTime(props.item.startedAt) },
  { label: t('eventDetail.fields.endedAt'), value: dateTime(props.item.endedAt) },
  { label: t('eventDetail.fields.duration'), value: duration(props.item.durationMs) },
  { label: t('eventDetail.fields.hasError'), value: yesNo(props.item.hasError) },
])

const safeRaw = computed(() => JSON.stringify({
  id: props.item.id,
  sequence: props.item.sequence,
  type: props.item.type,
  title: props.item.title,
  status: props.item.status,
  startedAt: props.item.startedAt,
  endedAt: props.item.endedAt,
  durationMs: props.item.durationMs,
  inputSummary: props.item.inputSummary,
  outputSummary: props.item.outputSummary,
  hasError: props.item.hasError,
}, null, 2))

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

    <TabPane key="safe-raw" :tab="t('runTrace.inspector.tabs.safeRaw')">
      <p class="safe-raw-note">
        {{ t('runTrace.inspector.safeRawDescription') }}
      </p>
      <pre>{{ safeRaw }}</pre>
    </TabPane>
  </Tabs>
</template>

<style scoped>
.safe-raw-note {
  margin: 0 0 12px;
  color: var(--admin-text-muted);
  font-size: var(--admin-font-sm);
  line-height: 1.6;
}

pre {
  max-width: 100%;
  margin: 0;
  padding: 14px;
  overflow: auto;
  border: 1px solid var(--admin-border);
  border-radius: var(--admin-radius-md);
  color: var(--admin-text);
  background: var(--admin-surface-raised);
  box-shadow: var(--admin-shadow-sm);
  font-size: var(--admin-font-xs);
  line-height: 1.65;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
</style>
