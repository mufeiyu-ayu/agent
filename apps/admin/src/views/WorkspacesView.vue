<script setup lang="ts">
import type { WorkspaceMonitorItem } from '@agent/contracts'
import type { TableColumnsType } from 'ant-design-vue'
import { InfoCircleOutlined, ReloadOutlined } from '@ant-design/icons-vue'
import { Alert, Button, Tag, Tooltip } from 'ant-design-vue'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import DataTable from '@/components/common/DataTable.vue'
import PageContainer from '@/components/common/PageContainer.vue'
import PageHeader from '@/components/common/PageHeader.vue'
import UserIdentity from '@/components/common/UserIdentity.vue'
import { formatDateTime, formatShortDateTime } from '@/features/runs/run.utils'
import WorkspaceHistoryDrawer from '@/features/workspaces/WorkspaceHistoryDrawer.vue'
import { useWorkspaces } from '@/features/workspaces/workspaces.state'
import { formatWorkspaceBytes, formatWorkspaceDuration, workspaceStateColor } from '@/features/workspaces/workspaces.utils'

const { t, locale } = useI18n()
const { data, cloud, loading, error, page, pageSize, load, refresh, changePage, historyId, history, historyWorkspace, historyPage, historyPageSize, changeHistoryPage, closeHistory } = useWorkspaces()
const { data: historyData, loading: historyLoading, error: historyError, notFound: historyNotFound } = history
const tableLoading = computed(() => loading.value && (!data.value || data.value.pagination.page !== page.value || data.value.pagination.pageSize !== pageSize.value))
const cloudCount = computed(() => error.value || cloud.value?.sandbox.error ? t('workspaces.unknown') : cloud.value?.sandbox.instances?.length ?? '—')
const pagination = computed(() => ({ current: page.value, pageSize: pageSize.value, total: data.value?.pagination.total ?? 0 }))
const columns = computed<TableColumnsType<WorkspaceMonitorItem>>(() => [
  { title: t('workspaces.conversation'), key: 'title', width: '26%', ellipsis: true },
  { title: t('workspaces.user'), key: 'user', width: '18%' },
  { title: t('workspaces.files'), key: 'files', width: '10%', align: 'right' },
  { title: t('workspaces.sandboxState'), key: 'state', width: '12%' },
  { title: t('workspaces.recordsColumn'), key: 'runs', width: '9%', align: 'right' },
  { title: t('workspaces.totalDuration'), key: 'duration', width: '10%', align: 'right' },
  { title: t('workspaces.updatedAt'), key: 'time', width: '12%', align: 'right' },
])
const date = (value: string | null | undefined) => value ? formatDateTime(value, locale.value) : '—'
const detailRoute = (row: WorkspaceMonitorItem) => ({ name: 'workspaces', query: { workspace: row.conversationId } })
const duration = formatWorkspaceDuration
const storage = (bytes: number | null | undefined) => formatWorkspaceBytes(bytes, locale.value)
</script>

