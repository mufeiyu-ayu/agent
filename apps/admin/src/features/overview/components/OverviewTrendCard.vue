<script setup lang="ts">
import type { AdminOverviewBucket, AgentRunStatus } from '@agent/contracts'
import type { OverviewTrend } from '../overview.model'

import { Segmented } from 'ant-design-vue'
import { computed, ref } from 'vue'
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
  marker: string
  value: number
}

// 运行数与 Token 不叠在一张图里：两个量纲一起画既乱又难读，改成切换。
type TrendMetric = 'runs' | 'tokens'
const metric = ref<TrendMetric>('runs')
const metricOptions = computed(() => [
  { label: t('overview.trend.metricRuns'), value: 'runs' },
  { label: t('overview.trend.totalTokens'), value: 'tokens' },
])

const isDark = computed(() => preferences.resolvedTheme === 'dark')
const statusColors = computed<Record<AgentRunStatus, string>>(() => (
  isDark.value
    ? { COMPLETED: '#5aa877', FAILED: '#e86156', ABORTED: '#6b6b70', RUNNING: '#6abfd9' }
    : { COMPLETED: '#48835e', FAILED: '#dd574e', ABORTED: '#c7c7c2', RUNNING: '#1c6d88' }
))
const chartTheme = computed(() => (
  isDark.value
    ? { label: '#8e8e93', border: 'rgba(255,255,255,0.12)', splitLine: 'rgba(255,255,255,0.07)', tokens: '#6abfd9', tooltipBg: '#2c2c2f', tooltipText: '#f5f5f7' }
    : { label: '#8e8e93', border: 'rgba(0,0,0,0.1)', splitLine: 'rgba(0,0,0,0.06)', tokens: '#1c6d88', tooltipBg: '#ffffff', tooltipText: '#1d1d1f' }
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
        .filter(item => metric.value === 'tokens' || item.value > 0)
        .map(item => `${item.marker}${item.seriesName}&nbsp;&nbsp;<strong>${
          metric.value === 'tokens' ? formatTokens(item.value, locale.value) : item.value.toLocaleString(locale.value)
        }</strong>`)
      return [title, ...rows].join('<br/>')
    },
  },
  legend: {
    show: metric.value === 'runs',
    top: 0,
    right: 0,
    icon: 'circle',
    itemWidth: 8,
    itemHeight: 8,
    textStyle: { color: chartTheme.value.label, fontSize: 11 },
  },
  grid: { top: 28, right: 8, bottom: 24, left: 40 },
  xAxis: {
    type: 'category',
    boundaryGap: false,
    data: props.trend.labels,
    axisLine: { lineStyle: { color: chartTheme.value.border } },
    axisTick: { show: false },
    axisLabel: { color: chartTheme.value.label, fontSize: 10 },
  },
  yAxis: {
    type: 'value',
    minInterval: metric.value === 'runs' ? 1 : undefined,
    axisLine: { show: false },
    axisLabel: {
      color: chartTheme.value.label,
      fontSize: 10,
      formatter: metric.value === 'tokens' ? (value: number) => formatTokens(value, locale.value) : undefined,
    },
    splitLine: { lineStyle: { color: chartTheme.value.splitLine } },
  },
  series: metric.value === 'runs'
    ? TREND_STATUSES.map((status, index) => ({
        name: t(`overview.trend.status.${status}`),
        type: 'line',
        stack: 'runs',
        smooth: 0.35,
        showSymbol: false,
        lineStyle: { width: index === 0 ? 1.8 : 1.2, color: statusColors.value[status] },
        itemStyle: { color: statusColors.value[status] },
        areaStyle: { color: statusColors.value[status], opacity: index === 0 ? 0.16 : 0.45 },
        emphasis: { focus: 'series' },
        data: props.trend.runsByStatus[status],
      }))
    : [{
        name: t('overview.trend.totalTokens'),
        type: 'line',
        smooth: 0.35,
        showSymbol: false,
        lineStyle: { width: 1.8, color: chartTheme.value.tokens },
        itemStyle: { color: chartTheme.value.tokens },
        areaStyle: { color: chartTheme.value.tokens, opacity: 0.12 },
        data: props.trend.totalTokens,
      }],
  animationDuration: 600,
  animationEasing: 'cubicOut' as const,
}))
</script>

<template>
  <OverviewCard :title="t('overview.trend.title')" :subtitle="t('overview.trend.subtitle')">
    <template #actions>
      <Segmented v-model:value="metric" size="small" :options="metricOptions" />
    </template>
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
