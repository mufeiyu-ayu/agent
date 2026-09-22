<script setup lang="ts">
import type { OverviewTrendPoint, OverviewWindowKey } from '../mock-data'
import {
  AreaChartOutlined,
  BarChartOutlined,
  LineChartOutlined,
} from '@ant-design/icons-vue'
import { Card, Segmented, Tag } from 'ant-design-vue'
import { computed, ref } from 'vue'
import VChart from 'vue-echarts'
import { useI18n } from 'vue-i18n'

import { formatTokens } from '@/features/runs/run.utils'
import { useAdminPreferencesStore } from '@/stores/preferences'

import '@/features/overview/echarts'

const props = defineProps<{
  trends: OverviewTrendPoint[]
  activeWindow: OverviewWindowKey
  loading?: boolean
}>()

const emit = defineEmits<{
  'update:activeWindow': [key: OverviewWindowKey]
}>()

const { locale, t } = useI18n()
const preferences = useAdminPreferencesStore()

type TrendTabKey = 'tokens' | 'runs' | 'models'
const currentTab = ref<TrendTabKey>('tokens')

const tabOptions = computed(() => [
  { label: t('overview.trends.tabTokens'), value: 'tokens', icon: AreaChartOutlined },
  { label: t('overview.trends.tabRuns'), value: 'runs', icon: BarChartOutlined },
  { label: t('overview.trends.tabModelTokens'), value: 'models', icon: LineChartOutlined },
])

const windowOptions = computed(() => [
  { label: t('overview.windows.w24h'), value: '24h' },
  { label: t('overview.windows.w7d'), value: '7d' },
  { label: t('overview.windows.w30d'), value: '30d' },
])

const chartTheme = computed(() => (
  preferences.resolvedTheme === 'dark'
    ? {
        label: '#a6a6ad',
        border: '#3a3a40',
        splitLine: '#2c2c31',
        tooltipBg: '#1e1e24',
        tooltipBorder: '#3a3a40',
      }
    : {
        label: '#6b6b74',
        border: '#e4e4e8',
        splitLine: '#ececef',
        tooltipBg: '#ffffff',
        tooltipBorder: '#e4e4e8',
      }
))

const xAxisData = computed(() => props.trends.map(point => point.time))

function axisBase() {
  return {
    axisLine: { lineStyle: { color: chartTheme.value.border } },
    axisLabel: { color: chartTheme.value.label, fontSize: 11 },
    splitLine: { lineStyle: { color: chartTheme.value.splitLine } },
  }
}

// 统计本窗口的峰值点
const peakPoint = computed(() => {
  if (!props.trends.length)
    return null
  let max = props.trends[0]
  let maxTokens = max.inputTokens + max.outputTokens
  for (const p of props.trends) {
    const total = p.inputTokens + p.outputTokens
    if (total > maxTokens) {
      max = p
      maxTokens = total
    }
  }
  return { time: max.time, tokens: maxTokens, runs: max.runCount }
})

const tokensOption = computed(() => ({
  color: ['#0284c7', '#10b981'],
  tooltip: {
    trigger: 'axis',
    backgroundColor: chartTheme.value.tooltipBg,
    borderColor: chartTheme.value.tooltipBorder,
    textStyle: { color: preferences.resolvedTheme === 'dark' ? '#f3f4f6' : '#1f2937', fontSize: 12 },
    valueFormatter: (value: number) => formatTokens(value, locale.value),
  },
  legend: {
    top: 6,
    right: 12,
    textStyle: { color: chartTheme.value.label, fontSize: 11 },
  },
  grid: { top: 40, right: 16, bottom: 28, left: 60 },
  xAxis: {
    type: 'category',
    data: xAxisData.value,
    ...axisBase(),
    splitLine: { show: false },
    axisLabel: {
      ...axisBase().axisLabel,
      interval: props.activeWindow === '24h' ? 2 : 'auto',
    },
  },
  yAxis: {
    type: 'value',
    ...axisBase(),
    axisLabel: {
      ...axisBase().axisLabel,
      formatter: (v: number) => formatTokens(v, locale.value),
    },
  },
  series: [
    {
      name: t('overview.charts.inputTokens'),
      type: 'line',
      stack: 'total',
      smooth: 0.35,
      showSymbol: props.activeWindow === '24h',
      symbolSize: 4,
      areaStyle: {
        opacity: 0.28,
      },
      lineStyle: { width: 2.5 },
      data: props.trends.map(p => p.inputTokens),
    },
    {
      name: t('overview.charts.outputTokens'),
      type: 'line',
      stack: 'total',
      smooth: 0.35,
      showSymbol: props.activeWindow === '24h',
      symbolSize: 4,
      areaStyle: {
        opacity: 0.35,
      },
      lineStyle: { width: 2.5 },
      data: props.trends.map(p => p.outputTokens),
    },
  ],
}))

const runsOption = computed(() => ({
  color: ['#0284c7'],
  tooltip: {
    trigger: 'axis',
    backgroundColor: chartTheme.value.tooltipBg,
    borderColor: chartTheme.value.tooltipBorder,
    textStyle: { color: preferences.resolvedTheme === 'dark' ? '#f3f4f6' : '#1f2937', fontSize: 12 },
  },
  grid: { top: 32, right: 16, bottom: 28, left: 45 },
  xAxis: {
    type: 'category',
    data: xAxisData.value,
    ...axisBase(),
    splitLine: { show: false },
    axisLabel: {
      ...axisBase().axisLabel,
      interval: props.activeWindow === '24h' ? 2 : 'auto',
    },
  },
  yAxis: { type: 'value', minInterval: 1, ...axisBase() },
  series: [
    {
      name: t('overview.charts.runCount'),
      type: 'bar',
      barMaxWidth: props.activeWindow === '24h' ? 14 : 20,
      itemStyle: {
        borderRadius: [4, 4, 0, 0],
      },
      data: props.trends.map(p => p.runCount),
    },
  ],
}))

