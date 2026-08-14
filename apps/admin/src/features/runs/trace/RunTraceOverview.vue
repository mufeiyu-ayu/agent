<script setup lang="ts">
import type {
  TraceLane,
  TraceOverviewSpan,
  TraceRecord,
} from './run-trace.model'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import { formatDateTime, formatDuration, knownTimelineTitleKeys } from '../run.utils'

const props = defineProps<{
  spans: TraceOverviewSpan[]
  records: TraceRecord[]
  timelineStartMs: number | null
  timelineEndMs: number | null
  selectedId: string | undefined
}>()

const emit = defineEmits<{
  select: [recordId: string]
}>()

const { locale, t } = useI18n()
const lanes = computed<Array<{ id: TraceLane, label: string }>>(() => [
  { id: 'input', label: t('runTrace.overview.lanes.input') },
  { id: 'model', label: t('runTrace.overview.lanes.model') },
  { id: 'tools', label: t('runTrace.overview.lanes.tools') },
])
const recordsById = computed(() => new Map(props.records.map(record => [record.id, record])))
const positionedSpans = computed(() => props.spans.filter(span => span.startedAtMs !== null))
const unavailableSpanCount = computed(() => props.spans.length - positionedSpans.value.length)
const domainDuration = computed(() => {
  if (props.timelineStartMs === null || props.timelineEndMs === null)
    return null

  return Math.max(0, props.timelineEndMs - props.timelineStartMs)
})

function spansFor(lane: TraceLane): TraceOverviewSpan[] {
  return props.spans.filter(span => span.lane === lane && span.startedAtMs !== null)
}

function spanStyle(span: TraceOverviewSpan): Record<string, string> {
  if (props.timelineStartMs === null || span.startedAtMs === null)
    return {}

  const domain = Math.max(1, domainDuration.value ?? 0)
  const left = Math.min(100, Math.max(0, (span.startedAtMs - props.timelineStartMs) / domain * 100))
  const measuredDuration = span.endAtMs === null
    ? (span.durationMs ?? 0)
    : Math.max(0, span.endAtMs - span.startedAtMs)
  const width = span.marker
    ? '3px'
    : `${Math.max(0.45, Math.min(100 - left, measuredDuration / domain * 100))}%`

  return {
    '--trace-span-left': span.marker && left === 100
      ? 'calc(100% - 3px)'
      : `${left}%`,
    '--trace-span-width': width,
  }
}

function recordTitle(record: TraceRecord | undefined): string {
  if (!record)
    return t('runTrace.overview.unknownEvent')

  return record.item.kind === 'known'
    ? t(knownTimelineTitleKeys[record.item.type])
    : record.item.title
}

function spanLabel(span: TraceOverviewSpan): string {
  const record = recordsById.value.get(span.recordId)
  const unavailable = t('runTrace.inspector.unavailable')

  return t('runTrace.overview.spanLabel', {
    title: recordTitle(record),
    type: record?.item.type ?? unavailable,
    sequence: record?.item.sequence ?? unavailable,
    status: span.status,
    startedAt: record?.item.startedAt === null || record?.item.startedAt === undefined
      ? unavailable
      : formatDateTime(record.item.startedAt, locale.value),
    endedAt: record?.item.endedAt === null || record?.item.endedAt === undefined
      ? unavailable
      : formatDateTime(record.item.endedAt, locale.value),
    duration: span.durationMs === null ? unavailable : formatDuration(span.durationMs),
  })
}
</script>

