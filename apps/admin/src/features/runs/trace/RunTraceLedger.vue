<script setup lang="ts">
import type {
  TraceRecord,
  TraceRequestGroup,
} from './run-trace.model'
import { DownOutlined, RightOutlined } from '@ant-design/icons-vue'
import { Empty } from 'ant-design-vue'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import {
  formatDuration,
  knownTimelineTitleKeys,
} from '../run.utils'
import { resolveTraceRequestModel } from './run-trace.presenter'

type LedgerRow
  = | { kind: 'request', group: TraceRequestGroup }
    | { kind: 'record', record: TraceRecord }

const props = defineProps<{
  records: TraceRecord[]
  requestGroups: TraceRequestGroup[]
  collapsedRequestIds: ReadonlySet<string>
  selectedId: string | undefined
  searchActive: boolean
}>()

const emit = defineEmits<{
  select: [recordId: string]
  toggleRequest: [requestId: string]
}>()

const { t } = useI18n()
const rows = computed<LedgerRow[]>(() => {
  const groupByRecordId = new Map<string, TraceRequestGroup>()
  const insertedGroups = new Set<string>()
  const output: LedgerRow[] = []

  for (const group of props.requestGroups) {
    for (const recordId of group.recordIds)
      groupByRecordId.set(recordId, group)
  }

  for (const record of props.records) {
    const group = groupByRecordId.get(record.id)

    if (group && !insertedGroups.has(group.id)) {
      insertedGroups.add(group.id)
      output.push({ kind: 'request', group })
    }

    if (group && props.collapsedRequestIds.has(group.id) && !props.searchActive)
      continue

    output.push({ kind: 'record', record })
  }

  return output
})

function recordTitle(record: TraceRecord): string {
  return record.item.kind === 'known'
    ? t(knownTimelineTitleKeys[record.item.type])
    : record.item.title
}

function requestModel(group: TraceRequestGroup): string {
  return resolveTraceRequestModel(group, t('runTrace.inspector.unavailable'))
}

function requestLabel(group: TraceRequestGroup): string {
  return t('runTrace.ledger.requestAria', {
    number: group.number,
    model: requestModel(group),
    tools: group.toolRecordIds.length,
  })
}
</script>

