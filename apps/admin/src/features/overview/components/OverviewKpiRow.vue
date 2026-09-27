<script setup lang="ts">
import type { AdminOverviewStats } from '@agent/contracts'

import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import { formatDuration, formatPercentage, formatTokens } from '@/features/runs/run.utils'

import OverviewCard from './OverviewCard.vue'

const props = defineProps<{
  stats: AdminOverviewStats
  balanceText: string
  balanceDetail: string
  balanceUnavailable: boolean
}>()

const { locale, t } = useI18n()

function count(value: number): string {
  return value.toLocaleString(locale.value)
}

interface KpiTile {
  key: string
  label: string
  value: string
  detail: string
  /** 窗口内没有数据的指标：数值置灰。 */
  pending?: boolean
}

const tiles = computed<KpiTile[]>(() => {
  const { health, latency, usage } = props.stats

  return [
    {
      key: 'runs',
      label: t('overview.kpi.runs'),
      value: count(health.runCount),
      detail: t('overview.kpi.runsDetail', {
        completed: count(health.statusCounts.COMPLETED),
        failed: count(health.statusCounts.FAILED),
        aborted: count(health.statusCounts.ABORTED),
      }),
    },
    {
      key: 'successRate',
      label: t('overview.kpi.successRate'),
      value: formatPercentage(health.successRate, locale.value),
      detail: t('overview.kpi.successRateDetail'),
      pending: health.successRate === null,
    },
    {
      key: 'duration',
      label: t('overview.kpi.duration'),
      value: `${formatDuration(latency.runDurationP50Ms)} / ${formatDuration(latency.runDurationP95Ms)}`,
      detail: t('overview.kpi.durationDetail'),
      pending: latency.runDurationP50Ms === null,
    },
    {
      key: 'tokens',
      label: t('overview.kpi.tokens'),
      value: formatTokens(usage.totalTokens, locale.value),
      detail: t('overview.kpi.tokensDetail', {
        avg: usage.avgTokensPerRun === null ? '—' : formatTokens(usage.avgTokensPerRun, locale.value),
      }),
    },
    {
      key: 'cacheHitRate',
      label: t('overview.kpi.cacheHitRate'),
      value: formatPercentage(usage.cacheHitRate, locale.value),
      detail: usage.cacheCoverage === null
        ? t('overview.kpi.cacheEmpty')
        : t('overview.kpi.cacheCoverage', { coverage: formatPercentage(usage.cacheCoverage, locale.value) }),
      pending: usage.cacheHitRate === null,
    },
    {
      key: 'balance',
      label: t('overview.kpi.balance'),
      value: props.balanceText,
      detail: props.balanceDetail,
      pending: props.balanceUnavailable,
    },
  ]
})
</script>

<template>
  <OverviewCard :title="t('overview.kpi.title')" :subtitle="t('overview.kpi.subtitle')">
    <div class="kpi-grid">
      <div
        v-for="tile in tiles"
        :key="tile.key"
        class="kpi-tile"
        :class="{ 'is-pending': tile.pending }"
      >
        <span class="kpi-tile__label">{{ tile.label }}</span>
        <strong class="kpi-tile__value">{{ tile.value }}</strong>
        <span class="kpi-tile__detail" :title="tile.detail">{{ tile.detail }}</span>
      </div>
    </div>
  </OverviewCard>
</template>

<style scoped>
.kpi-grid {
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
}

.kpi-tile {
  display: flex;
  flex-direction: column;
  min-width: 0;
  gap: 3px;
  padding: 2px 16px;
  box-shadow: inset 0.5px 0 0 var(--admin-border-strong);
}

.kpi-tile:first-child {
  padding-left: 0;
  box-shadow: none;
}

.kpi-tile__label {
  color: var(--admin-text-muted);
  font-size: var(--admin-font-xs);
  font-weight: 500;
}

.kpi-tile__value {
  color: var(--admin-text);
  font-size: 25px;
  font-weight: 600;
  letter-spacing: -0.02em;
  line-height: 1.2;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.kpi-tile.is-pending .kpi-tile__value {
  color: var(--admin-text-subtle);
}

.kpi-tile__detail {
  color: var(--admin-text-muted);
  font-size: 11.5px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}

@media (max-width: 1240px) {
  .kpi-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
    row-gap: 16px;
  }

  .kpi-tile:nth-child(3n + 1) {
    padding-left: 0;
    box-shadow: none;
  }
}
</style>