const MODEL_SERIES_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899']

const modelsOption = computed(() => {
  const modelNames = Array.from(new Set(
    props.trends.flatMap(p => Object.keys(p.modelTokens)),
  ))

  return {
    color: MODEL_SERIES_COLORS,
    tooltip: {
      trigger: 'axis',
      backgroundColor: chartTheme.value.tooltipBg,
      borderColor: chartTheme.value.tooltipBorder,
      textStyle: { color: preferences.resolvedTheme === 'dark' ? '#f3f4f6' : '#1f2937', fontSize: 12 },
      valueFormatter: (value: number) => formatTokens(value, locale.value),
    },
    legend: {
      top: 6,
      right: 12,
      textStyle: { color: chartTheme.value.label, fontSize: 11 },
    },
    grid: { top: 40, right: 16, bottom: 28, left: 60 },
    xAxis: {
      type: 'category',
      data: xAxisData.value,
      ...axisBase(),
      splitLine: { show: false },
      axisLabel: {
        ...axisBase().axisLabel,
        interval: props.activeWindow === '24h' ? 2 : 'auto',
      },
    },
    yAxis: {
      type: 'value',
      ...axisBase(),
      axisLabel: {
        ...axisBase().axisLabel,
        formatter: (v: number) => formatTokens(v, locale.value),
      },
    },
    series: modelNames.map(name => ({
      name,
      type: 'line',
      smooth: 0.3,
      showSymbol: false,
      lineStyle: { width: 2 },
      data: props.trends.map(p => p.modelTokens[name] ?? 0),
    })),
  }
})

const activeOption = computed(() => {
  if (currentTab.value === 'runs')
    return runsOption.value
  if (currentTab.value === 'models')
    return modelsOption.value
  return tokensOption.value
})
</script>

<template>
  <Card class="trend-card" :bordered="false">
    <div class="trend-card__head">
      <div class="trend-card__titles">
        <h2 class="trend-card__title">
          {{ t('overview.trends.title') }}
        </h2>
        <Tag v-if="props.activeWindow === '24h'" color="blue" class="trend-card__tag">
          小时级连续采样 (24h)
        </Tag>
      </div>

      <div class="trend-card__controls">
        <Segmented
          v-model:value="currentTab"
          :options="tabOptions"
          size="small"
          class="trend-card__tab-segmented"
        />
        <Segmented
          :value="props.activeWindow"
          :options="windowOptions"
          size="small"
          class="trend-card__window-segmented"
          @change="(val) => emit('update:activeWindow', val as OverviewWindowKey)"
        />
      </div>
    </div>

    <!-- Chart 大图区域：占据充足空间 -->
    <div class="trend-card__chart-wrap">
      <VChart class="trend-chart" :option="activeOption" autoresize />
    </div>

    <!-- 底部状态与峰值标注条 -->
    <div v-if="peakPoint" class="trend-card__foot">
      <div class="trend-card__foot-left">
        <span class="trend-card__stat-item">
          时段最高峰值：<strong>{{ peakPoint.time }}</strong>
          （{{ formatTokens(peakPoint.tokens, locale) }} tokens · {{ peakPoint.runs }} 次运行）
        </span>
      </div>
      <div class="trend-card__foot-right">
        <span class="trend-card__stat-item">
          当前颗粒度：<strong>{{ props.activeWindow === '24h' ? '1 小时 / 采样点 (共 24 点)' : '1 天 / 采样点' }}</strong>
        </span>
      </div>
    </div>
  </Card>
</template>

<style scoped>
.trend-card {
  border: 1px solid var(--admin-border);
  background: var(--admin-surface);
  box-shadow: var(--admin-shadow-sm);
  border-radius: var(--admin-radius-md, 10px);
  display: flex;
  flex-direction: column;
}

.trend-card :deep(.ant-card-body) {
  padding: 16px 20px 14px;
  display: flex;
  flex-direction: column;
  flex: 1;
}

.trend-card__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 12px;
  margin-bottom: 6px;
}

.trend-card__titles {
  display: flex;
  align-items: center;
  gap: 8px;
}

.trend-card__title {
  margin: 0;
  color: var(--admin-text);
  font-size: var(--admin-font-md, 14px);
  font-weight: 700;
  line-height: 1.3;
}

.trend-card__tag {
  margin: 0;
  font-size: var(--admin-font-2xs, 10px);
  border-radius: 4px;
  line-height: 18px;
  padding: 0 6px;
}

.trend-card__controls {
  display: flex;
  align-items: center;
  gap: 10px;
}

.trend-card__tab-segmented,
.trend-card__window-segmented {
  background: var(--admin-bg-deep);
  border: 1px solid var(--admin-border);
  padding: 2px;
}

.trend-card__chart-wrap {
  flex: 1;
  min-height: 360px;
  margin-top: 4px;
}

.trend-chart {
  width: 100%;
  height: 100%;
  min-height: 360px;
}

.trend-card__foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px solid var(--admin-border);
  color: var(--admin-text-subtle);
  font-size: var(--admin-font-2xs, 11px);
}

.trend-card__stat-item strong {
  color: var(--admin-text);
  font-weight: 600;
}

@media (max-width: 900px) {
  .trend-card__head {
    flex-direction: column;
    align-items: flex-start;
  }
}
</style>
