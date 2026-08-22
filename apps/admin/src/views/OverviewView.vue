<script setup lang="ts">
import type { AdminOverviewStats, AdminProviderBalance } from '@agent/contracts'
import {
  BarsOutlined,
  CommentOutlined,
  ThunderboltOutlined,
  WalletOutlined,
} from '@ant-design/icons-vue'
import { Alert, Button, Card, Empty, Skeleton } from 'ant-design-vue'
import { computed, onBeforeUnmount, ref, shallowRef } from 'vue'
import VChart from 'vue-echarts'
import { useI18n } from 'vue-i18n'

import PageContainer from '@/components/common/PageContainer.vue'
import { fetchOverviewStats, fetchProviderBalance } from '@/features/overview/overview-api'
import { formatTokens } from '@/features/runs/run.utils'
import { formatAdminRunError } from '@/features/shared/admin-api'
import { useAdminPreferencesStore } from '@/stores/preferences'

import '@/features/overview/echarts'

const { locale, t } = useI18n()
const preferences = useAdminPreferencesStore()

const stats = shallowRef<AdminOverviewStats>()
const statsLoading = ref(false)
const statsErrorCause = shallowRef<unknown>()
const statsError = computed(() => (
  statsErrorCause.value === undefined ? '' : formatAdminRunError(statsErrorCause.value)
))

const balance = shallowRef<AdminProviderBalance>()
const balanceLoading = ref(false)

const abortController = new AbortController()

async function loadStats() {
  statsLoading.value = true
  statsErrorCause.value = undefined
  try {
    stats.value = await fetchOverviewStats({ signal: abortController.signal })
  }
  catch (cause) {
    if (!abortController.signal.aborted)
      statsErrorCause.value = cause
  }
  finally {
    statsLoading.value = false
  }
}

// 余额独立加载：provider 查询失败只影响余额卡，不阻塞统计。
async function loadBalance() {
  balanceLoading.value = true
  try {
    balance.value = await fetchProviderBalance({ signal: abortController.signal })
  }
  catch {
    balance.value = { available: false, currency: null, totalBalance: null }
  }
  finally {
    balanceLoading.value = false
  }
}

void loadStats()
void loadBalance()
onBeforeUnmount(() => abortController.abort())

const windowRunCount = computed(() => (
  stats.value?.daily.reduce((total, point) => total + point.runCount, 0) ?? 0
))

const balanceText = computed(() => {
  const value = balance.value
  if (balanceLoading.value)
    return '…'
  if (!value?.totalBalance)
    return t('overview.balanceUnavailable')
  return `${value.totalBalance} ${value.currency ?? ''}`.trim()
})

/** 主题相关的图表基础色；跟随 resolvedTheme 切换，数值与 styles/index.css 对齐。 */
const chartTheme = computed(() => (
  preferences.resolvedTheme === 'dark'
    ? { label: '#a6a6ad', border: '#3a3a40', splitLine: '#2c2c31' }
    : { label: '#6b6b74', border: '#e4e4e8', splitLine: '#ececef' }
))

const SERIES_COLORS = ['#3b82f6', '#22c55e', '#f59e0b', '#8b5cf6', '#14b8a6', '#ef4444']
const STATUS_COLORS: Record<string, string> = {
  COMPLETED: '#22c55e',
  RUNNING: '#3b82f6',
  FAILED: '#ef4444',
  ABORTED: '#f59e0b',
}

function axisBase() {
  return {
    axisLine: { lineStyle: { color: chartTheme.value.border } },
    axisLabel: { color: chartTheme.value.label, fontSize: 10 },
    splitLine: { lineStyle: { color: chartTheme.value.splitLine } },
  }
}

const dailyDates = computed(() => stats.value?.daily.map(point => point.date.slice(5)) ?? [])

const dailyRunsOption = computed(() => ({
  color: SERIES_COLORS,
  tooltip: { trigger: 'axis' },
  grid: { top: 20, right: 12, bottom: 24, left: 40 },
  xAxis: { type: 'category', data: dailyDates.value, ...axisBase(), splitLine: { show: false } },
  yAxis: { type: 'value', minInterval: 1, ...axisBase() },
  series: [{
    name: t('overview.charts.runCount'),
    type: 'bar',
    barMaxWidth: 14,
    data: stats.value?.daily.map(point => point.runCount) ?? [],
  }],
}))