<template>
  <PageContainer wide>
    <PageHeader :title="t('workspaces.title')">
      <template #actions>
        <Button :loading="loading" :disabled="loading" @click="refresh">
          <template #icon>
            <ReloadOutlined />
          </template>
          {{ t(loading ? 'workspaces.refreshing' : 'workspaces.refresh') }}
        </Button>
      </template>
    </PageHeader>
    <Alert v-if="data && !data.configured" type="warning" :message="t('workspaces.unconfigured')" show-icon class="resource-error" />
    <Alert v-if="cloud?.sandbox.error || cloud?.oss.error" type="warning" :message="cloud?.sandbox.error || cloud?.oss.error" show-icon class="resource-error" />
    <div class="resource-summary">
      <div class="resource-stat" data-cloud-sandbox>
        <Tooltip :title="t('workspaces.cloudHint', { time: date(cloud?.sandbox.checkedAt) })">
          <span class="resource-stat__label">{{ t('workspaces.cloudInstances') }} <InfoCircleOutlined /></span>
        </Tooltip>
        <strong>{{ cloudCount }}</strong>
      </div>
      <div class="resource-stat">
        <span class="resource-stat__label">{{ t('workspaces.todayAttempts') }}</span>
        <strong>{{ data?.summary.todayAttempts ?? '—' }}</strong>
      </div>
      <div class="resource-stat" data-workspace-summary>
        <Tooltip :title="t('workspaces.durationHint')">
          <span class="resource-stat__label">{{ t('workspaces.totalDuration') }} <InfoCircleOutlined /></span>
        </Tooltip>
        <strong>{{ duration(data?.summary.confirmedDurationMs) }}</strong>
      </div>
      <div class="resource-stat" data-cloud-storage>
        <Tooltip :title="t('workspaces.storageHint', { bucket: cloud?.oss.bucket ?? '—', time: date(cloud?.oss.measuredAt) })">
          <span class="resource-stat__label">{{ t('workspaces.storage') }} <InfoCircleOutlined /></span>
        </Tooltip>
        <strong>{{ storage(cloud?.oss.storageBytes) }} <small>{{ t('workspaces.objects', { count: cloud?.oss.objectCount ?? '—' }) }}</small></strong>
      </div>
    </div>
    <DataTable :columns="columns" :data-source="data?.items ?? []" row-key="conversationId" :loading="tableLoading" :error="error" :scroll-x="1080" :pagination="pagination" :summary="t('workspaces.total', { count: pagination.total })" :empty-text="t('workspaces.empty')" :row-to="detailRoute" @page-change="changePage" @retry="load()">
      <template #bodyCell="{ column, record }">
        <template v-if="column.key === 'title'">
          <Tooltip :title="record.title">
            <span class="record-title">{{ record.title }}</span>
          </Tooltip>
          <Tag v-if="record.deleted" class="deleted-tag">
            {{ t('workspaces.deleted') }}
          </Tag>
        </template>
        <template v-else-if="column.key === 'user'">
          <UserIdentity v-if="record.user" :user="record.user" :size="28" />
          <span v-else class="mono-cell" :title="record.userId">{{ record.userId }}</span>
        </template>
        <template v-else-if="column.key === 'files'">
          <span class="numeric-cell">{{ record.fileCount ?? '—' }}</span>
          <p class="secondary-cell">
            {{ storage(record.fileBytes) }}
          </p>
        </template>
        <template v-else-if="column.key === 'state'">
          <Tooltip :title="record.lastError">
            <Tag :color="workspaceStateColor(record.state)">
              {{ t(`workspaces.states.${record.state}`, record.state) }}
            </Tag>
          </Tooltip>
        </template>
        <span v-else-if="column.key === 'runs'" class="numeric-cell">{{ record.sandboxCount }}</span>
        <span v-else-if="column.key === 'duration'" class="numeric-cell">{{ duration(record.confirmedDurationMs) }}</span>
        <Tooltip v-else-if="column.key === 'time'" :title="date(record.updatedAt)">
          <span class="date-cell">{{ formatShortDateTime(record.updatedAt, locale) }}</span>
        </Tooltip>
      </template>
    </DataTable>
    <WorkspaceHistoryDrawer :open="Boolean(historyId)" :workspace="historyWorkspace" :data="historyData" :loading="historyLoading" :error="historyError" :not-found="historyNotFound" :page="historyPage" :page-size="historyPageSize" @close="closeHistory" @page-change="changeHistoryPage" @retry="history.retry" />
  </PageContainer>
</template>

<style scoped>
.resource-summary { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); padding: 0 4px 24px; margin-bottom: 18px; border-bottom: 1px solid var(--admin-border); }
.resource-stat { min-width: 0; padding: 0 24px; border-right: 1px solid var(--admin-border); }
.resource-stat:first-child { padding-left: 0; }
.resource-stat:last-child { border-right: 0; }
.resource-stat__label { display: inline-flex; align-items: center; gap: 6px; color: var(--admin-text-muted); font-size: var(--admin-font-xs); }
.resource-stat strong { display: block; margin-top: 6px; color: var(--admin-text); font-size: 24px; font-weight: 600; font-variant-numeric: tabular-nums; }
.resource-stat small { margin-left: 8px; color: var(--admin-text-muted); font-size: var(--admin-font-xs); font-weight: 400; white-space: nowrap; }
.resource-error { margin-bottom: 14px; }
.record-title { font-weight: 500; }
.deleted-tag { margin-left: 8px; }
.secondary-cell { margin: 2px 0 0; color: var(--admin-text-muted); font-size: var(--admin-font-xs); }
.mono-cell { display: inline-block; max-width: 100%; overflow: hidden; color: var(--admin-text-muted); font-family: var(--admin-font-mono); font-size: var(--admin-font-xs); text-overflow: ellipsis; vertical-align: bottom; }
.numeric-cell, .date-cell { font-variant-numeric: tabular-nums; white-space: nowrap; }
.date-cell { color: var(--admin-text-muted); }
@media (max-width: 900px) {
  .resource-summary { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 20px 0; }
  .resource-stat:nth-child(odd) { padding-left: 0; }
  .resource-stat:nth-child(even) { border-right: 0; }
  .resource-stat small { display: block; margin-left: 0; }
}
</style>
