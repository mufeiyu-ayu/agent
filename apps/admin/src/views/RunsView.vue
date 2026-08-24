<script setup lang="ts">
import type { TableColumnsType } from 'ant-design-vue'
import type { RunListItem, RunStatus } from '@/features/runs/run.model'
import {
  BarsOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  CloseCircleOutlined,
  EyeOutlined,
  RedoOutlined,
  SearchOutlined,
} from '@ant-design/icons-vue'
import {
  Alert,
  Button,
  Card,
  Empty,
  Form,
  FormItem,
  Input,
  Pagination,
  RangePicker,
  Select,
  Skeleton,
  Table,
  Tooltip,
} from 'ant-design-vue'
import { computed, onBeforeUnmount, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'

import PageContainer from '@/components/common/PageContainer.vue'
import RunStatusTag from '@/features/runs/components/RunStatusTag.vue'
import { useRunListStore } from '@/features/runs/run-list.store'
import {
  formatDuration,
  formatRequestedModel,
  formatShortDateTime,
  formatTokens,
} from '@/features/runs/run.utils'

const router = useRouter()
const runListStore = useRunListStore()
const { locale, t } = useI18n()

const columns = computed<TableColumnsType<RunListItem>>(() => [
  { title: t('runs.columns.runId'), dataIndex: 'id', key: 'id', width: 176, fixed: 'left' },
  { title: t('runs.columns.question'), dataIndex: 'questionPreview', key: 'question', width: 220 },
  { title: t('runs.columns.conversation'), dataIndex: 'conversationId', key: 'conversation', width: 150 },
  { title: t('runs.columns.status'), dataIndex: 'status', key: 'status', width: 92 },
  { title: t('runs.columns.model'), dataIndex: 'requestedModel', key: 'requestedModel', width: 132 },
  { title: t('runs.columns.tools'), dataIndex: 'toolCallCount', key: 'tools', width: 62, align: 'center' },
  { title: t('runs.columns.samples'), dataIndex: 'samplingCount', key: 'samplings', width: 72, align: 'center' },
  { title: t('runs.columns.tokens'), dataIndex: 'totalTokens', key: 'tokens', width: 78, align: 'right' },
  { title: t('runs.columns.duration'), dataIndex: 'durationMs', key: 'duration', width: 78, align: 'right' },
  { title: t('runs.columns.createdAt'), dataIndex: 'createdAt', key: 'createdAt', width: 126 },
  { title: '', key: 'action', width: 54, fixed: 'right', align: 'center' },
])

const statusOptions: Array<{ label: string, value: RunStatus }> = [
  { label: 'RUNNING', value: 'RUNNING' },
  { label: 'COMPLETED', value: 'COMPLETED' },
  { label: 'FAILED', value: 'FAILED' },
  { label: 'ABORTED', value: 'ABORTED' },
]

onMounted(() => void runListStore.load())
onBeforeUnmount(runListStore.cancel)

function getRunDetailLocation(runId: string) {
  return {
    name: 'run-detail',
    params: { runId },
  }
}

function handlePageChange(page: number, pageSize: number) {
  if (pageSize !== runListStore.pageSize) {
    void runListStore.setPageSize(pageSize)
    return
  }

  void runListStore.setPage(page)
}
</script>

<template>
  <PageContainer wide class="runs-page">
    <h1 class="sr-only">
      {{ t('runs.title') }}
    </h1>

    <section class="summary-grid" :aria-label="t('runs.summaryLabel')">
      <Card class="summary-card" :bordered="false">
        <span class="summary-card__icon is-blue"><BarsOutlined /></span>
        <div>
          <small>{{ t('runs.summary.total') }}</small>
          <strong>{{ runListStore.summary.totalRuns }}</strong>
          <p>{{ t('runs.summary.totalHint') }}</p>
        </div>
      </Card>
      <Card class="summary-card" :bordered="false">
        <span class="summary-card__icon is-green"><CheckCircleOutlined /></span>
        <div>
          <small>{{ t('runs.summary.completed') }}</small>
          <strong>{{ runListStore.summary.statusCounts.COMPLETED }}</strong>
          <p>{{ t('runs.summary.completedHint') }}</p>
        </div>
      </Card>
      <Card class="summary-card" :bordered="false">
        <span class="summary-card__icon is-amber"><ClockCircleOutlined /></span>
        <div>
          <small>{{ t('runs.summary.running') }}</small>
          <strong>{{ runListStore.summary.statusCounts.RUNNING }}</strong>
          <p>{{ t('runs.summary.runningHint') }}</p>
        </div>
      </Card>
      <Card class="summary-card" :bordered="false">
        <span class="summary-card__icon is-red"><CloseCircleOutlined /></span>
        <div>
          <small>{{ t('runs.summary.failed') }}</small>
          <strong>
            {{ runListStore.summary.statusCounts.FAILED + runListStore.summary.statusCounts.ABORTED }}
          </strong>
          <p>
            {{ t('runs.summary.failedHint', {
              failed: runListStore.summary.statusCounts.FAILED,
              aborted: runListStore.summary.statusCounts.ABORTED,
            }) }}
          </p>
        </div>
      </Card>
    </section>

    <Card class="filter-card" :bordered="false">
      <Form class="run-filters" layout="vertical" @submit.prevent="runListStore.applyFilters">
        <FormItem :label="t('runs.filters.query')">
          <Input
            v-model:value="runListStore.draftFilters.query"
            allow-clear
            :placeholder="t('runs.filters.queryPlaceholder')"
          />
        </FormItem>
        <FormItem :label="t('runs.filters.status')">
          <Select
            v-model:value="runListStore.draftFilters.status"
            allow-clear
            :options="statusOptions"
            :placeholder="t('runs.filters.allStatuses')"
          />
        </FormItem>
        <FormItem :label="t('runs.filters.dateRange')">
          <RangePicker
            v-model:value="runListStore.dateRange"
            class="run-filters__range"
            value-format="YYYY-MM-DD"
            :placeholder="[t('runs.filters.from'), t('runs.filters.to')]"
          />
        </FormItem>
        <div class="run-filters__actions">
          <Button type="primary" html-type="submit">
            <template #icon>
              <SearchOutlined />
            </template>
            {{ t('common.actions.search') }}
          </Button>
          <Button html-type="button" @click="runListStore.resetFilters">
            <template #icon>
              <RedoOutlined />
            </template>
            {{ t('common.actions.reset') }}
          </Button>
        </div>
      </Form>
    </Card>

    <Card class="table-card" :bordered="false">
      <Alert
        v-if="runListStore.error"
        class="table-error"
        type="error"
        show-icon
        :message="t('runs.loadFailed')"
        :description="runListStore.error"
      >
        <template #action>
          <Button
            size="small"
            :loading="runListStore.loading"
            @click="runListStore.retry"
          >
            {{ t('common.actions.retry') }}
          </Button>
        </template>
      </Alert>

      <Skeleton
        v-else-if="runListStore.loading && !runListStore.items.length"
        active
        class="table-skeleton"
        :paragraph="{ rows: 6 }"
      />

      <Table
        v-else
        class="runs-table"
        :columns="columns"
        :data-source="runListStore.items"
        :loading="runListStore.loading"
        :pagination="false"
        row-key="id"
        size="small"
        :scroll="{ x: 1_240 }"
      >
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'id'">
            <Tooltip :title="record.id">
              <RouterLink class="run-id" :to="getRunDetailLocation(record.id)">
                {{ record.id }}
              </RouterLink>
            </Tooltip>
          </template>
          <template v-else-if="column.key === 'question'">
            <Tooltip :title="record.questionPreview">
              <span class="question-preview">{{ record.questionPreview }}</span>
            </Tooltip>
          </template>
          <template v-else-if="column.key === 'conversation'">
            <Tooltip :title="record.conversationId">
              <RouterLink
                class="run-id"
                :to="{ name: 'conversation-detail', params: { conversationId: record.conversationId } }"
              >
                {{ record.conversationId }}
              </RouterLink>
            </Tooltip>
          </template>
          <template v-else-if="column.key === 'status'">
            <RunStatusTag :status="record.status" />
          </template>
          <template v-else-if="column.key === 'requestedModel'">
            <Tooltip :title="record.requestedModel ?? t('runs.defaultModelHint')">
              <span class="requested-model" :class="{ 'is-default': record.requestedModel === null }">
                {{ formatRequestedModel(record.requestedModel, t('runs.defaultModel')) }}
              </span>
            </Tooltip>
          </template>
          <template v-else-if="column.key === 'tokens'">
            <span class="numeric-cell">{{ formatTokens(record.totalTokens, locale) }}</span>
          </template>
          <template v-else-if="column.key === 'duration'">
            <span class="numeric-cell">{{ formatDuration(record.durationMs) }}</span>
          </template>
          <template v-else-if="column.key === 'createdAt'">
            <span class="date-cell">{{ formatShortDateTime(record.createdAt, locale) }}</span>
          </template>
          <template v-else-if="column.key === 'action'">
            <Tooltip :title="t('runs.inspect')">
              <Button
                type="text"
                shape="circle"
                size="small"
                :aria-label="t('runs.inspectAria', { id: record.id })"
                @click="router.push(getRunDetailLocation(record.id))"
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
            v-if="!runListStore.loading && !runListStore.error"
            :description="t('runs.empty')"
          />
        </template>
      </Table>

      <footer v-if="!runListStore.error" class="table-card__footer">
        <span>
          {{ t('runs.showing', {
            count: runListStore.items.length,
            total: runListStore.pagination.totalItems,
          }) }}
        </span>
        <Pagination
          :current="runListStore.currentPage"
          :page-size="runListStore.pageSize"
          :total="runListStore.pagination.totalItems"
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
/* 卡片按内容自适应高度，不再撑满视口；数据少时下方露出页面底色 */
.runs-page {
  display: flex;
  flex-direction: column;
}

.summary-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 14px;
}