const dailyTokensOption = computed(() => ({
  color: SERIES_COLORS,
  tooltip: { trigger: 'axis' },
  legend: { top: 0, textStyle: { color: chartTheme.value.label, fontSize: 10 } },
  grid: { top: 30, right: 12, bottom: 24, left: 52 },
  xAxis: { type: 'category', data: dailyDates.value, ...axisBase(), splitLine: { show: false } },
  yAxis: { type: 'value', ...axisBase() },
  series: [
    {
      name: t('overview.charts.inputTokens'),
      type: 'line',
      stack: 'tokens',
      areaStyle: { opacity: 0.25 },
      showSymbol: false,
      data: stats.value?.daily.map(point => point.inputTokens) ?? [],
    },
    {
      name: t('overview.charts.outputTokens'),
      type: 'line',
      stack: 'tokens',
      areaStyle: { opacity: 0.25 },
      showSymbol: false,
      data: stats.value?.daily.map(point => point.outputTokens) ?? [],
    },
  ],
}))

const statusItems = computed(() => (
  Object.entries(stats.value?.statusCounts ?? {})
    .filter(([, count]) => count > 0)
    .map(([status, count]) => ({
      name: status,
      value: count,
      itemStyle: { color: STATUS_COLORS[status] },
    }))
))

const statusOption = computed(() => ({
  tooltip: { trigger: 'item' },
  legend: { bottom: 0, textStyle: { color: chartTheme.value.label, fontSize: 10 } },
  series: [{
    type: 'pie',
    radius: ['52%', '76%'],
    center: ['50%', '44%'],
    label: { show: false },
    data: statusItems.value,
  }],
}))

const modelsOption = computed(() => ({
  color: SERIES_COLORS,
  tooltip: { trigger: 'item' },
  legend: { bottom: 0, textStyle: { color: chartTheme.value.label, fontSize: 10 } },
  series: [{
    type: 'pie',
    radius: '68%',
    center: ['50%', '44%'],
    label: { show: false },
    data: stats.value?.models.map(item => ({
      name: item.model,
      value: item.totalTokens,
    })) ?? [],
  }],
}))

const toolsOption = computed(() => {
  const items = [...(stats.value?.tools ?? [])].reverse()
  return {
    color: SERIES_COLORS,
    tooltip: { trigger: 'axis' },
    grid: { top: 10, right: 20, bottom: 24, left: 110 },
    xAxis: { type: 'value', minInterval: 1, ...axisBase() },
    yAxis: {
      type: 'category',
      data: items.map(item => item.tool),
      ...axisBase(),
      splitLine: { show: false },
    },
    series: [{
      name: t('overview.charts.toolCalls'),
      type: 'bar',
      barMaxWidth: 16,
      data: items.map(item => item.count),
    }],
  }
})
</script>

