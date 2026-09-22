<script setup lang="ts">
import type { OverviewTrendPoint, OverviewWindowKey } from '../mock-data'
import { Card, Switch } from 'ant-design-vue'
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

const { locale } = useI18n()
const preferences = useAdminPreferencesStore()

// 图表形态：折线 vs 柱状
const chartType = ref<'line' | 'bar'>('line')

// 图例复选控制
const showInput = ref(true)
const showOutput = ref(true)
const showRuns = ref(true)
const comparePrev = ref(false)

const chartTheme = computed(() => (
  preferences.resolvedTheme === 'dark'
    ? {
        label: '#94a3b8',
        border: '#334155',
        splitLine: '#1e293b',
        tooltipBg: '#1e1e24',
        tooltipBorder: '#334155',
      }
    : {
        label: '#94a3b8',
        border: '#f1f5f9',
        splitLine: '#f8fafc',
        tooltipBg: '#ffffff',
        tooltipBorder: '#e2e8f0',
      }
))

const xAxisData = computed(() => props.trends.map(p => p.time))

const chartOption = computed(() => {
  const series: any[] = []

  if (showInput.value) {
    series.push({
      name: '输入 Token',
      type: chartType.value,
      smooth: 0.35,
      showSymbol: false,
      lineStyle: { width: 2.2, color: '#10b981' },
      itemStyle: { color: '#10b981' },
      data: props.trends.map(p => p.inputTokens),
      yAxisIndex: 0,
    })
  }

  if (showOutput.value) {
    series.push({
      name: '输出 Token',
      type: chartType.value,
      smooth: 0.35,
      showSymbol: false,
      lineStyle: { width: 2.2, color: '#f43f5e' },
      itemStyle: { color: '#f43f5e' },
      data: props.trends.map(p => p.outputTokens),
      yAxisIndex: 0,
    })
  }

  if (showRuns.value) {
    series.push({
      name: '运行频次',
      type: chartType.value === 'bar' ? 'bar' : 'line',
      smooth: 0.3,
      showSymbol: false,
      barMaxWidth: 12,
      lineStyle: { width: 2, color: preferences.resolvedTheme === 'dark' ? '#cbd5e1' : '#334155' },
      itemStyle: { color: preferences.resolvedTheme === 'dark' ? '#cbd5e1' : '#334155', borderRadius: [3, 3, 0, 0] },
      data: props.trends.map(p => p.runCount),
      yAxisIndex: 1,
    })
  }

  return {
    tooltip: {
      trigger: 'axis',
      backgroundColor: chartTheme.value.tooltipBg,
      borderColor: chartTheme.value.tooltipBorder,
      textStyle: { color: preferences.resolvedTheme === 'dark' ? '#f8fafc' : '#0f172a', fontSize: 12 },
    },
    grid: { top: 20, right: 36, bottom: 24, left: 36 },
    xAxis: {
      type: 'category',
      data: xAxisData.value,
      axisLine: { lineStyle: { color: chartTheme.value.border } },
      axisLabel: { color: chartTheme.value.label, fontSize: 10 },
      splitLine: { show: false },
    },
    yAxis: [
      {
        type: 'value',
        axisLine: { show: false },
        axisLabel: {
          color: chartTheme.value.label,
          fontSize: 10,
          formatter: (v: number) => formatTokens(v, locale.value),
        },
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
    series,
    animation: true,
    animationDuration: 800,
    animationEasing: 'cubicOut' as const,
  }
})
</script>

<template>
  <Card class="trend-block-card" :bordered="false">
    <div class="trend-block-card__head">
      <div class="trend-block-card__title-group">
        <h2 class="trend-block-card__title">
          Token 吞吐与调用趋势
        </h2>
        <span class="trend-block-card__subtitle">Input/Output tokens, run requests</span>
      </div>

      <div class="trend-block-card__actions">
        <div class="chart-type-segmented">
          <button
            class="type-btn"
            :class="{ 'is-active': chartType === 'line' }"
            @click="chartType = 'line'"
          >
            折线图
          </button>
          <button
            class="type-btn"
            :class="{ 'is-active': chartType === 'bar' }"
            @click="chartType = 'bar'"
          >
            柱状图
          </button>
        </div>
      </div>
    </div>

    <!-- Chart 主图 -->
    <div class="trend-block-card__chart-wrap">
      <VChart class="trend-vchart" :option="chartOption" autoresize />
    </div>

    <!-- 底部复选图例与环比开关 -->
    <div class="trend-block-card__foot">
      <div class="trend-legends">
        <label class="legend-checkbox is-green">
          <input v-model="showInput" type="checkbox">
          <span class="legend-box" />
          <span class="legend-text">输入 Token</span>
        </label>

        <label class="legend-checkbox is-pink">
          <input v-model="showOutput" type="checkbox">
          <span class="legend-box" />
          <span class="legend-text">输出 Token</span>
        </label>

        <label class="legend-checkbox is-dark">
          <input v-model="showRuns" type="checkbox">
          <span class="legend-box" />
          <span class="legend-text">运行频次</span>
        </label>
      </div>

      <div class="trend-compare">
        <Switch v-model:checked="comparePrev" size="small" />
        <span class="compare-text">对比上周期</span>
      </div>
    </div>
  </Card>
</template>

<style scoped>
.trend-block-card {
  border: 1px solid var(--admin-border);
  background: var(--admin-surface);
  box-shadow: var(--admin-shadow-sm);
  border-radius: 12px;
  margin-top: 14px;
  transition: border-color 200ms ease, box-shadow 200ms ease;
}

.trend-block-card:hover {
  border-color: var(--admin-border-strong);
  box-shadow: var(--admin-shadow-md);
}

.trend-block-card :deep(.ant-card-body) {
  padding: 16px 20px 12px;
}

.trend-block-card__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  margin-bottom: 8px;
}

.trend-block-card__title {
  margin: 0;
  color: var(--admin-text);
  font-size: 16px;
  font-weight: 700;
  letter-spacing: -0.01em;
}

.trend-block-card__subtitle {
  color: var(--admin-text-subtle);
  font-size: 11px;
  margin-top: 2px;
  display: block;
}

.trend-block-card__actions {
  display: flex;
  align-items: center;
  gap: 4px;
}

.chart-type-segmented {
  display: inline-flex;
  align-items: center;
  background: var(--admin-bg-deep);
  border: 1px solid var(--admin-border);
  border-radius: 6px;
  padding: 2px;
  gap: 2px;
}

.type-btn {
  background: transparent;
  border: none;
  color: var(--admin-text-subtle);
  font-size: 11px;
  font-weight: 500;
  padding: 3px 8px;
  border-radius: 4px;
  cursor: pointer;
  transition: all 150ms ease;
  line-height: 1.2;
}

.type-btn:hover {
  color: var(--admin-text);
}

.type-btn.is-active {
  background: var(--admin-surface);
  color: var(--admin-text);
  font-weight: 600;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
}

.trend-block-card__chart-wrap {
  width: 100%;
  height: 230px;
}

.trend-vchart {
  width: 100%;
  height: 100%;
}

.trend-block-card__foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-top: 10px;
  border-top: 1px solid var(--admin-border);
  margin-top: 6px;
}

