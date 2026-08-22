<script setup lang="ts">
import type { AdminConversationListItem } from '@agent/contracts'
import type { TableColumnsType } from 'ant-design-vue'
import { EyeOutlined } from '@ant-design/icons-vue'
import {
  Alert,
  Button,
  Card,
  Empty,
  Pagination,
  Skeleton,
  Table,
  Tooltip,
} from 'ant-design-vue'
import { computed, onBeforeUnmount, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'

import PageContainer from '@/components/common/PageContainer.vue'
import { fetchAdminConversations } from '@/features/conversations/conversation-api'
import { formatShortDateTime } from '@/features/runs/run.utils'
import { createPagedListState } from '@/features/shared/paged-list.state'

const router = useRouter()
const { locale, t } = useI18n()

const listState = createPagedListState<AdminConversationListItem>(
  (page, pageSize, signal) => fetchAdminConversations({ page, pageSize }, { signal }),
)

const columns = computed<TableColumnsType<AdminConversationListItem>>(() => [
  { title: t('conversations.columns.id'), dataIndex: 'id', key: 'id', width: 176, fixed: 'left' },
  { title: t('conversations.columns.title'), dataIndex: 'title', key: 'title', width: 260 },
  { title: t('conversations.columns.messages'), dataIndex: 'messageCount', key: 'messages', width: 76, align: 'center' },
  { title: t('conversations.columns.runs'), dataIndex: 'runCount', key: 'runs', width: 76, align: 'center' },
  { title: t('conversations.columns.updatedAt'), dataIndex: 'updatedAt', key: 'updatedAt', width: 126 },
  { title: t('conversations.columns.createdAt'), dataIndex: 'createdAt', key: 'createdAt', width: 126 },
  { title: '', key: 'action', width: 54, fixed: 'right', align: 'center' },
])

onMounted(() => void listState.load())
onBeforeUnmount(listState.cancel)

function getDetailLocation(conversationId: string) {
  return {
    name: 'conversation-detail',
    params: { conversationId },
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
  <PageContainer wide class="conversations-page">
    <h1 class="sr-only">
      {{ t('conversations.title') }}
    </h1>

    <Card class="table-card" :bordered="false">
      <Alert
        v-if="listState.error.value"
        class="table-error"
        type="error"
        show-icon
        :message="t('conversations.loadFailed')"
        :description="listState.error.value"
      >
        <template #action>
          <Button
            size="small"
            :loading="listState.loading.value"
            @click="listState.retry"
          >
            {{ t('common.actions.retry') }}
          </Button>
        </template>
      </Alert>

      <Skeleton
        v-else-if="listState.loading.value && !listState.items.value.length"
        active
        class="table-skeleton"
        :paragraph="{ rows: 6 }"
      />

      <Table
        v-else
        class="conversations-table"
        :columns="columns"
        :data-source="listState.items.value"
        :loading="listState.loading.value"
        :pagination="false"
        row-key="id"
        size="small"
        :scroll="{ x: 890 }"
      >
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'id'">
            <Tooltip :title="record.id">
              <RouterLink class="conversation-id" :to="getDetailLocation(record.id)">
                {{ record.id }}
              </RouterLink>
            </Tooltip>
          </template>
          <template v-else-if="column.key === 'title'">
            <Tooltip :title="record.title">
              <span class="conversation-title">{{ record.title }}</span>
            </Tooltip>
          </template>
          <template v-else-if="column.key === 'updatedAt'">
            <span class="date-cell">{{ formatShortDateTime(record.updatedAt, locale) }}</span>
          </template>
          <template v-else-if="column.key === 'createdAt'">
            <span class="date-cell">{{ formatShortDateTime(record.createdAt, locale) }}</span>
          </template>
          <template v-else-if="column.key === 'action'">
            <Tooltip :title="t('conversations.inspect')">
              <Button
                type="text"
                shape="circle"
                size="small"
                :aria-label="t('conversations.inspectAria', { id: record.id })"
                @click="router.push(getDetailLocation(record.id))"
              >
                <template #icon>
                  <EyeOutlined />
                </template>
              </Button>
            </Tooltip>
          </template>
        </template>

        <template #emptyText>
          <Empty
            v-if="!listState.loading.value && !listState.error.value"
            :description="t('conversations.empty')"
          />
        </template>
      </Table>

      <footer v-if="!listState.error.value" class="table-card__footer">
        <span>
          {{ t('conversations.showing', {
            count: listState.items.value.length,
            total: listState.pagination.value.totalItems,
          }) }}
        </span>
        <Pagination
          :current="listState.currentPage.value"
          :page-size="listState.pageSize.value"
          :total="listState.pagination.value.totalItems"
          :page-size-options="['8', '20', '50']"
          show-size-changer
          size="small"
          @change="handlePageChange"
        />
      </footer>
    </Card>
  </PageContainer>
</template>

<style scoped>
.conversations-page {
  display: flex;
  min-height: calc(100dvh - var(--admin-header-height) - var(--admin-tabs-height) - 40px);
  flex-direction: column;
}

.table-card {
  display: flex;
  flex: 1 0 auto;
  flex-direction: column;
  border: 1px solid var(--admin-border);
  background: var(--admin-surface);
  box-shadow: var(--admin-card-shadow);
}

.table-card :deep(> .ant-card-body) {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
  padding: 0;
}

.table-error {
  margin: 12px 14px 0;
}

.table-skeleton {
  padding: 22px 18px;
}

.conversations-table :deep(.ant-table) {
  border-radius: 8px 8px 0 0;
}

.conversations-table :deep(.ant-table-thead > tr > th) {
  height: 42px;
  color: var(--admin-text-muted);
  font-size: 10px;
  font-weight: 650;
  letter-spacing: 0.025em;
  white-space: nowrap;
}

.conversations-table :deep(.ant-table-tbody > tr > td) {
  height: 47px;
  color: var(--admin-text-muted);
  font-size: 11px;
}

.conversation-id {
  display: block;
  overflow: hidden;
  color: var(--admin-primary);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 10px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.conversation-title {
  display: block;
  overflow: hidden;
  color: var(--admin-text);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.date-cell {
  color: var(--admin-text-muted);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.table-card__footer {
  display: flex;
  min-height: 48px;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-top: auto;
  padding: 8px 14px;
  border-top: 1px solid var(--admin-border);
}

.table-card__footer > span {
  color: var(--admin-text-subtle);
  font-size: 10px;
}
</style>
