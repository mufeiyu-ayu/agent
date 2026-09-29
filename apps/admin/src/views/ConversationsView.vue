<script setup lang="ts">
import type { AdminConversationListItem, AdminUser } from '@agent/contracts'
import type { TableColumnsType } from 'ant-design-vue'
import type { LocationQueryRaw } from 'vue-router'
import { userDisplayName } from '@agent/contracts'
import { RangePicker, Select, Tooltip } from 'ant-design-vue'
import { computed, onBeforeUnmount, onMounted, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'

import DataTable from '@/components/common/DataTable.vue'
import PageContainer from '@/components/common/PageContainer.vue'
import PageHeader from '@/components/common/PageHeader.vue'
import UserIdentity from '@/components/common/UserIdentity.vue'
import { fetchAdminConversations } from '@/features/conversations/conversation-api'
import { isCalendarDate } from '@/features/runs/run-api'
import { formatShortDateTime } from '@/features/runs/run.utils'
import { createPagedListState } from '@/features/shared/paged-list.state'
import { fetchAdminUsers } from '@/features/users/users-api'

const route = useRoute()
const router = useRouter()
const { locale, t } = useI18n()

// 筛选条件只存在地址栏：刷新、后退、复制链接都按 URL 还原。
// 时间范围起止都合法才生效，手改出的半截或非法日期当作没选，与日期框显示一致。
const filters = computed(() => {
  const dateFrom = queryString(route.query.dateFrom)
  const dateTo = queryString(route.query.dateTo)
  const validRange = isCalendarDate(dateFrom) && isCalendarDate(dateTo)

  return {
    userId: queryString(route.query.userId),
    dateFrom: validRange ? dateFrom : '',
    dateTo: validRange ? dateTo : '',
  }
})
const dateRange = computed(() => (
  filters.value.dateFrom
    ? [filters.value.dateFrom, filters.value.dateTo] as [string, string]
    : undefined
))

const listState = createPagedListState<AdminConversationListItem>(
  (page, pageSize, signal) => fetchAdminConversations({ ...filters.value, page, pageSize }, { signal }),
)

const users = shallowRef<AdminUser[]>([])
const userOptions = computed(() => users.value.map(user => ({
  value: user.id,
  label: `${userDisplayName(user)} · ${user.email}`,
})))

const columns = computed<TableColumnsType<AdminConversationListItem>>(() => [
  // 按比例分宽：宽屏多出的空间各列一起分，不再全部堆给标题；窄屏由 scroll-x 兜底横向滚动。
  // 合计 97%，给 DataTable 追加的 36px 箭头列留出余量；会话 ID 在最窄的 1100px 下也能完整显示。
  { title: t('conversations.columns.title'), dataIndex: 'title', key: 'title', width: '26%', ellipsis: true },
  { title: t('conversations.columns.user'), key: 'user', width: '19%' },
  { title: t('conversations.columns.id'), dataIndex: 'id', key: 'id', width: '20%' },
  { title: t('conversations.columns.messages'), dataIndex: 'messageCount', key: 'messages', width: '7%', align: 'right' },
  { title: t('conversations.columns.runs'), dataIndex: 'runCount', key: 'runs', width: '7%', align: 'right' },
  { title: t('conversations.columns.updatedAt'), dataIndex: 'updatedAt', key: 'updatedAt', width: '9%', align: 'right' },
  { title: t('conversations.columns.createdAt'), dataIndex: 'createdAt', key: 'createdAt', width: '9%', align: 'right' },
])

onMounted(() => {
  void listState.load()
  // 用户下拉只是选项来源，加载失败不挡列表；URL 里的 userId 仍然生效。
  fetchAdminUsers().then((result) => {
    users.value = result
  }, () => {})
})
onBeforeUnmount(listState.cancel)

// 同一路径下只有 query 变化时实例不重建；离场过渡期间路由已换，不再发请求。
watch(() => Object.values(filters.value).join('|'), () => {
  if (route.name === 'conversations')
    void listState.setPage(1)
})

function updateFilters(patch: Partial<typeof filters.value>) {
  const next = { ...filters.value, ...patch }
  const query: LocationQueryRaw = {}

  for (const [key, value] of Object.entries(next)) {
    if (value)
      query[key] = value
  }

  void router.push({ query })
}

function handleDateRangeChange(value: [string, string] | null | undefined) {
  updateFilters({ dateFrom: value?.[0] ?? '', dateTo: value?.[1] ?? '' })
}

function filterUserOption(input: string, option?: { label?: string }) {
  return option?.label?.toLowerCase().includes(input.trim().toLowerCase()) ?? false
}

function queryString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function getDetailLocation(record: AdminConversationListItem) {
  return {
    name: 'conversation-detail',
    params: { conversationId: record.id },
  }
}

function handlePageChange(page: number, pageSize: number) {
  if (pageSize !== listState.pageSize.value) {
    void listState.setPageSize(pageSize)
    return
  }

  void listState.setPage(page)
}
</script>

<template>
  <PageContainer wide>
    <PageHeader :title="t('conversations.title')" :description="t('conversations.description')" />

    <DataTable
      :columns="columns"
      :data-source="listState.items.value"
      row-key="id"
      :loading="listState.loading.value"
      :error="listState.error.value"
      :error-title="t('conversations.loadFailed')"
      :empty-text="t('conversations.empty')"
      :scroll-x="1_100"
      :pagination="{
        current: listState.currentPage.value,
        pageSize: listState.pageSize.value,
        total: listState.pagination.value.totalItems,
      }"
      :summary="t('conversations.showing', {
        count: listState.items.value.length,
        total: listState.pagination.value.totalItems,
      })"
      :row-to="getDetailLocation"
      @page-change="handlePageChange"
      @retry="listState.retry"
    >
      <template #toolbar>
        <div class="conversation-filters">
          <Select
            class="conversation-filters__user"
            show-search
            allow-clear
            :value="filters.userId || undefined"
            :options="userOptions"
            :filter-option="filterUserOption"
            :aria-label="t('conversations.filters.user')"
            :placeholder="t('conversations.filters.userPlaceholder')"
            @change="value => updateFilters({ userId: typeof value === 'string' ? value : '' })"
          />
          <RangePicker
            class="conversation-filters__range"
            value-format="YYYY-MM-DD"
            :value="dateRange"
            :aria-label="t('conversations.filters.dateRange')"
            :placeholder="[t('runs.filters.from'), t('runs.filters.to')]"
            @change="value => handleDateRangeChange(value as [string, string] | null)"
          />
        </div>
      </template>

      <template #bodyCell="{ column, record }">
        <template v-if="column.key === 'title'">
          <Tooltip :title="record.title">
            <span class="conversation-title">{{ record.title }}</span>
          </Tooltip>
        </template>
        <template v-else-if="column.key === 'user'">
          <UserIdentity v-if="record.user" :user="record.user" :size="28" />
          <span v-else class="muted-cell">{{ t('conversations.unowned') }}</span>
        </template>
        <template v-else-if="column.key === 'id'">
          <span class="mono-cell" :title="record.id">{{ record.id }}</span>
        </template>
        <template v-else-if="column.key === 'messages' || column.key === 'runs'">
          <span class="numeric-cell">{{ column.key === 'messages' ? record.messageCount : record.runCount }}</span>
        </template>
        <template v-else-if="column.key === 'updatedAt'">
          <span class="date-cell">{{ formatShortDateTime(record.updatedAt, locale) }}</span>
        </template>
        <template v-else-if="column.key === 'createdAt'">
          <span class="date-cell">{{ formatShortDateTime(record.createdAt, locale) }}</span>
        </template>
      </template>
    </DataTable>
  </PageContainer>
</template>

<style scoped>
.conversation-filters {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  width: 100%;
}

.conversation-filters__user {
  width: 300px;
}

.conversation-filters__range {
  width: 250px;
}

.muted-cell {
  color: var(--admin-text-subtle);
}

.conversation-title {
  font-weight: 500;
}

.mono-cell {
  color: var(--admin-text-muted);
  font-family: var(--admin-font-mono);
  font-size: var(--admin-font-xs);
}

.numeric-cell,
.date-cell {
  color: var(--admin-text-muted);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
</style>
