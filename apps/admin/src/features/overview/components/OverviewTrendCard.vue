<script setup lang="ts">
import type { OverviewTrendPoint } from '../overview.model'

import { computed } from 'vue'
import VChart from 'vue-echarts'
import { useI18n } from 'vue-i18n'

import { formatTokens } from '@/features/runs/run.utils'
import { useAdminPreferencesStore } from '@/stores/preferences'

import OverviewCard from './OverviewCard.vue'

import '@/features/overview/echarts'

const props = defineProps<{
  points: OverviewTrendPoint[]
}>()

const { locale, t } = useI18n()
const preferences = useAdminPreferencesStore()

const INPUT_COLOR = '#10b981'
const OUTPUT_COLOR = '#f43f5e'

const isDark = computed(() => preferences.resolvedTheme === 'dark')
const chartTheme = computed(() => (
  isDark.value
    ? { label: '#94a3b8', border: '#334155', splitLine: '#1e293b', runs: '#cbd5e1', tooltipBg: '#1e1e24', tooltipText: '#f8fafc' }
    : { label: '#94a3b8', border: '#f1f5f9', splitLine: '#f1f5f9', runs: '#334155', tooltipBg: '#ffffff', tooltipText: '#0f172a' }
))

const hasData = computed(() => props.points.some(point => point.runCount > 0 || point.inputTokens > 0 || point.outputTokens > 0))

const chartOption = computed(() => ({
  tooltip: {
    trigger: 'axis',
    backgroundColor: chartTheme.value.tooltipBg,
    borderColor: chartTheme.value.border,
    textStyle: { color: chartTheme.value.tooltipText, fontSize: 12 },
  },
  legend: {
    bottom: 0,
    icon: 'roundRect',
    itemWidth: 10,
    itemHeight: 10,
    textStyle: { color: chartTheme.value.label, fontSize: 11 },
  },
  grid: { top: 16, right: 36, bottom: 34, left: 40 },
  xAxis: {
    type: 'category',
    data: props.points.map(point => point.label),
    boundaryGap: false,
    axisLine: { lineStyle: { color: chartTheme.value.border } },
    axisTick: { show: false },
    axisLabel: { color: chartTheme.value.label, fontSize: 10 },
  },
  yAxis: [
    {
      type: 'value',
      axisLine: { show: false },
      axisLabel: { color: chartTheme.value.label, fontSize: 10, formatter: (value: number) => formatTokens(value, locale.value) },
      splitLine: { lineStyle: { color: chartTheme.value.splitLine } },
    },
    {
      type: 'value',
      minInterval: 1,
      axisLine: { show: false },
      axisLabel: { color: chartTheme.value.label, fontSize: 10 },
      splitLine: { show: false },
    },
  ],
  series: [
    {
      name: t('overview.trend.inputTokens'),
      type: 'line',
      smooth: 0.35,
      showSymbol: false,
      lineStyle: { width: 2.2, color: INPUT_COLOR },
      itemStyle: { color: INPUT_COLOR },
      areaStyle: { color: INPUT_COLOR, opacity: 0.08 },
      data: props.points.map(point => point.inputTokens),
    },
    {
      name: t('overview.trend.outputTokens'),
      type: 'line',
      smooth: 0.35,
      showSymbol: false,
      lineStyle: { width: 2.2, color: OUTPUT_COLOR },
      itemStyle: { color: OUTPUT_COLOR },
      data: props.points.map(point => point.outputTokens),
    },
    {
      name: t('overview.trend.runCount'),
      type: 'line',
      smooth: 0.3,
      showSymbol: false,
      yAxisIndex: 1,
      lineStyle: { width: 1.6, color: chartTheme.value.runs, type: 'dashed' },
      itemStyle: { color: chartTheme.value.runs },
      data: props.points.map(point => point.runCount),
    },
  ],
  animationDuration: 600,
  animationEasing: 'cubicOut' as const,
}))
</script>

<template>
  <OverviewCard :title="t('overview.trend.title')" :subtitle="t('overview.trend.subtitle')">
    <div class="trend-chart">
      <VChart v-if="hasData" class="trend-chart__canvas" :option="chartOption" autoresize />
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