<template>
  <PageContainer wide>
    <h1 class="sr-only">
      {{ t('overview.title') }}
    </h1>

    <Alert
      v-if="statsError"
      class="stats-error"
      type="error"
      show-icon
      :message="t('overview.loadFailed')"
      :description="statsError"
    >
      <template #action>
        <Button size="small" :loading="statsLoading" @click="loadStats">
          {{ t('common.actions.retry') }}
        </Button>
      </template>
    </Alert>

    <Card v-else-if="statsLoading && !stats" class="chart-card" :bordered="false">
      <Skeleton active :paragraph="{ rows: 8 }" />
    </Card>

    <template v-else-if="stats">
      <section class="stat-grid" :aria-label="t('overview.title')">
        <Card class="stat-card" :bordered="false">
          <span class="stat-card__icon is-blue"><CommentOutlined /></span>
          <div>
            <small>{{ t('overview.cards.conversations') }}</small>
            <strong>{{ stats.totals.conversationCount.toLocaleString(locale) }}</strong>
            <p>{{ t('overview.cards.conversationsDetail', { count: stats.totals.messageCount.toLocaleString(locale) }) }}</p>
          </div>
        </Card>
        <Card class="stat-card" :bordered="false">
          <span class="stat-card__icon is-green"><BarsOutlined /></span>
          <div>
            <small>{{ t('overview.cards.runs') }}</small>
            <strong>{{ stats.totals.runCount.toLocaleString(locale) }}</strong>
            <p>{{ t('overview.cards.runsDetail', { count: windowRunCount.toLocaleString(locale) }) }}</p>
          </div>
        </Card>
        <Card class="stat-card" :bordered="false">
          <span class="stat-card__icon is-purple"><ThunderboltOutlined /></span>
          <div>
            <small>{{ t('overview.cards.tokens') }}</small>
            <strong>{{ formatTokens(stats.totals.inputTokens + stats.totals.outputTokens, locale) }}</strong>
            <p>
              {{ t('overview.cards.tokensDetail', {
                input: formatTokens(stats.totals.inputTokens, locale),
                output: formatTokens(stats.totals.outputTokens, locale),
              }) }}
            </p>
          </div>
        </Card>
        <Card class="stat-card" :bordered="false">
          <span class="stat-card__icon is-amber"><WalletOutlined /></span>
          <div>
            <small>{{ t('overview.cards.balance') }}</small>
            <strong>{{ balanceText }}</strong>
            <p>{{ t('overview.cards.balanceDetail') }}</p>
          </div>
        </Card>
      </section>

      <section class="chart-grid">
        <Card class="chart-card is-wide" :bordered="false" :title="t('overview.charts.dailyRuns', { days: stats.windowDays })">
          <VChart class="chart" :option="dailyRunsOption" autoresize />
        </Card>
        <Card class="chart-card is-wide" :bordered="false" :title="t('overview.charts.dailyTokens', { days: stats.windowDays })">
          <VChart class="chart" :option="dailyTokensOption" autoresize />
        </Card>
        <Card class="chart-card" :bordered="false" :title="t('overview.charts.statusDistribution', { days: stats.windowDays })">
          <Empty v-if="!statusItems.length" :description="t('overview.charts.empty')" />
          <VChart v-else class="chart" :option="statusOption" autoresize />
        </Card>
        <Card class="chart-card" :bordered="false" :title="t('overview.charts.modelDistribution', { days: stats.windowDays })">
          <Empty v-if="!stats.models.length" :description="t('overview.charts.empty')" />
          <VChart v-else class="chart" :option="modelsOption" autoresize />
        </Card>
        <Card class="chart-card" :bordered="false" :title="t('overview.charts.toolDistribution', { days: stats.windowDays })">
          <Empty v-if="!stats.tools.length" :description="t('overview.charts.empty')" />
          <VChart v-else class="chart" :option="toolsOption" autoresize />
        </Card>
      </section>
    </template>
  </PageContainer>
</template>

<style scoped>
.stats-error {
  margin-bottom: 12px;
}

.stat-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
}

.stat-card,
.chart-card {
  border: 1px solid var(--admin-border);
  background: var(--admin-surface);
  box-shadow: var(--admin-card-shadow);
}

.stat-card :deep(.ant-card-body) {
  display: flex;
  min-height: 96px;
  align-items: center;
  gap: 13px;
  padding: 16px;
}

.stat-card__icon {
  display: grid;
  width: 36px;
  height: 36px;
  flex: 0 0 36px;
  place-items: center;
  border-radius: 9px;
  font-size: 16px;
}

.stat-card__icon.is-blue {
  color: var(--admin-primary);
  background: var(--admin-primary-soft);
}

.stat-card__icon.is-green {
  color: var(--admin-success-strong);
  background: var(--admin-success-soft);
}

.stat-card__icon.is-purple {
  color: #8b5cf6;
  background: rgb(139 92 246 / 12%);
}

.stat-card__icon.is-amber {
  color: #b76400;
  background: rgb(245 158 11 / 12%);
}

.stat-card small,
.stat-card strong,
.stat-card p {
  display: block;
}

.stat-card small {
  color: var(--admin-text-muted);
  font-size: 10px;
  font-weight: 600;
}

.stat-card strong {
  margin-top: 3px;
  color: var(--admin-text);
  font-size: 20px;
  font-weight: 680;
  letter-spacing: -0.025em;
}

.stat-card p {
  margin: 2px 0 0;
  color: var(--admin-text-subtle);
  font-size: 10px;
}

.chart-grid {
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  gap: 12px;
  margin-top: 12px;
}

.chart-card {
  grid-column: span 2;
}

.chart-card.is-wide {
  grid-column: span 3;
}

.chart-card :deep(.ant-card-head) {
  min-height: 40px;
  padding: 0 14px;
  border-bottom-color: var(--admin-border);
}

.chart-card :deep(.ant-card-head-title) {
  padding: 10px 0;
  color: var(--admin-text-muted);
  font-size: 11px;
  font-weight: 650;
}

.chart-card :deep(.ant-card-body) {
  padding: 8px 10px 10px;
}

.chart {
  width: 100%;
  height: 240px;
}

@media (max-width: 1240px) {
  .stat-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .chart-grid {
    grid-template-columns: minmax(0, 1fr);
  }

  .chart-card,
  .chart-card.is-wide {
    grid-column: span 1;
  }
}
</style>
