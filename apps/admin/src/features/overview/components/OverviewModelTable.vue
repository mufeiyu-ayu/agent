<script setup lang="ts">
import type { TableColumnsType } from 'ant-design-vue'
import type { OverviewModelRow } from '../overview.model'

import { Button, Table, Tag, Tooltip } from 'ant-design-vue'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'

import LlmFamilyLogo from '@/features/llm/components/LlmFamilyLogo.vue'
import { formatShortDateTime, formatTokens } from '@/features/runs/run.utils'

import OverviewCard from './OverviewCard.vue'

const props = defineProps<{
  rows: OverviewModelRow[]
  loading: boolean
}>()

const { locale, t } = useI18n()
const router = useRouter()

/** 缓存命中率与平均时长两列等后端提供每模型汇总后再加。 */
const columns = computed<TableColumnsType<OverviewModelRow>>(() => [
  { title: t('overview.models.columns.model'), key: 'model' },
  { title: t('overview.models.columns.calls'), dataIndex: 'samplingCount', key: 'calls', width: 56, align: 'right' },
  { title: t('overview.models.columns.tokens'), key: 'tokens', width: 132 },
  { title: t('overview.models.columns.probe'), key: 'probe', width: 92 },
])

function percent(value: number): string {
  return `${value.toFixed(1)}%`
}

function probeLabel(row: { lastProbeOk?: boolean | null }): string {
  if (row.lastProbeOk === null || row.lastProbeOk === undefined)
    return t('overview.models.probeNever')
  return t(row.lastProbeOk ? 'overview.models.probeOk' : 'overview.models.probeFailed')
}

function probeColor(row: { lastProbeOk?: boolean | null }): string | undefined {
  if (row.lastProbeOk === null || row.lastProbeOk === undefined)
    return undefined
  return row.lastProbeOk ? 'success' : 'error'
}

const hasRows = computed(() => props.rows.length > 0)
</script>

<template>
  <OverviewCard :title="t('overview.models.title')" :subtitle="t('overview.models.subtitle')">
    <template #actions>
      <Button size="small" type="link" class="card-link" @click="router.push({ name: 'llm-models' })">
        {{ t('overview.models.manage') }}
      </Button>
    </template>

    <Table
      v-if="hasRows || loading"
      class="model-table"
      size="small"
      row-key="key"
      :columns="columns"
      :data-source="rows"
      :loading="loading"
      :pagination="false"
      :scroll="{ y: 520 }"
    >
      <template #bodyCell="{ column, record }">
        <template v-if="column.key === 'model'">
          <div class="model-cell">
            <LlmFamilyLogo :family="record.family" :size="15" badge />
            <div class="model-cell__names">
              <span class="model-cell__display">
                {{ record.displayName }}
                <Tag v-if="record.isDefault" class="model-cell__tag" color="processing">
                  {{ t('overview.models.default') }}
                </Tag>
                <Tag v-else-if="!record.visible" class="model-cell__tag">
                  {{ t('overview.models.hidden') }}
                </Tag>
              </span>
              <Tooltip :title="record.providerNote || undefined">
                <span class="model-cell__wire">{{ record.wireName }}</span>
              </Tooltip>
            </div>
          </div>
        </template>
        <template v-else-if="column.key === 'calls'">
          <span class="numeric-cell">{{ record.samplingCount.toLocaleString(locale) }}</span>
        </template>
        <template v-else-if="column.key === 'tokens'">
          <div class="tokens-cell">
            <span class="numeric-cell">{{ formatTokens(record.totalTokens, locale) }}</span>
            <span class="tokens-cell__share">{{ percent(record.share) }}</span>
            <span class="tokens-cell__bar">
              <span class="tokens-cell__fill" :style="{ width: `${Math.min(100, record.share)}%` }" />
            </span>
          </div>
        </template>
        <template v-else-if="column.key === 'probe'">
          <Tooltip :title="record.lastProbedAt ? formatShortDateTime(record.lastProbedAt, locale) : undefined">
            <Tag class="probe-tag" :color="probeColor(record)">
              {{ probeLabel(record) }}
            </Tag>
          </Tooltip>
        </template>
      </template>
    </Table>
    <p v-else class="model-table__empty">
      {{ t('overview.models.empty') }}
    </p>
  </OverviewCard>
</template>

<style scoped>
.card-link {
  padding: 0;
  font-size: 12px;
}

.model-table :deep(.ant-table) {
  font-size: 12px;
}

.model-table :deep(.ant-table-thead > tr > th) {
  color: var(--admin-text-subtle);
  font-size: 11px;
  font-weight: 600;
  background: transparent;
}

.model-cell {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.model-cell__names {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.model-cell__display {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--admin-text);
  font-weight: 600;
  line-height: 1.25;
}

.model-cell__tag {
  margin: 0;
  font-size: 10px;
  line-height: 16px;
  padding: 0 5px;
}

.model-cell__wire {
  color: var(--admin-text-subtle);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 10px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.numeric-cell {
  font-variant-numeric: tabular-nums;
}

.tokens-cell {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 2px 8px;
  align-items: baseline;
}

.tokens-cell__share {
  color: var(--admin-text-subtle);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}

.tokens-cell__bar {
  grid-column: 1 / -1;
  height: 4px;
  border-radius: 2px;
  background: var(--admin-bg-deep);
  overflow: hidden;
}

.tokens-cell__fill {
  display: block;
  height: 100%;
  border-radius: 2px;
  background: var(--admin-primary);
  transition: width 300ms ease;
}

.probe-tag {
  margin: 0;
}

.model-table__empty {
  margin: 12px 0;
  color: var(--admin-text-subtle);
  font-size: 13px;
}
</style>
