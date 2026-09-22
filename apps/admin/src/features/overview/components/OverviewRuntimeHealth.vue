<script setup lang="ts">
import type { OverviewProviderBalanceItem, OverviewToolItem } from '../mock-data'
import {
  CheckCircleOutlined,
  ThunderboltOutlined,
  WalletOutlined,
} from '@ant-design/icons-vue'
import { Card, Tag } from 'ant-design-vue'
import { computed } from 'vue'
import VChart from 'vue-echarts'
import { useI18n } from 'vue-i18n'

import LlmFamilyLogo from '@/features/llm/components/LlmFamilyLogo.vue'
import { useAdminPreferencesStore } from '@/stores/preferences'

import '@/features/overview/echarts'

const props = withDefaults(defineProps<{
  statusCounts: {
    COMPLETED: number
    FAILED: number
    ABORTED: number
    RUNNING: number
  }
  tools: OverviewToolItem[]
  balances: OverviewProviderBalanceItem[]
  successRate: number
  stacked?: boolean
  loading?: boolean
}>(), {
  stacked: false,
})

const { locale, t } = useI18n()
const preferences = useAdminPreferencesStore()

const chartTheme = computed(() => (
  preferences.resolvedTheme === 'dark'
    ? { text: '#f3f4f6', subtext: '#9ca3af', tooltipBg: '#1e1e24', tooltipBorder: '#3a3a40' }
    : { text: '#111827', subtext: '#6b7280', tooltipBg: '#ffffff', tooltipBorder: '#e5e7eb' }
))

const STATUS_COLORS: Record<string, string> = {
  COMPLETED: '#10b981',
  FAILED: '#ef4444',
  ABORTED: '#f59e0b',
  RUNNING: '#0284c7',
}

const statusChartOption = computed(() => {
  const data = [
    { value: props.statusCounts.COMPLETED, name: 'COMPLETED', itemStyle: { color: STATUS_COLORS.COMPLETED } },
    { value: props.statusCounts.FAILED, name: 'FAILED', itemStyle: { color: STATUS_COLORS.FAILED } },
    { value: props.statusCounts.ABORTED, name: 'ABORTED', itemStyle: { color: STATUS_COLORS.ABORTED } },
  ].filter(item => item.value > 0)

  return {
    tooltip: {
      trigger: 'item',
      backgroundColor: chartTheme.value.tooltipBg,
      borderColor: chartTheme.value.tooltipBorder,
      textStyle: { color: preferences.resolvedTheme === 'dark' ? '#f3f4f6' : '#1f2937', fontSize: 11 },
      formatter: '{b}: {c} ({d}%)',
    },
    title: {
      text: `${props.successRate}%`,
      subtext: t('overview.charts.successRateLabel'),
      left: 'center',
      top: '32%',
      textStyle: {
        fontSize: 18,
        fontWeight: 'bold',
        color: chartTheme.value.text,
      },
      subtextStyle: {
        fontSize: 10,
        color: chartTheme.value.subtext,
      },
    },
    series: [
      {
        name: 'Status',
        type: 'pie',
        radius: ['58%', '82%'],
        center: ['50%', '50%'],
        avoidLabelOverlap: false,
        label: { show: false },
        emphasis: {
          scale: true,
          scaleSize: 4,
        },
        data,
      },
    ],
  }
})

const totalStatusCount = computed(() => (
  props.statusCounts.COMPLETED + props.statusCounts.FAILED + props.statusCounts.ABORTED
))
</script>

