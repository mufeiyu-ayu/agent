<script setup lang="ts">
import type { TableColumnsType } from 'ant-design-vue'
import type { OverviewToolRow } from '../overview.model'

import { Table, Tag, Tooltip } from 'ant-design-vue'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import { formatDuration, formatPercentage } from '@/features/runs/run.utils'

import OverviewCard from './OverviewCard.vue'

defineProps<{
  rows: OverviewToolRow[]
}>()

const { locale, t } = useI18n()

const columns = computed<TableColumnsType<OverviewToolRow>>(() => [
  { title: t('overview.tools.columns.tool'), key: 'tool', ellipsis: true },
  { title: t('overview.tools.columns.calls'), key: 'calls', width: 80, align: 'right' },
  { title: t('overview.tools.columns.failureRate'), key: 'failureRate', width: 90, align: 'right' },
  { title: t('overview.tools.columns.failureCodes'), key: 'failureCodes', width: 260 },
  { title: t('overview.tools.columns.avgDuration'), key: 'avgDuration', width: 100, align: 'right' },
])
</script>

<template>
  <OverviewCard :title="t('overview.tools.title')" :subtitle="t('overview.tools.subtitle')">
    <Table
      v-if="rows.length > 0"
      class="tool-table"
      size="small"
      row-key="name"
      :columns="columns"
      :data-source="rows"
      :pagination="false"
      :scroll="{ x: 640 }"
    >
      <template #bodyCell="{ column, record }">
        <template v-if="column.key === 'tool'">
          <Tooltip :title="record.unknown ? t('overview.tools.unknownHint') : undefined">
            <code class="tool-name" :class="{ 'is-unknown': record.unknown }">{{ record.name }}</code>
          </Tooltip>
        </template>
        <template v-else-if="column.key === 'calls'">
          <span class="numeric-cell">{{ record.callCount.toLocaleString(locale) }}</span>
        </template>
        <template v-else-if="column.key === 'failureRate'">
          <span class="numeric-cell" :class="{ 'is-danger': record.failureRate > 0 }">{{ formatPercentage(record.failureRate, locale) }}</span>
        </template>
        <template v-else-if="column.key === 'failureCodes'">
          <span v-if="record.failureCodes.length === 0" class="numeric-cell is-empty">—</span>
          <span v-else class="failure-codes">
            <Tag v-for="failure in record.failureCodes" :key="failure.code ?? 'unrecorded'" class="failure-code">
              {{ failure.code ?? t('runTrace.inspector.unavailable') }} × {{ failure.count.toLocaleString(locale) }}
            </Tag>
          </span>
        </template>
        <template v-else-if="column.key === 'avgDuration'">
          <span class="numeric-cell" :class="{ 'is-empty': record.avgDurationMs === null }">{{ formatDuration(record.avgDurationMs) }}</span>
        </template>
      </template>
    </Table>
    <p v-else class="tool-empty">
      {{ t('overview.tools.empty') }}
    </p>
  </OverviewCard>
</template>

<style scoped>
.tool-table :deep(.ant-table) {
  font-size: 12px;
}

.tool-table :deep(.ant-table-thead > tr > th) {
  color: var(--admin-text-subtle);
  font-size: 11px;
  font-weight: 600;
  background: transparent;
  white-space: nowrap;
}

.tool-name {
  color: var(--admin-text);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}

.tool-name.is-unknown {
  color: var(--admin-danger-strong);
}

.numeric-cell {
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.numeric-cell.is-empty {
  color: var(--admin-text-subtle);
}

.numeric-cell.is-danger {
  color: var(--admin-danger-strong);
  font-weight: 600;
}

.failure-codes {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.failure-code {
  margin: 0;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 10px;
}

.tool-empty {
  margin: 0;
  color: var(--admin-text-subtle);
  font-size: 13px;
}
</style>
