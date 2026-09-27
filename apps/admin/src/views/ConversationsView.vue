<script setup lang="ts">
import type { AdminConversationListItem } from '@agent/contracts'
import type { TableColumnsType } from 'ant-design-vue'
import { Tooltip } from 'ant-design-vue'
import { computed, onBeforeUnmount, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'

import DataTable from '@/components/common/DataTable.vue'
import PageContainer from '@/components/common/PageContainer.vue'
import PageHeader from '@/components/common/PageHeader.vue'
import { fetchAdminConversations } from '@/features/conversations/conversation-api'
import { formatShortDateTime } from '@/features/runs/run.utils'
import { createPagedListState } from '@/features/shared/paged-list.state'

const { locale, t } = useI18n()

const listState = createPagedListState<AdminConversationListItem>(
  (page, pageSize, signal) => fetchAdminConversations({ page, pageSize }, { signal }),
)

const columns = computed<TableColumnsType<AdminConversationListItem>>(() => [
  { title: t('conversations.columns.title'), dataIndex: 'title', key: 'title', ellipsis: true },
  { title: t('conversations.columns.id'), dataIndex: 'id', key: 'id', width: 230 },
  { title: t('conversations.columns.messages'), dataIndex: 'messageCount', key: 'messages', width: 80, align: 'right' },
  { title: t('conversations.columns.runs'), dataIndex: 'runCount', key: 'runs', width: 80, align: 'right' },
  { title: t('conversations.columns.updatedAt'), dataIndex: 'updatedAt', key: 'updatedAt', width: 140 },
  { title: t('conversations.columns.createdAt'), dataIndex: 'createdAt', key: 'createdAt', width: 140 },
])

onMounted(() => void listState.load())
onBeforeUnmount(listState.cancel)

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
      :scroll-x="860"
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
      <template #bodyCell="{ column, record }">
        <template v-if="column.key === 'title'">
          <Tooltip :title="record.title">
            <span class="conversation-title">{{ record.title }}</span>
          </Tooltip>
        </template>
        <template v-else-if="column.key === 'id'">
          <span class="mono-cell">{{ record.id }}</span>
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