<template>
  <section class="bottom-grid" :class="{ 'is-stacked': props.stacked }">
    <!-- Card 1: 运行终态质量 (紧凑窄卡片: 饼图 + 右侧指标) -->
    <Card class="bottom-card is-narrow" :bordered="false">
      <div class="bottom-card__head">
        <h2 class="bottom-card__title">
          {{ t('overview.charts.statusDistribution') }}
        </h2>
        <Tag color="success" class="bottom-card__tag">
          <template #icon>
            <CheckCircleOutlined />
          </template>
          稳定
        </Tag>
      </div>

      <div class="status-body">
        <div class="status-chart-box">
          <VChart class="status-chart" :option="statusChartOption" autoresize />
        </div>

        <div class="status-legend">
          <div class="status-legend__item">
            <div class="status-legend__head">
              <span class="status-legend__dot" :style="{ background: STATUS_COLORS.COMPLETED }" />
              <span class="status-legend__name">COMPLETED</span>
            </div>
            <div class="status-legend__val">
              <strong>{{ props.statusCounts.COMPLETED.toLocaleString(locale) }}</strong>
              <small>{{ totalStatusCount ? Math.round((props.statusCounts.COMPLETED / totalStatusCount) * 100) : 0 }}%</small>
            </div>
          </div>

          <div class="status-legend__item">
            <div class="status-legend__head">
              <span class="status-legend__dot" :style="{ background: STATUS_COLORS.FAILED }" />
              <span class="status-legend__name">FAILED</span>
            </div>
            <div class="status-legend__val">
              <strong>{{ props.statusCounts.FAILED.toLocaleString(locale) }}</strong>
              <small>{{ totalStatusCount ? Math.round((props.statusCounts.FAILED / totalStatusCount) * 100) : 0 }}%</small>
            </div>
          </div>

          <div class="status-legend__item">
            <div class="status-legend__head">
              <span class="status-legend__dot" :style="{ background: STATUS_COLORS.ABORTED }" />
              <span class="status-legend__name">ABORTED</span>
            </div>
            <div class="status-legend__val">
              <strong>{{ props.statusCounts.ABORTED.toLocaleString(locale) }}</strong>
              <small>{{ totalStatusCount ? Math.round((props.statusCounts.ABORTED / totalStatusCount) * 100) : 0 }}%</small>
            </div>
          </div>
        </div>
      </div>
    </Card>

    <!-- Card 2: 工具调用排行 -->
    <Card class="bottom-card" :bordered="false">
      <div class="bottom-card__head">
        <h2 class="bottom-card__title">
          {{ t('overview.charts.toolDistribution') }}
        </h2>
        <span class="bottom-card__sub"><ThunderboltOutlined /> Top Calls</span>
      </div>

      <div class="bottom-card__content">
        <div v-if="!props.tools.length" class="tools-empty">
          {{ t('overview.charts.emptyTools') }}
        </div>

        <ul v-else class="tool-list">
          <li v-for="item in props.tools" :key="item.name" class="tool-item">
            <div class="tool-item__top">
              <div class="tool-item__names">
                <code class="tool-item__code">{{ item.name }}</code>
                <Tag class="tool-item__category" :bordered="false">
                  {{ item.category }}
                </Tag>
              </div>
              <div class="tool-item__stats">
                <strong class="tool-item__count">{{ item.count.toLocaleString(locale) }}</strong>
                <small class="tool-item__percent">{{ item.percent }}%</small>
              </div>
            </div>

            <div class="tool-item__track">
              <div
                class="tool-item__fill"
                :style="{ width: `${item.percent}%` }"
              />
            </div>
          </li>
        </ul>
      </div>
    </Card>

    <!-- Card 3: 平台额度与连通状态 (平铺展示) -->
    <Card class="bottom-card" :bordered="false">
      <div class="bottom-card__head">
        <h2 class="bottom-card__title">
          {{ t('overview.cards.balancesTitle') }}
        </h2>
        <span class="bottom-card__sub"><WalletOutlined /> 实时就绪</span>
      </div>

      <div class="bottom-card__content">
        <div class="balance-list">
          <div
            v-for="item in props.balances"
            :key="item.id"
            class="balance-row"
          >
            <div class="balance-row__left">
              <LlmFamilyLogo :family="item.family" :size="14" badge />
              <div class="balance-row__names">
                <strong>{{ t(`llmModels.families.${item.family}`) }}</strong>
                <small>{{ item.note }}</small>
              </div>
            </div>

            <div class="balance-row__right">
              <span class="balance-row__val">{{ item.balance }}</span>
              <span class="balance-row__cur">{{ item.currency }}</span>
            </div>
          </div>
        </div>
      </div>
    </Card>
  </section>
</template>

<style scoped>
.bottom-grid {
  display: grid;
  grid-template-columns: minmax(320px, 1fr) minmax(320px, 1.15fr) minmax(320px, 1.15fr);
  gap: 14px;
  margin-top: 14px;
}

.bottom-grid.is-stacked {
  display: flex;
  flex-direction: column;
  gap: 14px;
  margin-top: 0;
}

.bottom-card {
  border: 1px solid var(--admin-border);
  background: var(--admin-surface);
  box-shadow: var(--admin-shadow-sm);
  border-radius: var(--admin-radius-md, 10px);
  display: flex;
  flex-direction: column;
}