<template>
  <section class="trace-overview" :aria-label="t('runTrace.overview.ariaLabel')">
    <div class="trace-overview__heading">
      <strong>{{ t('runTrace.overview.title') }}</strong>
      <span v-if="domainDuration !== null">
        {{ t('runTrace.overview.range', { duration: formatDuration(domainDuration) }) }}
      </span>
      <span v-if="unavailableSpanCount">
        {{ t('runTrace.overview.unavailableCount', { count: unavailableSpanCount }) }}
      </span>
    </div>

    <div v-if="positionedSpans.length" class="trace-overview__plot">
      <div
        v-for="lane in lanes"
        :key="lane.id"
        class="trace-overview__lane"
        :class="`is-${lane.id}`"
      >
        <span class="trace-overview__lane-label">{{ lane.label }}</span>
        <div class="trace-overview__track">
          <button
            v-for="span in spansFor(lane.id)"
            :key="span.recordId"
            type="button"
            class="trace-overview__span"
            :class="[
              `is-${span.status.toLowerCase()}`,
              {
                'is-marker': span.marker,
                'is-error': span.hasError,
                'is-selected': selectedId === span.recordId,
              },
            ]"
            :style="spanStyle(span)"
            :aria-label="spanLabel(span)"
            :aria-pressed="selectedId === span.recordId"
            :title="spanLabel(span)"
            @click="emit('select', span.recordId)"
          />
        </div>
      </div>

      <div class="trace-overview__axis" aria-hidden="true">
        <span>0ms</span>
        <span>{{ formatDuration(domainDuration) }}</span>
      </div>
    </div>

    <p v-else class="trace-overview__empty">
      {{ t('runTrace.overview.noTiming') }}
    </p>
  </section>
</template>

<style scoped>
.trace-overview {
  flex: none;
  min-width: 0;
  padding: 7px 12px 8px;
  border-bottom: 1px solid var(--admin-border);
  background: var(--admin-surface);
}

.trace-overview__heading {
  display: flex;
  min-width: 0;
  align-items: center;
  justify-content: flex-start;
  gap: 14px;
  min-height: 22px;
  margin-bottom: 5px;
}

.trace-overview__heading strong {
  color: var(--admin-text);
  font-size: 12px;
  font-weight: 650;
}

.trace-overview__heading > span:first-of-type {
  margin-left: auto;
}

.trace-overview__heading span,
.trace-overview__axis,
.trace-overview__empty {
  color: var(--admin-text-muted);
  font-size: 10px;
  font-variant-numeric: tabular-nums;
}

.trace-overview__plot {
  display: grid;
  grid-template-columns: 54px minmax(0, 1fr);
  min-width: 0;
  row-gap: 3px;
}

.trace-overview__lane {
  display: contents;
}

.trace-overview__lane-label {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  padding-right: 9px;
  color: var(--admin-text-muted);
  font-size: 11px;
  font-weight: 600;
}

.trace-overview__track {
  position: relative;
  height: 14px;
  overflow: hidden;
  border-left: 1px solid var(--admin-border-strong);
  background: repeating-linear-gradient(
    to right,
    transparent 0,
    transparent calc(25% - 1px),
    var(--admin-border) 25%
  );
}

.trace-overview__span {
  --trace-span-color: var(--admin-text-muted);

  position: absolute;
  top: 3px;
  left: var(--trace-span-left);
  width: var(--trace-span-width);
  min-width: 3px;
  height: 8px;
  padding: 0;
  border: 0;
  border-radius: var(--admin-radius);
  background: var(--trace-span-color);
  cursor: pointer;
  opacity: 0.72;
}

.trace-overview__span:hover,
.trace-overview__span:focus-visible,
.trace-overview__span.is-selected {
  z-index: 2;
  opacity: 1;
  box-shadow:
    0 0 0 1px var(--admin-surface),
    0 0 0 2px var(--admin-primary);
}

.trace-overview__lane.is-model .trace-overview__span {
  --trace-span-color: var(--trace-model);
}

.trace-overview__lane.is-tools .trace-overview__span {
  --trace-span-color: var(--trace-tools);
}

.trace-overview__span.is-failed,
.trace-overview__span.is-error {
  --trace-span-color: var(--trace-danger);
}

.trace-overview__span.is-aborted {
  --trace-span-color: var(--admin-text-subtle);
}

.trace-overview__span.is-running {
  --trace-span-color: var(--trace-model);
  box-shadow: 0 0 0 2px var(--admin-primary-soft);
}

.trace-overview__span.is-marker {
  top: 0;
  width: 11px;
  min-width: 11px;
  height: 14px;
  border-radius: 0;
  background: transparent;
  transform: translateX(-4px);
}

.trace-overview__span.is-marker::after {
  position: absolute;
  top: 3px;
  left: 4px;
  width: 3px;
  height: 8px;
  background: var(--trace-span-color);
  content: '';
}

.trace-overview__axis {
  display: flex;
  grid-column: 2;
  justify-content: space-between;
  padding-top: 3px;
}

.trace-overview__empty {
  display: grid;
  min-height: 47px;
  margin: 0;
  place-items: center;
}
</style>
