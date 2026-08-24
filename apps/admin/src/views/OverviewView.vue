<script setup lang="ts">
import type { AdminOverviewStats, AdminProviderBalance } from '@agent/contracts'
import { Alert, Button, Card, Skeleton } from 'ant-design-vue'
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

// 余额独立加载：provider 查询失败只影响余额格，不阻塞统计。
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

interface DistributionRow {
  key: string
  label: string
  valueText: string
  ratio: number
  color: string
}

/** 分布行：名称 + 数值 + 占比条。少量数据也保持信息密度，不画悬空饼图。 */
const statusRows = computed<DistributionRow[]>(() => {
  const entries = Object.entries(stats.value?.statusCounts ?? {}).filter(([, count]) => count > 0)
  const total = entries.reduce((sum, [, count]) => sum + count, 0)

  return entries.map(([status, count]) => ({
    key: status,
    label: status,
    valueText: `${count.toLocaleString(locale.value)} · ${formatPercent(count, total)}`,
    ratio: total === 0 ? 0 : count / total,
    color: STATUS_COLORS[status] ?? SERIES_COLORS[0]!,
  }))
})

const modelRows = computed<DistributionRow[]>(() => {
  const models = stats.value?.models ?? []
  const total = models.reduce((sum, item) => sum + item.totalTokens, 0)

  return models.map((item, index) => ({
    key: item.model,
    label: item.model,
    valueText: `${formatTokens(item.totalTokens, locale.value)} · ${formatPercent(item.totalTokens, total)}`,
    ratio: total === 0 ? 0 : item.totalTokens / total,
    color: SERIES_COLORS[index % SERIES_COLORS.length]!,
  }))
})

const toolRows = computed<DistributionRow[]>(() => {
  const tools = stats.value?.tools ?? []
  const total = tools.reduce((sum, item) => sum + item.count, 0)

  return tools.map((item, index) => ({
    key: item.tool,
    label: item.tool,
    valueText: `${item.count.toLocaleString(locale.value)} · ${formatPercent(item.count, total)}`,
    ratio: total === 0 ? 0 : item.count / total,
    color: SERIES_COLORS[index % SERIES_COLORS.length]!,
  }))
})

function formatPercent(value: number, total: number): string {
  if (total === 0)
    return '0%'
  return `${Math.round((value / total) * 100)}%`
}
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
      <Card class="stat-bar" :bordered="false">
        <div class="stat-bar__grid" role="group" :aria-label="t('overview.title')">
          <div class="stat-cell">
            <small>{{ t('overview.cards.conversations') }}</small>
            <strong>{{ stats.totals.conversationCount.toLocaleString(locale) }}</strong>
            <p>{{ t('overview.cards.conversationsDetail', { count: stats.totals.messageCount.toLocaleString(locale) }) }}</p>
          </div>
          <div class="stat-cell">
            <small>{{ t('overview.cards.runs') }}</small>
            <strong>{{ stats.totals.runCount.toLocaleString(locale) }}</strong>
            <p>{{ t('overview.cards.runsDetail', { count: windowRunCount.toLocaleString(locale) }) }}</p>
          </div>
          <div class="stat-cell">
            <small>{{ t('overview.cards.tokens') }}</small>
            <strong>{{ formatTokens(stats.totals.inputTokens + stats.totals.outputTokens, locale) }}</strong>
            <p>
              {{ t('overview.cards.tokensDetail', {
                input: formatTokens(stats.totals.inputTokens, locale),
                output: formatTokens(stats.totals.outputTokens, locale),
              }) }}
            </p>
          </div>
          <div class="stat-cell">
            <small>{{ t('overview.cards.balance') }}</small>
            <strong>{{ balanceText }}</strong>
            <p>{{ t('overview.cards.balanceDetail') }}</p>
          </div>
        </div>
      </Card>

      <section class="chart-grid">
        <Card class="chart-card" :bordered="false" :title="t('overview.charts.dailyRuns', { days: stats.windowDays })">
          <VChart class="chart" :option="dailyRunsOption" autoresize />
        </Card>
        <Card class="chart-card" :bordered="false" :title="t('overview.charts.dailyTokens', { days: stats.windowDays })">
          <VChart class="chart" :option="dailyTokensOption" autoresize />
        </Card>
      </section>

      <section class="dist-grid">
        <Card class="dist-card" :bordered="false" :title="t('overview.charts.statusDistribution', { days: stats.windowDays })">
          <p v-if="!statusRows.length" class="dist-empty">
            {{ t('overview.charts.empty') }}
          </p>
          <ul v-else class="dist-list">
            <li v-for="row in statusRows" :key="row.key">
              <div class="dist-row__head">
                <span class="dist-row__label">
                  <i class="dist-row__dot" :style="{ background: row.color }" />
                  {{ row.label }}
                </span>
                <span class="dist-row__value">{{ row.valueText }}</span>
              </div>
              <div class="dist-row__track">
                <div class="dist-row__fill" :style="{ width: `${row.ratio * 100}%`, background: row.color }" />
              </div>
            </li>
          </ul>
        </Card>

        <Card class="dist-card" :bordered="false" :title="t('overview.charts.modelDistribution', { days: stats.windowDays })">
          <p v-if="!modelRows.length" class="dist-empty">
            {{ t('overview.charts.empty') }}
          </p>
          <ul v-else class="dist-list">
            <li v-for="row in modelRows" :key="row.key">
              <div class="dist-row__head">
                <span class="dist-row__label">
                  <i class="dist-row__dot" :style="{ background: row.color }" />
                  {{ row.label }}
                </span>
                <span class="dist-row__value">{{ row.valueText }}</span>
              </div>
              <div class="dist-row__track">
                <div class="dist-row__fill" :style="{ width: `${row.ratio * 100}%`, background: row.color }" />
              </div>
            </li>
          </ul>
        </Card>

        <Card class="dist-card" :bordered="false" :title="t('overview.charts.toolDistribution', { days: stats.windowDays })">
          <p v-if="!toolRows.length" class="dist-empty">
            {{ t('overview.charts.emptyTools') }}
          </p>
          <ul v-else class="dist-list">
            <li v-for="row in toolRows" :key="row.key">
              <div class="dist-row__head">
                <span class="dist-row__label">
                  <i class="dist-row__dot" :style="{ background: row.color }" />
                  {{ row.label }}
                </span>
                <span class="dist-row__value">{{ row.valueText }}</span>
              </div>
              <div class="dist-row__track">
                <div class="dist-row__fill" :style="{ width: `${row.ratio * 100}%`, background: row.color }" />
              </div>
            </li>
          </ul>
        </Card>
      </section>
    </template>
  </PageContainer>
