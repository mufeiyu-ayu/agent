<script setup lang="ts">
import type { AdminOverviewBucket, AgentRunStatus } from '@agent/contracts'
import type { OverviewTrend } from '../overview.model'

import { computed } from 'vue'
import VChart from 'vue-echarts'
import { useI18n } from 'vue-i18n'

import { formatShortDateTime, formatTokens } from '@/features/runs/run.utils'
import { useAdminPreferencesStore } from '@/stores/preferences'

import { TREND_STATUSES } from '../overview.model'
import OverviewCard from './OverviewCard.vue'

import '@/features/overview/echarts'

const props = defineProps<{
  trend: OverviewTrend
  bucket: AdminOverviewBucket
}>()

const { locale, t } = useI18n()
const preferences = useAdminPreferencesStore()

interface TooltipParam {
  dataIndex: number
  seriesName: string
  seriesType: string
  marker: string
  value: number
}

const STATUS_COLORS: Record<AgentRunStatus, string> = {
  COMPLETED: '#10b981',
  FAILED: '#ef4444',
  ABORTED: '#f59e0b',
  RUNNING: '#3b82f6',
}

const isDark = computed(() => preferences.resolvedTheme === 'dark')
const chartTheme = computed(() => (
  isDark.value
    ? { label: '#94a3b8', border: '#334155', splitLine: '#1e293b', tokens: '#cbd5e1', tooltipBg: '#1e1e24', tooltipText: '#f8fafc' }
    : { label: '#94a3b8', border: '#f1f5f9', splitLine: '#f1f5f9', tokens: '#334155', tooltipBg: '#ffffff', tooltipText: '#0f172a' }
))

const chartOption = computed(() => ({
  tooltip: {
    trigger: 'axis',
    backgroundColor: chartTheme.value.tooltipBg,
    borderColor: chartTheme.value.border,
    textStyle: { color: chartTheme.value.tooltipText, fontSize: 12 },
    // 小时桶跨日，轴标签只有 HH:00；tooltip 标题用桶起点的完整时间。
    formatter: (params: TooltipParam[]) => {
      const index = params[0]?.dataIndex ?? -1
      const bucketStart = props.trend.bucketStarts[index]
      const title = bucketStart
        ? (props.bucket === 'hour' ? formatShortDateTime(bucketStart, locale.value) : props.trend.labels[index])
        : ''
      const rows = params
        .filter(item => item.seriesType === 'line' || item.value > 0)
        .map(item => `${item.marker}${item.seriesName}&nbsp;&nbsp;<strong>${
          item.seriesType === 'line' ? formatTokens(item.value, locale.value) : item.value.toLocaleString(locale.value)
        }</strong>`)
      return [title, ...rows].join('<br/>')
    },
  },
  legend: {
    top: 0,
    right: 0,
    icon: 'roundRect',
    itemWidth: 10,
    itemHeight: 10,
    textStyle: { color: chartTheme.value.label, fontSize: 11 },
  },
  grid: { top: 32, right: 44, bottom: 24, left: 36 },
  xAxis: {
    type: 'category',
    data: props.trend.labels,
    axisLine: { lineStyle: { color: chartTheme.value.border } },
    axisTick: { show: false },
    axisLabel: { color: chartTheme.value.label, fontSize: 10 },
  },
  yAxis: [
    {
      type: 'value',
      minInterval: 1,
      axisLine: { show: false },
      axisLabel: { color: chartTheme.value.label, fontSize: 10 },
      splitLine: { lineStyle: { color: chartTheme.value.splitLine } },
    },
    {
      type: 'value',
      axisLine: { show: false },
      axisLabel: { color: chartTheme.value.label, fontSize: 10, formatter: (value: number) => formatTokens(value, locale.value) },
      splitLine: { show: false },
    },
  ],
  series: [
    ...TREND_STATUSES.map(status => ({
      name: t(`overview.trend.status.${status}`),
      type: 'bar',
      stack: 'runs',
      barMaxWidth: 18,
      itemStyle: { color: STATUS_COLORS[status] },
      data: props.trend.runsByStatus[status],
    })),
    {
      name: t('overview.trend.totalTokens'),
      type: 'line',
      yAxisIndex: 1,
      showSymbol: false,
      lineStyle: { width: 1.8, color: chartTheme.value.tokens },
      itemStyle: { color: chartTheme.value.tokens },
      data: props.trend.totalTokens,
    },
  ],
  animationDuration: 600,
  animationEasing: 'cubicOut' as const,
}))
</script>

<template>
  <OverviewCard :title="t('overview.trend.title')" :subtitle="t('overview.trend.subtitle')">
    <div class="trend-chart">
      <VChart v-if="trend.hasData" class="trend-chart__canvas" :option="chartOption" autoresize />
      <p v-else class="trend-chart__empty">
        {{ t('overview.trend.empty') }}
      </p>
    </div>
  </OverviewCard>
</template>

<style scoped>
.trend-chart {
  height: 260px;
  display: flex;
}

.trend-chart__canvas {
  width: 100%;
  height: 100%;
}

.trend-chart__empty {
  margin: auto;
  color: var(--admin-text-subtle);
  font-size: 13px;
}
</style>