.summary-card,
.filter-card,
.table-card {
  border: 1px solid var(--admin-border);
  border-radius: var(--admin-radius-md);
  background: var(--admin-surface);
  box-shadow: var(--admin-shadow-sm);
}

.summary-card :deep(.ant-card-body) {
  display: flex;
  min-height: 100px;
  align-items: center;
  gap: 14px;
  padding: 18px;
}

.summary-card__icon {
  display: grid;
  width: 40px;
  height: 40px;
  flex: 0 0 40px;
  place-items: center;
  border-radius: var(--admin-radius-md);
  font-size: var(--admin-font-lg);
}

.summary-card__icon.is-blue {
  color: var(--admin-primary);
  background: var(--admin-primary-soft);
}

.summary-card__icon.is-green {
  color: var(--admin-success-strong);
  background: var(--admin-success-soft);
}

.summary-card__icon.is-amber {
  color: var(--admin-warning-strong);
  background: var(--admin-warning-soft);
}

.summary-card__icon.is-red {
  color: var(--admin-danger-strong);
  background: var(--admin-danger-soft);
}

.summary-card small,
.summary-card strong,
.summary-card p {
  display: block;
}

.summary-card small {
  color: var(--admin-text-muted);
  font-size: var(--admin-font-xs);
  font-weight: 600;
}