.bottom-card :deep(.ant-card-body) {
  padding: 14px 16px;
  display: flex;
  flex-direction: column;
  flex: 1;
}

.bottom-card__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
  min-height: 22px;
}

.bottom-card__title {
  margin: 0;
  color: var(--admin-text);
  font-size: var(--admin-font-sm, 13px);
  font-weight: 650;
  line-height: 1.3;
}

.bottom-card__tag {
  margin: 0;
  font-size: var(--admin-font-2xs, 10px);
  line-height: 18px;
  padding: 0 6px;
  border-radius: 4px;
}

.bottom-card__sub {
  color: var(--admin-text-subtle);
  font-size: var(--admin-font-2xs, 11px);
  display: flex;
  align-items: center;
  gap: 4px;
}

.bottom-card__content {
  flex: 1;
}

/* Status Donut layout */
.status-body {
  display: flex;
  align-items: center;
  gap: 14px;
  flex: 1;
}

.status-chart-box {
  width: 130px;
  height: 130px;
  flex-shrink: 0;
  position: relative;
}

.status-chart {
  width: 100%;
  height: 100%;
}

.status-legend {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 7px;
  min-width: 0;
}

.status-legend__item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 8px;
  border-radius: var(--admin-radius-sm, 5px);
  background: var(--admin-surface-muted);
}

.status-legend__head {
  display: flex;
  align-items: center;
  gap: 6px;
}

.status-legend__dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex-shrink: 0;
}

.status-legend__name {
  color: var(--admin-text);
  font-size: var(--admin-font-2xs, 11px);
  font-weight: 600;
}

.status-legend__val {
  display: flex;
  align-items: baseline;
  gap: 4px;
}

.status-legend__val strong {
  color: var(--admin-text);
  font-size: var(--admin-font-xs, 12px);
  font-variant-numeric: tabular-nums;
}

.status-legend__val small {
  color: var(--admin-text-subtle);
  font-size: var(--admin-font-2xs, 10px);
}

/* Tools layout */
.tool-list {
  display: flex;
  flex-direction: column;
  gap: 9px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.tool-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.tool-item__top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.tool-item__names {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.tool-item__code {
  font-size: var(--admin-font-2xs, 11px);
  color: var(--admin-text);
  font-family: monospace;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tool-item__category {
  margin: 0;
  font-size: var(--admin-font-2xs, 9px);
  padding: 0 4px;
  line-height: 14px;
  background: var(--admin-bg-deep);
  color: var(--admin-text-subtle);
  border-radius: 3px;
}

.tool-item__stats {
  display: flex;
  align-items: baseline;
  gap: 4px;
  flex-shrink: 0;
}

.tool-item__count {
  font-size: var(--admin-font-xs, 11px);
  color: var(--admin-text);
  font-variant-numeric: tabular-nums;
}

.tool-item__percent {
  font-size: var(--admin-font-2xs, 10px);
  color: var(--admin-text-subtle);
}

.tool-item__track {
  height: 4px;
  border-radius: 2px;
  background: var(--admin-bg-deep);
  overflow: hidden;
}

.tool-item__fill {
  height: 100%;
  border-radius: 2px;
  background: var(--admin-primary);
  transition: width 300ms ease;
}

.tools-empty {
  padding: 16px 0;
  color: var(--admin-text-subtle);
  font-size: var(--admin-font-xs, 12px);
  text-align: center;
}

/* Balances layout */
.balance-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.balance-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 8px;
  border-radius: var(--admin-radius-sm, 6px);
  background: var(--admin-surface-muted);
  gap: 10px;
}

.balance-row__left {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.balance-row__names {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.balance-row__names strong {
  font-size: var(--admin-font-2xs, 11px);
  color: var(--admin-text);
  line-height: 1.2;
}

.balance-row__names small {
  font-size: var(--admin-font-2xs, 10px);
  color: var(--admin-text-subtle);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.balance-row__right {
  display: flex;
  align-items: baseline;
  gap: 4px;
  flex-shrink: 0;
}

.balance-row__val {
  font-size: var(--admin-font-xs, 12px);
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  color: var(--admin-text);
}

.balance-row__cur {
  font-size: var(--admin-font-2xs, 10px);
  color: var(--admin-text-muted);
}

@media (max-width: 1100px) {
  .bottom-grid {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
