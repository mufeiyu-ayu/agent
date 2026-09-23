<script setup lang="ts">
import type { TableColumnsType } from 'ant-design-vue'
import type { OverviewModelRow } from '../overview.model'

import { Button, Table, Tag, Tooltip } from 'ant-design-vue'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'

import LlmFamilyLogo from '@/features/llm/components/LlmFamilyLogo.vue'
import { formatDuration, formatPercentage, formatTokens } from '@/features/runs/run.utils'

import OverviewCard from './OverviewCard.vue'

defineProps<{
  rows: OverviewModelRow[]
  loading: boolean
}>()

const { locale, t } = useI18n()
const router = useRouter()

const columns = computed<TableColumnsType<OverviewModelRow>>(() => [
  { title: t('overview.models.columns.model'), key: 'model', ellipsis: true },
  { title: t('overview.models.columns.calls'), key: 'calls', width: 80, align: 'right' },
  { title: t('overview.models.columns.failureRate'), key: 'failureRate', width: 90, align: 'right' },
  { title: t('overview.models.columns.firstToken'), key: 'firstToken', width: 120, align: 'right' },
  { title: t('overview.models.columns.samplingDuration'), key: 'samplingDuration', width: 120, align: 'right' },
  { title: t('overview.models.columns.tokens'), key: 'tokens', width: 180 },
  { title: t('overview.models.columns.cacheHitRate'), key: 'cacheHitRate', width: 100, align: 'right' },
])
</script>

<template>
  <OverviewCard :title="t('overview.models.title')" :subtitle="t('overview.models.subtitle')">
    <template #actions>
      <Button size="small" type="link" class="card-link" @click="router.push({ name: 'llm-models' })">
        {{ t('overview.models.manage') }}
      </Button>
    </template>

    <Table
      v-if="rows.length > 0 || loading"
      class="model-table"
      size="small"
      row-key="key"
      :columns="columns"
      :data-source="rows"
      :loading="loading"
      :pagination="false"
      :scroll="{ x: 860 }"
    >
      <template #bodyCell="{ column, record }">
        <template v-if="column.key === 'model'">
          <div class="model-cell">
            <LlmFamilyLogo :family="record.family" :size="15" badge />
            <div class="model-cell__names">
              <span class="model-cell__display">
                <span class="model-cell__display-text" :class="{ 'is-empty': record.displayName === null }">{{ record.displayName ?? t('runTrace.inspector.unavailable') }}</span>
                <Tag v-if="record.deleted" class="model-cell__tag">
                  {{ t('overview.models.deleted') }}
                </Tag>
              </span>
              <Tooltip v-if="record.wireName" :title="record.wireName">
                <span class="model-cell__wire">{{ record.wireName }}</span>
              </Tooltip>
            </div>
          </div>
        </template>
        <template v-else-if="column.key === 'calls'">
          <span class="numeric-cell">{{ record.callCount.toLocaleString(locale) }}</span>
        </template>
        <template v-else-if="column.key === 'failureRate'">
          <span class="numeric-cell" :class="{ 'is-danger': record.failureRate > 0 }">{{ formatPercentage(record.failureRate, locale) }}</span>
        </template>
        <template v-else-if="column.key === 'firstToken'">
          <span class="numeric-cell" :class="{ 'is-empty': record.firstTokenP50Ms === null }">{{ formatDuration(record.firstTokenP50Ms) }}</span>
        </template>
        <template v-else-if="column.key === 'samplingDuration'">
          <span class="numeric-cell" :class="{ 'is-empty': record.samplingDurationP50Ms === null }">{{ formatDuration(record.samplingDurationP50Ms) }}</span>
        </template>
        <template v-else-if="column.key === 'tokens'">
          <div class="tokens-cell">
            <span class="numeric-cell">{{ formatTokens(record.totalTokens, locale) }}</span>
            <span class="tokens-cell__share">{{ formatPercentage(record.tokenShare, locale) }}</span>
            <span class="tokens-cell__bar">
              <span class="tokens-cell__fill" :style="{ width: `${Math.min(100, record.tokenShare * 100)}%` }" />
            </span>
          </div>
        </template>
        <template v-else-if="column.key === 'cacheHitRate'">
          <span class="numeric-cell" :class="{ 'is-empty': record.cacheHitRate === null }">{{ formatPercentage(record.cacheHitRate, locale) }}</span>
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
  white-space: nowrap;
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
  min-width: 0;
  color: var(--admin-text);
  font-weight: 600;
  line-height: 1.25;
}

.model-cell__display-text {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.model-cell__display-text.is-empty {
  color: var(--admin-text-subtle);
  font-weight: 500;
}

.model-cell__tag {
  flex-shrink: 0;
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
  white-space: nowrap;
}

.numeric-cell.is-empty {
  color: var(--admin-text-subtle);
}

.numeric-cell.is-danger {
  color: var(--admin-danger-strong);
  font-weight: 600;
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

.model-table__empty {
  margin: 12px 0;
  color: var(--admin-text-subtle);
  font-size: 13px;
}
</style>