.summary-card strong {
  margin-top: 4px;
  color: var(--admin-text);
  font-size: var(--admin-font-2xl);
  font-weight: 650;
  letter-spacing: -0.025em;
  line-height: 1.15;
}

.summary-card p {
  margin: 3px 0 0;
  color: var(--admin-text-subtle);
  font-size: var(--admin-font-2xs);
}

.filter-card,
.table-card {
  margin-top: 14px;
}

.filter-card :deep(.ant-card-body) {
  padding: 16px 18px 14px;
}

.run-filters {
  display: grid;
  grid-template-columns:
    minmax(210px, 1.25fr)
    minmax(120px, 0.72fr)
    minmax(230px, 1.2fr)
    auto;
  align-items: end;
  gap: 14px;
}

.run-filters :deep(.ant-form-item) {
  margin-bottom: 0;
}

.run-filters :deep(.ant-form-item-label) {
  padding-bottom: 5px;
}

.run-filters :deep(.ant-form-item-label > label) {
  height: auto;
  color: var(--admin-text-muted);
  font-size: var(--admin-font-xs);
  font-weight: 600;
}

.run-filters__range {
  width: 100%;
}

.run-filters__actions {
  display: flex;
  gap: 8px;
}

.table-card {
  display: flex;
  flex-direction: column;
}

.table-card :deep(> .ant-card-body) {
  display: flex;
  min-width: 0;
  min-height: 180px;
  flex-direction: column;
  padding: 0;
}

.table-error {
  margin: 12px 14px 0;
}

.table-skeleton {
  padding: 22px 18px;
}

.runs-table :deep(.ant-table) {
  border-radius: var(--admin-radius-md) var(--admin-radius-md) 0 0;
}

.runs-table :deep(.ant-table-thead > tr > th) {
  height: 44px;
  border-bottom: 1px solid var(--admin-border);
  color: var(--admin-text-muted);
  font-size: var(--admin-font-xs);
  font-weight: 600;
  letter-spacing: 0.01em;
  white-space: nowrap;
}

.runs-table :deep(.ant-table-tbody > tr > td) {
  height: 50px;
  color: var(--admin-text-muted);
  font-size: var(--admin-font-sm);
}

.run-id {
  display: block;
  overflow: hidden;
  color: var(--admin-primary);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: var(--admin-font-xs);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.question-preview {
  display: block;
  overflow: hidden;
  color: var(--admin-text);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.requested-model {
  display: block;
  overflow: hidden;
  color: var(--admin-text-muted);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.requested-model.is-default {
  color: var(--admin-text-subtle);
  font-style: italic;
}

.numeric-cell,
.date-cell {
  color: var(--admin-text-muted);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.table-card__footer {
  display: flex;
  min-height: 52px;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-top: auto;
  padding: 10px 16px;
  border-top: 1px solid var(--admin-border);
}

.table-card__footer > span {
  color: var(--admin-text-subtle);
  font-size: var(--admin-font-xs);
}

@media (max-width: 1240px) {
  .summary-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .run-filters {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .run-filters__actions {
    justify-content: flex-end;
  }
}
</style>