<template>
  <section class="trace-ledger" :aria-label="t('runTrace.ledger.ariaLabel')">
    <table v-if="rows.length" class="trace-ledger__table">
      <colgroup>
        <col class="trace-ledger__event-column">
        <col>
      </colgroup>
      <thead>
        <tr>
          <th scope="col">
            {{ t('runTrace.ledger.event') }}
          </th>
          <th scope="col">
            {{ t('runTrace.ledger.content') }}
          </th>
        </tr>
      </thead>
      <tbody>
        <template v-for="row in rows" :key="row.kind === 'record' ? row.record.id : row.group.id">
          <tr
            v-if="row.kind === 'request'"
            class="trace-ledger__request"
            :class="{
              'is-selected': selectedId === row.group.samplingRecordId,
              'is-collapsed': collapsedRequestIds.has(row.group.id) && !searchActive,
            }"
            tabindex="0"
            :aria-label="requestLabel(row.group)"
            :aria-selected="selectedId === row.group.samplingRecordId"
            @click="emit('select', row.group.samplingRecordId)"
            @keydown.enter.self.prevent="emit('select', row.group.samplingRecordId)"
            @keydown.space.self.prevent="emit('select', row.group.samplingRecordId)"
          >
            <td>
              <button
                type="button"
                class="trace-ledger__collapse"
                :disabled="searchActive"
                :aria-label="!searchActive && collapsedRequestIds.has(row.group.id)
                  ? t('runTrace.ledger.expandRequest', { number: row.group.number })
                  : t('runTrace.ledger.collapseRequest', { number: row.group.number })"
                :aria-expanded="!collapsedRequestIds.has(row.group.id) || searchActive"
                @click.stop="emit('toggleRequest', row.group.id)"
              >
                <RightOutlined
                  v-if="collapsedRequestIds.has(row.group.id) && !searchActive"
                  aria-hidden="true"
                />
                <DownOutlined v-else aria-hidden="true" />
              </button>
              <strong>{{ t('runTrace.ledger.requestNumber', { number: row.group.number }) }}</strong>
            </td>
            <td>
              <span class="trace-ledger__request-content">
                <strong :title="requestModel(row.group)">{{ requestModel(row.group) }}</strong>
                <span>{{ t('runTrace.ledger.requestTools', { count: row.group.toolRecordIds.length }) }}</span>
                <small>{{ t('runTrace.ledger.projectedRequest') }}</small>
              </span>
            </td>
          </tr>

          <tr
            v-else
            class="trace-ledger__record"
            :class="[
              `is-${row.record.item.status.toLowerCase()}`,
              `is-${row.record.eventType.toLowerCase()}`,
              {
                'is-selected': selectedId === row.record.id,
                'is-error': row.record.item.hasError,
                'is-unlinked': row.record.unlinked,
              },
            ]"
            tabindex="0"
            :aria-label="`${row.record.eventType}, ${recordTitle(row.record)}, ${row.record.content}`"
            :aria-selected="selectedId === row.record.id"
            @click="emit('select', row.record.id)"
            @keydown.enter.prevent="emit('select', row.record.id)"
            @keydown.space.prevent="emit('select', row.record.id)"
          >
            <td>
              <div class="trace-ledger__event-cell">
                <span class="trace-ledger__kind">
                  <i aria-hidden="true" />
                  {{ row.record.eventType }}
                </span>
                <code>#{{ row.record.item.sequence }}</code>
              </div>
            </td>
            <td>
              <div class="trace-ledger__record-main">
                <span class="trace-ledger__content" :title="row.record.content">
                  <strong>{{ recordTitle(row.record) }}</strong>
                  <span>{{ row.record.content || '—' }}</span>
                </span>
                <span v-if="row.record.unlinked" class="trace-ledger__unlinked">
                  {{ t('runTrace.ledger.unmatchedTool') }}
                </span>
                <small>{{ formatDuration(row.record.item.durationMs) }}</small>
              </div>
            </td>
          </tr>
        </template>
      </tbody>
    </table>

    <Empty
      v-else
      class="trace-ledger__empty"
      :description="searchActive ? t('runTrace.ledger.noResults') : t('timeline.empty')"
    />
  </section>
</template>

<style scoped>
.trace-ledger {
  min-width: 0;
  min-height: 0;
  overflow: auto;
  background: var(--admin-surface);
}

.trace-ledger__table {
  width: 100%;
  min-width: 0;
  border-spacing: 0;
  table-layout: fixed;
  color: var(--admin-text);
  font-size: 13px;
}

.trace-ledger__event-column {
  width: 136px;
}

.trace-ledger th {
  position: sticky;
  z-index: 3;
  top: 0;
  height: 34px;
  padding: 0 12px;
  border-bottom: 1px solid var(--admin-border-strong);
  color: var(--admin-text-muted);
  background: color-mix(in srgb, var(--admin-bg-deep) 70%, var(--admin-surface));
  font-size: 11px;
  font-weight: 600;
  text-align: left;
}

.trace-ledger td {
  height: 48px;
  min-width: 0;
  padding: 0 12px;
  overflow: hidden;
  border-bottom: 1px solid var(--admin-border);
}

.trace-ledger tbody tr {
  outline: 0;
  cursor: pointer;
}

.trace-ledger tbody tr:hover td,
.trace-ledger tbody tr:focus-visible td {
  background: var(--admin-hover);
}

.trace-ledger tbody tr:focus-visible {
  box-shadow: inset 0 0 0 1px var(--admin-primary);
}

.trace-ledger tbody tr.is-selected td {
  background: var(--admin-primary-soft);
}

.trace-ledger tbody tr.is-selected {
  box-shadow: inset 3px 0 var(--admin-primary);
}

.trace-ledger__request td {
  height: 38px;
  border-bottom-color: var(--admin-border-strong);
  background: color-mix(in srgb, var(--admin-bg-deep) 52%, var(--admin-surface));
}

