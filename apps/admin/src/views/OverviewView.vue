<script setup lang="ts">
import type { AdminOverviewWindow } from '@agent/contracts'

import { ReloadOutlined, SettingOutlined } from '@ant-design/icons-vue'
import { Alert, Button, Segmented, Skeleton, Tooltip } from 'ant-design-vue'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'

import PageContainer from '@/components/common/PageContainer.vue'
import OverviewKpiRow from '@/features/overview/components/OverviewKpiRow.vue'
import OverviewModelTable from '@/features/overview/components/OverviewModelTable.vue'
import OverviewToolUsageCard from '@/features/overview/components/OverviewToolUsageCard.vue'
import OverviewTrendCard from '@/features/overview/components/OverviewTrendCard.vue'
import { toBalanceText } from '@/features/overview/overview.model'
import { useOverviewDashboard } from '@/features/overview/overview.state'
import { formatTime } from '@/features/runs/run.utils'

const { locale, t } = useI18n()
const router = useRouter()

const {
  activeWindow,
  stats,
  statsLoading,
  statsError,
  balance,
  balanceLoading,
  balanceCheckedAt,
  lastUpdatedAt,
  kpi,
  trend,
  modelRows,
  toolRows,
  loadStats,
  refresh,
} = useOverviewDashboard()

const windowOptions = computed<{ label: string, value: AdminOverviewWindow }[]>(() => [
  { label: t('overview.windows.d1'), value: '24h' },
  { label: t('overview.windows.d7'), value: '7d' },
  { label: t('overview.windows.d30'), value: '30d' },
])

const isInitialLoading = computed(() => statsLoading.value && !stats.value)
const balanceText = computed(() => (
  balanceLoading.value && !balance.value ? '…' : toBalanceText(balance.value, t('overview.balance.unavailable'))
))
const balanceTooltip = computed(() => (
  balanceCheckedAt.value ? t('overview.balance.checkedAt', { time: formatTime(balanceCheckedAt.value, locale.value) }) : undefined
))
const statusText = computed(() => {
  if (statsLoading.value)
    return t('overview.refreshing')
  return lastUpdatedAt.value ? t('overview.lastUpdated', { time: formatTime(lastUpdatedAt.value, locale.value) }) : ''
})
</script>

<template>
  <PageContainer wide>
    <h1 class="sr-only">
      {{ t('overview.title') }}
    </h1>

    <div class="overview-toolbar">
      <div class="overview-toolbar__left">
        <Segmented v-model:value="activeWindow" size="small" :options="windowOptions" />
        <span class="overview-toolbar__status">
          <span class="status-dot" :class="{ 'is-loading': statsLoading }" />
          {{ statusText }}
        </span>
      </div>
      <div class="overview-toolbar__right">
        <Tooltip :title="balanceTooltip">
          <span class="overview-toolbar__balance" :class="{ 'is-unavailable': !balance?.available }">
            <span class="overview-toolbar__balance-label">{{ t('overview.balance.title') }}</span>
            <strong class="overview-toolbar__balance-value">{{ balanceText }}</strong>
          </span>
        </Tooltip>
        <Button size="small" type="text" :loading="statsLoading" @click="refresh">
          <template #icon>
            <ReloadOutlined />
          </template>
          {{ t('overview.refresh') }}
        </Button>
        <Button size="small" type="text" @click="router.push({ name: 'llm-models' })">
          <template #icon>
            <SettingOutlined />
          </template>
          {{ t('overview.manageModels') }}
        </Button>
      </div>
    </div>

    <Alert
      v-if="statsError"
      class="overview-error"
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

    <div v-else-if="isInitialLoading" class="overview-skeleton">
      <Skeleton active :paragraph="{ rows: 8 }" />
    </div>

    <div v-else-if="stats" class="overview-grid">
      <div class="overview-grid__main">
        <OverviewKpiRow :kpi="kpi" />
        <OverviewTrendCard :points="trend" :bucket="stats.bucket" />
        <OverviewToolUsageCard :rows="toolRows" />
      </div>
      <div class="overview-grid__side">
        <OverviewModelTable :rows="modelRows" :loading="statsLoading" />
      </div>
    </div>
  </PageContainer>
</template>

<style scoped>
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}

.overview-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 10px;
  margin-bottom: 14px;
  padding: 0 4px;
}

.overview-toolbar__left,
.overview-toolbar__right {
  display: flex;
  align-items: center;
  gap: 10px;
}

.overview-toolbar__status {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--admin-text-subtle);
  font-size: 11px;
}

.overview-toolbar__balance {
  display: inline-flex;
  align-items: baseline;
  gap: 6px;
  margin-right: 6px;
  padding: 2px 10px;
  border: 1px solid var(--admin-border);
  border-radius: 999px;
  background: var(--admin-surface);
  font-size: 12px;
}

.overview-toolbar__balance-label {
  color: var(--admin-text-subtle);
}

.overview-toolbar__balance-value {
  color: var(--admin-text);
  font-variant-numeric: tabular-nums;
}

.overview-toolbar__balance.is-unavailable .overview-toolbar__balance-value {
  color: var(--admin-text-subtle);
  font-weight: 500;
}

.status-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--admin-success);
}

.status-dot.is-loading {
  background: var(--admin-primary);
  animation: pulse 800ms infinite alternate ease-in-out;
}

@keyframes pulse {
  from {
    opacity: 0.4;
  }

  to {
    opacity: 1;
  }
}

.overview-error,
.overview-skeleton {
  margin-bottom: 14px;
}

.overview-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.28fr) minmax(0, 1fr);
  gap: 14px;
  align-items: start;
}

.overview-grid__main,
.overview-grid__side {
  display: flex;
  flex-direction: column;
  gap: 14px;
  min-width: 0;
}

.overview-grid > * {
  animation: card-enter 420ms cubic-bezier(0.16, 1, 0.3, 1) both;
}

.overview-grid__side {
  animation-delay: 60ms;
}

@keyframes card-enter {
  from {
    opacity: 0;
    transform: translateY(12px);
  }

  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@media (prefers-reduced-motion: reduce) {
  .overview-grid > * {
    animation: none;
  }
}

@media (max-width: 1240px) {
  .overview-grid {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
