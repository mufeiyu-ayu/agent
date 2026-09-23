<script setup lang="ts">
import type { AdminOverviewWindow, AgentRunErrorCode } from '@agent/contracts'

import { ReloadOutlined, SettingOutlined } from '@ant-design/icons-vue'
import { Alert, Button, Segmented, Skeleton } from 'ant-design-vue'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'

import PageContainer from '@/components/common/PageContainer.vue'
import OverviewFailureReasonsCard from '@/features/overview/components/OverviewFailureReasonsCard.vue'
import OverviewKpiRow from '@/features/overview/components/OverviewKpiRow.vue'
import OverviewModelTable from '@/features/overview/components/OverviewModelTable.vue'
import OverviewToolUsageCard from '@/features/overview/components/OverviewToolUsageCard.vue'
import OverviewTrendCard from '@/features/overview/components/OverviewTrendCard.vue'
import { toBalanceText, toFailureReasonRunsLocation } from '@/features/overview/overview.model'
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
  trend,
  failureReasonRows,
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
const balanceDetail = computed(() => (
  balanceCheckedAt.value
    ? t('overview.balance.checkedAt', { time: formatTime(balanceCheckedAt.value, locale.value) })
    : t('overview.balance.provider')
))
const statusText = computed(() => {
  if (statsLoading.value)
    return t('overview.refreshing')
  return lastUpdatedAt.value ? t('overview.lastUpdated', { time: formatTime(lastUpdatedAt.value, locale.value) }) : ''
})

function openFailureReason(errorCode: AgentRunErrorCode) {
  if (stats.value)
    void router.push(toFailureReasonRunsLocation(errorCode, stats.value))
}
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

    <div v-else-if="stats && trend" class="overview-grid">
      <OverviewKpiRow
        :stats="stats"
        :balance-text="balanceText"
        :balance-detail="balanceDetail"
        :balance-unavailable="!balance?.available"
      />
      <div class="overview-grid__health">
        <OverviewTrendCard :trend="trend" :bucket="stats.bucket" />
        <OverviewFailureReasonsCard :rows="failureReasonRows" @select="openFailureReason" />
      </div>
      <OverviewModelTable :rows="modelRows" :loading="statsLoading" />
      <OverviewToolUsageCard :rows="toolRows" />
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
  display: flex;
  flex-direction: column;
  gap: 14px;
  min-width: 0;
}

.overview-grid__health {
  display: grid;
  grid-template-columns: minmax(0, 2fr) minmax(280px, 1fr);
  gap: 14px;
  align-items: stretch;
}

.overview-grid > * {
  animation: card-enter 420ms cubic-bezier(0.16, 1, 0.3, 1) both;
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
  .overview-grid__health {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