.trace-ledger__request td:first-child,
.trace-ledger__record td:first-child {
  white-space: nowrap;
}

.trace-ledger__request td:first-child {
  color: var(--admin-text-muted);
  font-family: monospace;
  font-size: 11px;
}

.trace-ledger__collapse {
  display: inline-grid;
  width: 24px;
  height: 24px;
  place-items: center;
  margin-right: 3px;
  padding: 0;
  border: 0;
  border-radius: var(--admin-radius);
  color: var(--admin-text-subtle);
  background: transparent;
  cursor: pointer;
  font-size: 9px;
}

.trace-ledger__collapse:hover {
  color: var(--admin-text);
  background: var(--admin-hover);
}

.trace-ledger__collapse:disabled {
  color: var(--admin-text-subtle);
  background: transparent;
  cursor: not-allowed;
  opacity: 0.55;
}

.trace-ledger__request-content {
  display: flex;
  min-width: 0;
  align-items: baseline;
  gap: 12px;
  font-size: 12px;
  white-space: nowrap;
}

.trace-ledger__request-content strong {
  max-width: 42%;
  overflow: hidden;
  color: var(--admin-text);
  text-overflow: ellipsis;
}

.trace-ledger__request-content span,
.trace-ledger__request-content small {
  color: var(--admin-text-muted);
}

.trace-ledger__request-content small {
  margin-left: auto;
  font-size: 10px;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.trace-ledger__event-cell {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 10px;
}

.trace-ledger__kind {
  display: inline-flex;
  width: 72px;
  min-width: 0;
  align-items: center;
  gap: 5px;
  overflow: hidden;
  color: var(--admin-text-muted);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0;
  text-overflow: ellipsis;
}

.trace-ledger__kind i {
  flex: none;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--admin-text-subtle);
}

.is-user .trace-ledger__kind i,
.is-history .trace-ledger__kind i {
  background: var(--admin-success);
}

.is-model .trace-ledger__kind i,
.is-output .trace-ledger__kind i {
  background: var(--trace-model);
}

.is-tool .trace-ledger__kind i {
  background: var(--trace-tools);
}

.trace-ledger__record code {
  color: var(--admin-text-muted);
  font-family: monospace;
  font-size: 10px;
}

.trace-ledger__record-main {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 12px;
}

.trace-ledger__content {
  display: grid;
  flex: 1;
  grid-template-columns: minmax(112px, 0.32fr) minmax(0, 1fr);
  min-width: 0;
  align-items: baseline;
  gap: 10px;
}

.trace-ledger__content strong,
.trace-ledger__content span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.trace-ledger__content strong {
  font-size: 13px;
  font-weight: 650;
}

.trace-ledger__content span,
.trace-ledger__record-main > small {
  color: var(--admin-text-muted);
  font-size: 13px;
}

.trace-ledger__record-main > small {
  flex: none;
  font-family: monospace;
  font-size: 10px;
  font-variant-numeric: tabular-nums;
}

.trace-ledger__unlinked {
  flex: none;
  padding: 1px 5px;
  border: 1px solid var(--admin-border-strong);
  border-radius: var(--admin-radius);
  color: var(--admin-text-muted);
  background: var(--admin-bg-deep);
  font-size: 10px;
}

.trace-ledger__record.is-error .trace-ledger__content strong,
.trace-ledger__record.is-failed .trace-ledger__content strong {
  text-decoration: underline;
  text-decoration-style: dotted;
  text-underline-offset: 3px;
}

.trace-ledger__empty {
  display: grid;
  min-height: 260px;
  place-items: center;
}

@container run-trace (max-width: 690px) {
  .trace-ledger__event-column {
    width: 116px;
  }

  .trace-ledger__kind {
    width: 64px;
    font-size: 10px;
  }

  .trace-ledger__content {
    grid-template-columns: 1fr;
    gap: 1px;
  }

  .trace-ledger__request-content small,
  .trace-ledger__record code {
    display: none;
  }
}
</style>
