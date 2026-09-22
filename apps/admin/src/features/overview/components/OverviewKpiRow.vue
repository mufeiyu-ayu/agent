<script setup lang="ts">
import type { OverviewKpi } from '../overview.model'

import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import { formatTokens } from '@/features/runs/run.utils'

import OverviewCard from './OverviewCard.vue'

const props = defineProps<{
  kpi: OverviewKpi | undefined
}>()

const { locale, t } = useI18n()

function percent(value: number | null): string {
  return value === null ? '—' : `${value.toFixed(1)}%`
}

function count(value: number): string {
  return value.toLocaleString(locale.value)
}

interface KpiTile {
  key: string
  label: string
  value: string
  detail: string
  /** 后端尚未提供的指标：显示占位并给出提示。 */
  pending?: boolean
}

const tiles = computed<KpiTile[]>(() => {
  const kpi = props.kpi
  if (!kpi)
    return []

  return [
    {
      key: 'runs',
      label: t('overview.kpi.runs'),
      value: count(kpi.runCount),
      detail: t('overview.kpi.runsDetail', {
        completed: count(kpi.completedRuns),
        failed: count(kpi.failedRuns),
        aborted: count(kpi.abortedRuns),
      }),
    },
    {
      key: 'successRate',
      label: t('overview.kpi.successRate'),
      value: percent(kpi.successRate),
      detail: t('overview.kpi.successRateDetail'),
    },
    {
      key: 'tokens',
      label: t('overview.kpi.tokens'),
      value: formatTokens(kpi.totalTokens, locale.value),
      detail: t('overview.kpi.tokensDetail', {
        input: formatTokens(kpi.inputTokens, locale.value),
        output: formatTokens(kpi.outputTokens, locale.value),
      }),
    },
    {
      key: 'avgTokens',
      label: t('overview.kpi.avgTokens'),
      value: kpi.avgTokensPerRun === null ? '—' : formatTokens(kpi.avgTokensPerRun, locale.value),
      detail: t('overview.kpi.avgTokensDetail'),
    },
    {
      key: 'cacheHitRate',
      label: t('overview.kpi.cacheHitRate'),
      value: percent(kpi.cacheHitRate),
      detail: kpi.cacheHitRate === null ? t('overview.kpi.pending') : t('overview.kpi.cacheHitRateDetail'),
      pending: kpi.cacheHitRate === null,
    },
    {
      key: 'toolCalls',
      label: t('overview.kpi.toolCalls'),
      value: count(kpi.toolCallCount),
      detail: t('overview.kpi.toolCallsDetail', {
        conversations: count(kpi.conversationCount),
        messages: count(kpi.messageCount),
      }),
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
        <span class="kpi-tile__detail">{{ tile.detail }}</span>
      </div>
    </div>
  </OverviewCard>
</template>

<style scoped>
.kpi-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 18px 24px;
}

.kpi-tile {
  display: flex;
  flex-direction: column;
  min-width: 0;
  gap: 4px;
}

.kpi-tile__label {
  color: var(--admin-text-subtle);
  font-size: 11px;
  font-weight: 650;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.kpi-tile__value {
  color: var(--admin-text);
  font-size: 24px;
  font-weight: 750;
  letter-spacing: -0.03em;
  line-height: 1.1;
  font-variant-numeric: tabular-nums;
}

.kpi-tile.is-pending .kpi-tile__value {
  color: var(--admin-text-subtle);
}

.kpi-tile__detail {
  color: var(--admin-text-muted);
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

@media (max-width: 720px) {
  .kpi-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