</template>

<style scoped>
.stats-error {
  margin-bottom: 12px;
}

.stat-bar,
.chart-card,
.dist-card {
  border: 1px solid var(--admin-border);
  background: var(--admin-surface);
  box-shadow: var(--admin-shadow-sm);
}

.stat-bar :deep(.ant-card-body) {
  padding: 0;
}

.stat-bar__grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
}

.stat-cell {
  min-width: 0;
  padding: 16px 20px 14px;
}

.stat-cell + .stat-cell {
  border-inline-start: 1px solid var(--admin-border);
}

.stat-cell small {
  display: block;
  color: var(--admin-text-muted);
  font-size: var(--admin-font-xs);
  font-weight: 600;
}

.stat-cell strong {
  display: block;
  overflow: hidden;
  margin-top: 6px;
  color: var(--admin-text);
  font-size: var(--admin-font-2xl);
  font-variant-numeric: tabular-nums;
  font-weight: 680;
  letter-spacing: -0.02em;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.stat-cell p {
  margin: 4px 0 0;
  overflow: hidden;
  color: var(--admin-text-subtle);
  font-size: var(--admin-font-2xs);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.chart-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  margin-top: 12px;
}

.dist-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  align-items: start;
  gap: 12px;
  margin-top: 12px;
}

.chart-card :deep(.ant-card-head),
.dist-card :deep(.ant-card-head) {
  min-height: 40px;
  padding: 0 14px;
  border-bottom-color: var(--admin-border);
}

.chart-card :deep(.ant-card-head-title),
.dist-card :deep(.ant-card-head-title) {
  padding: 10px 0;
  color: var(--admin-text-muted);
  font-size: var(--admin-font-xs);
  font-weight: 650;
}

.chart-card :deep(.ant-card-body) {
  padding: 8px 10px 10px;
}

.dist-card :deep(.ant-card-body) {
  padding: 6px 14px 14px;
}

.chart {
  width: 100%;
  height: 240px;
}

.dist-empty {
  margin: 0;
  padding: 18px 0 12px;
  color: var(--admin-text-subtle);
  font-size: var(--admin-font-sm);
}

.dist-list {
  display: flex;
  flex-direction: column;
  gap: 13px;
  margin: 0;
  padding: 10px 0 0;
  list-style: none;
}

.dist-row__head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 6px;
}

.dist-row__label {
  display: inline-flex;
  min-width: 0;
  align-items: center;
  gap: 7px;
  overflow: hidden;
  color: var(--admin-text);
  font-size: var(--admin-font-sm);
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dist-row__dot {
  width: 7px;
  height: 7px;
  flex: none;
  border-radius: 50%;
}

.dist-row__value {
  flex: none;
  color: var(--admin-text-muted);
  font-size: var(--admin-font-xs);
  font-variant-numeric: tabular-nums;
}

.dist-row__track {
  height: 6px;
  overflow: hidden;
  border-radius: 3px;
  background: var(--admin-bg-deep);
}

.dist-row__fill {
  height: 100%;
  border-radius: 3px;
  transition: width 300ms cubic-bezier(0.22, 0.61, 0.36, 1);
}

@media (prefers-reduced-motion: reduce) {
  .dist-row__fill {
    transition: none;
  }
}

@media (max-width: 1240px) {
  .stat-bar__grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .stat-cell:nth-child(2n + 1) {
    border-inline-start: none;
  }

  .stat-cell:nth-child(n + 3) {
    border-top: 1px solid var(--admin-border);
  }

  .chart-grid,
  .dist-grid {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