.trend-legends {
  display: flex;
  align-items: center;
  gap: 16px;
}

.legend-checkbox {
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  font-size: 11px;
  color: var(--admin-text);
  font-weight: 500;
  user-select: none;
}

.legend-checkbox input {
  display: none;
}

.legend-box {
  width: 12px;
  height: 12px;
  border-radius: 3px;
  border: 1px solid var(--admin-border-strong);
  display: inline-block;
  position: relative;
  transition: all 150ms ease;
}

.legend-checkbox.is-green input:checked + .legend-box {
  background: #10b981;
  border-color: #10b981;
}

.legend-checkbox.is-pink input:checked + .legend-box {
  background: #f43f5e;
  border-color: #f43f5e;
}

.legend-checkbox.is-dark input:checked + .legend-box {
  background: #334155;
  border-color: #334155;
}

.legend-checkbox input:checked + .legend-box::after {
  content: '';
  position: absolute;
  top: 1px;
  left: 3px;
  width: 4px;
  height: 7px;
  border: solid #ffffff;
  border-width: 0 1.5px 1.5px 0;
  transform: rotate(45deg);
}

.trend-compare {
  display: flex;
  align-items: center;
  gap: 6px;
}

.compare-text {
  color: var(--admin-text-subtle);
  font-size: 11px;
}
</style>
