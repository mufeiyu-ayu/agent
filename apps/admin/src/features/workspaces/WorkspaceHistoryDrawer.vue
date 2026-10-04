<script setup lang="ts">
import type { SandboxExecutionRecord, WorkspaceHistoryResponse, WorkspaceMonitorItem } from '@agent/contracts'
import type { TableColumnsType } from 'ant-design-vue'
import { Alert, Drawer, Tag, Tooltip } from 'ant-design-vue'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import DataTable from '@/components/common/DataTable.vue'
import UserIdentity from '@/components/common/UserIdentity.vue'
import { formatDateTime, formatShortDateTime } from '@/features/runs/run.utils'
import { formatWorkspaceDuration, workspaceStateColor } from './workspaces.utils'

const props = defineProps<{
  open: boolean
  workspace?: WorkspaceMonitorItem
  data?: WorkspaceHistoryResponse
  loading: boolean
  error: string
  notFound: boolean
  page: number
  pageSize: number
}>()
defineEmits<{ close: [], pageChange: [page: number, pageSize: number], retry: [] }>()
const { t, locale } = useI18n()
const columns = computed<TableColumnsType<SandboxExecutionRecord>>(() => [
  { title: t('workspaces.sandboxColumn'), key: 'sandbox', width: 240, ellipsis: true },
  { title: t('workspaces.state'), key: 'state', width: 130 },
  { title: t('workspaces.startedAt'), key: 'start', width: 150 },
  { title: t('workspaces.releasedAt'), key: 'end', width: 150 },
  { title: t('workspaces.durationColumn'), key: 'duration', width: 100, align: 'right' },
  { title: t('workspaces.actions'), key: 'actions', width: 110 },
])
const total = computed(() => props.data?.pagination.total ?? props.workspace?.sandboxCount ?? 0)
const date = (value: string | null) => value ? formatDateTime(value, locale.value) : '—'
const shortDate = (value: string | null) => value ? formatShortDateTime(value, locale.value) : '—'
</script>

<template>
  <Drawer :open="open" :title="workspace?.title ?? t('workspaces.history')" width="min(1040px, 100vw)" destroy-on-close @close="$emit('close')">
    <div v-if="workspace" class="workspace-history-summary">
      <UserIdentity v-if="workspace.user" :user="workspace.user" :size="28" />
      <Tag v-if="workspace.deleted">
        {{ t('workspaces.deleted') }}
      </Tag>
      <RouterLink v-else :to="`/conversations/${workspace.conversationId}`">
        {{ t('workspaces.openConversation') }}
      </RouterLink>
      <span>{{ t('workspaces.records', { count: workspace.sandboxCount }) }}</span>
      <span>{{ t('workspaces.totalDuration') }} {{ formatWorkspaceDuration(workspace.confirmedDurationMs) }}</span>
    </div>
    <Alert v-if="notFound" type="warning" :message="t('workspaces.notFound')" show-icon />
    <DataTable v-else :columns="columns" :data-source="data?.items ?? []" row-key="id" compact :loading="loading" :error="error" :scroll-x="900" :pagination="{ current: page, pageSize, total }" :summary="t('workspaces.total', { count: total })" :empty-text="t('workspaces.historyEmpty')" @page-change="(page, size) => $emit('pageChange', page, size)" @retry="$emit('retry')">
      <template #bodyCell="{ column, record }">
        <template v-if="column.key === 'sandbox'">
          <Tooltip :title="record.sandboxId ?? t('workspaces.noId')">
            <span class="mono-cell">{{ record.sandboxId ?? '—' }}</span>
          </Tooltip>
          <p class="secondary-cell" :title="record.apiHost">
            {{ record.template }}
          </p>
        </template>
        <template v-else-if="column.key === 'state'">
          <Tooltip :title="t('workspaces.recordHint', { time: date(record.expiresAt), checked: date(record.checkedAt) })">
            <Tag :color="workspaceStateColor(record.state)">
              {{ t(`workspaces.states.${record.state}`, record.state) }}
            </Tag>
          </Tooltip>
        </template>
        <Tooltip v-else-if="column.key === 'start'" :title="date(record.startedAt)">
          <span class="date-cell">{{ shortDate(record.startedAt) }}</span>
        </Tooltip>
        <Tooltip v-else-if="column.key === 'end'" :title="date(record.releasedAt)">
          <span class="date-cell">{{ shortDate(record.releasedAt) }}</span>
        </Tooltip>
        <span v-else-if="column.key === 'duration'" class="date-cell">{{ record.durationMs === null ? t('workspaces.unknown') : formatWorkspaceDuration(record.durationMs) }}</span>
        <template v-else-if="column.key === 'actions'">
          <RouterLink v-if="record.runAvailable" :to="`/runs/${record.runId}`">
            {{ t('workspaces.openRun') }}
          </RouterLink>
          <span v-else class="secondary-cell">{{ t('workspaces.runDeleted') }}</span>
        </template>
      </template>
    </DataTable>
  </Drawer>
</template>

<style scoped>
.workspace-history-summary { display: flex; flex-wrap: wrap; align-items: center; gap: 16px; margin-bottom: 20px; color: var(--admin-text-muted); font-size: var(--admin-font-sm); }
.mono-cell { display: inline-block; max-width: 100%; overflow: hidden; font-family: var(--admin-font-mono); font-size: var(--admin-font-xs); text-overflow: ellipsis; vertical-align: bottom; }
.secondary-cell { margin: 2px 0 0; color: var(--admin-text-muted); font-size: var(--admin-font-xs); }
.date-cell { font-variant-numeric: tabular-nums; white-space: nowrap; }
</style>
