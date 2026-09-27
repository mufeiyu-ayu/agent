<script setup lang="ts">
import type { AgentRunErrorCode } from '@agent/contracts'
import type { TableColumnsType } from 'ant-design-vue'
import type { RunListItem, RunStatus } from '@/features/runs/run.model'
import { AGENT_RUN_ERROR_CODES } from '@agent/contracts'
import { RedoOutlined, SearchOutlined } from '@ant-design/icons-vue'
import {
  Button,
  Input,
  RangePicker,
  Select,
  Tag,
  Tooltip,
} from 'ant-design-vue'
import { computed, onBeforeUnmount, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'

import DataTable from '@/components/common/DataTable.vue'
import PageContainer from '@/components/common/PageContainer.vue'
import PageHeader from '@/components/common/PageHeader.vue'
import RunStatusTag from '@/features/runs/components/RunStatusTag.vue'
import { useRunListStore } from '@/features/runs/run-list.store'
import {
  formatDuration,
  formatShortDateTime,
  formatTokens,
  readRunFailureDrilldown,
} from '@/features/runs/run.utils'

const route = useRoute()
const router = useRouter()
const runListStore = useRunListStore()
const { locale, t } = useI18n()

const columns = computed<TableColumnsType<RunListItem>>(() => [
  { title: t('runs.columns.question'), dataIndex: 'questionPreview', key: 'question', width: 280, fixed: 'left' },
  { title: t('runs.columns.status'), dataIndex: 'status', key: 'status', width: 100 },
  { title: t('runs.columns.failure'), key: 'failure', width: 140 },
  { title: t('runs.columns.model'), key: 'model', width: 170 },
  { title: t('runs.columns.tools'), dataIndex: 'toolCallCount', key: 'tools', width: 70, align: 'right' },
  { title: t('runs.columns.samples'), dataIndex: 'samplingCount', key: 'samplings', width: 70, align: 'right' },
  { title: t('runs.columns.tokens'), dataIndex: ['usage', 'totalTokens'], key: 'tokens', width: 90, align: 'right' },
  { title: t('runs.columns.duration'), dataIndex: 'durationMs', key: 'duration', width: 90, align: 'right' },
  { title: t('runs.columns.createdAt'), dataIndex: 'createdAt', key: 'createdAt', width: 130 },
  { title: t('runs.columns.runId'), dataIndex: 'id', key: 'id', width: 220 },
  { title: t('runs.columns.conversation'), dataIndex: 'conversationId', key: 'conversation', width: 220 },
])

const statusOptions: Array<{ label: string, value: RunStatus }> = [
  { label: 'RUNNING', value: 'RUNNING' },
  { label: 'COMPLETED', value: 'COMPLETED' },
  { label: 'FAILED', value: 'FAILED' },
  { label: 'ABORTED', value: 'ABORTED' },
]

const errorCodeOptions = computed<Array<{ label: string, value: AgentRunErrorCode }>>(() => (
  AGENT_RUN_ERROR_CODES.map(code => ({ label: errorCodeLabel(code), value: code }))
))

function errorCodeLabel(code: AgentRunErrorCode): string {
  return t(`runTrace.errorCodes.${code}`)
}

onMounted(() => {
  // 概览的失败原因带着类别与窗口日期跳过来：应用后清掉 URL 上的参数，之后的筛选以页面为准。
  const drilldown = readRunFailureDrilldown(route.query)
  if (!drilldown) {
    void runListStore.load()
    return
  }
  void runListStore.applyFailureDrilldown(drilldown)
  void router.replace({ query: {} })
})
onBeforeUnmount(runListStore.cancel)

function getRunDetailLocation(record: RunListItem) {
  return {
    name: 'run-detail',
    params: { runId: record.id },
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
  <PageContainer wide>
    <PageHeader :title="t('runs.title')" :description="t('runs.description')" />

    <section class="run-summary" :aria-label="t('runs.summaryLabel')">
      <div class="run-summary__item">
        <span>{{ t('runs.summary.total') }}</span>
        <strong>{{ runListStore.summary.totalRuns }}</strong>
        <small>{{ t('runs.summary.totalHint') }}</small>
      </div>
      <div class="run-summary__item">
        <span>{{ t('runs.summary.completed') }}</span>
        <strong>{{ runListStore.summary.statusCounts.COMPLETED }}</strong>
        <small>{{ t('runs.summary.completedHint') }}</small>
      </div>
      <div class="run-summary__item">
        <span>{{ t('runs.summary.running') }}</span>
        <strong>{{ runListStore.summary.statusCounts.RUNNING }}</strong>
        <small>{{ t('runs.summary.runningHint') }}</small>
      </div>
      <div class="run-summary__item">
        <span>{{ t('runs.summary.failed') }}</span>
        <strong :class="{ 'is-danger': runListStore.summary.statusCounts.FAILED > 0 }">
          {{ runListStore.summary.statusCounts.FAILED + runListStore.summary.statusCounts.ABORTED }}
        </strong>
        <small>
          {{ t('runs.summary.failedHint', {
            failed: runListStore.summary.statusCounts.FAILED,
            aborted: runListStore.summary.statusCounts.ABORTED,
          }) }}
        </small>
      </div>
    </section>

    <DataTable
      :columns="columns"
      :data-source="runListStore.items"
      row-key="id"
      :loading="runListStore.loading"
      :error="runListStore.error"
      :error-title="t('runs.loadFailed')"
      :empty-text="t('runs.empty')"
      :scroll-x="1_620"
      :pagination="{
        current: runListStore.currentPage,
        pageSize: runListStore.pageSize,
        total: runListStore.pagination.totalItems,
      }"
      :summary="t('runs.showing', {
        count: runListStore.items.length,
        total: runListStore.pagination.totalItems,
      })"
      :row-to="getRunDetailLocation"
      @page-change="handlePageChange"
      @retry="runListStore.retry"
    >
      <template #toolbar>
        <form class="run-filters" @submit.prevent="runListStore.applyFilters">
          <Input
            v-model:value="runListStore.draftFilters.query"
            class="run-filters__query"
            allow-clear
            :aria-label="t('runs.filters.query')"
            :placeholder="t('runs.filters.queryPlaceholder')"
          >
            <template #prefix>
              <SearchOutlined class="run-filters__icon" />
            </template>
          </Input>
          <Select
            v-model:value="runListStore.draftFilters.status"
            class="run-filters__select"
            allow-clear
            :aria-label="t('runs.filters.status')"
            :options="statusOptions"
            :placeholder="t('runs.filters.allStatuses')"
          />
          <Select
            v-model:value="runListStore.draftFilters.errorCode"
            class="run-filters__select is-wide"
            allow-clear
            :aria-label="t('runs.filters.errorCode')"
            :options="errorCodeOptions"
            :placeholder="t('runs.filters.allErrorCodes')"
          />
          <RangePicker
            v-model:value="runListStore.dateRange"
            class="run-filters__range"
            value-format="YYYY-MM-DD"
            :aria-label="t('runs.filters.dateRange')"
            :placeholder="[t('runs.filters.from'), t('runs.filters.to')]"
          />
          <Button type="primary" html-type="submit">
            {{ t('common.actions.search') }}
          </Button>
          <Button html-type="button" @click="runListStore.resetFilters">
            <template #icon>
              <RedoOutlined />
            </template>
            {{ t('common.actions.reset') }}
          </Button>
        </form>
      </template>

      <template #bodyCell="{ column, record }">
        <template v-if="column.key === 'question'">
          <Tooltip :title="record.questionPreview">
            <span class="question-preview">{{ record.questionPreview }}</span>
          </Tooltip>
        </template>
        <template v-else-if="column.key === 'id'">
          <span class="mono-cell">{{ record.id }}</span>
        </template>
        <template v-else-if="column.key === 'conversation'">
          <RouterLink
            class="mono-cell is-link"
            :to="{ name: 'conversation-detail', params: { conversationId: record.conversationId } }"
          >
            {{ record.conversationId }}
          </RouterLink>
        </template>
        <template v-else-if="column.key === 'model'">
          <Tooltip v-if="record.model" :title="record.model.wireName">
            <span class="model-name">
              <span class="model-name__text">{{ record.model.displayName }}</span>
              <Tag v-if="record.model.deleted" class="model-name__tag">{{ t('runs.modelDeleted') }}</Tag>
            </span>
          </Tooltip>
          <span v-else class="muted-cell">{{ t('runTrace.inspector.unavailable') }}</span>
        </template>
        <template v-else-if="column.key === 'status'">
          <RunStatusTag :status="record.status" />
        </template>
        <template v-else-if="column.key === 'failure'">
          <template v-if="record.status === 'FAILED' || record.status === 'ABORTED'">
            <Tooltip :title="record.failureMessage ?? undefined">
              <span v-if="record.errorCode" class="failure-cell">{{ errorCodeLabel(record.errorCode) }}</span>
              <span v-else class="muted-cell">{{ t('runTrace.inspector.unavailable') }}</span>
            </Tooltip>
          </template>
          <span v-else class="muted-cell">—</span>
        </template>
        <template v-else-if="column.key === 'tools' || column.key === 'samplings'">
          <span class="numeric-cell">{{ column.key === 'tools' ? record.toolCallCount : record.samplingCount }}</span>
        </template>
        <template v-else-if="column.key === 'tokens'">
          <span class="numeric-cell">{{ formatTokens(record.usage.totalTokens, locale) }}</span>
        </template>
        <template v-else-if="column.key === 'duration'">
          <span class="numeric-cell">{{ formatDuration(record.durationMs) }}</span>
        </template>
        <template v-else-if="column.key === 'createdAt'">
          <span class="numeric-cell">{{ formatShortDateTime(record.createdAt, locale) }}</span>
        </template>
      </template>
    </DataTable>
  </PageContainer>
</template>

<style scoped>
/* 摘要：与概览同一种细线分隔的指标条 */
.run-summary {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  margin-bottom: 18px;
  padding: 14px 0;
  border-block: 0.5px solid var(--admin-border-strong);
}

.run-summary__item {
  display: grid;
  gap: 2px;
  min-width: 0;
  padding: 0 16px;
  box-shadow: inset 0.5px 0 0 var(--admin-border-strong);
}

.run-summary__item:first-child {
  padding-left: 4px;
  box-shadow: none;
}

.run-summary__item span {
  color: var(--admin-text-muted);
  font-size: var(--admin-font-xs);
  font-weight: 500;
}

.run-summary__item strong {
  color: var(--admin-text);
  font-size: 24px;
  font-weight: 600;
  letter-spacing: -0.02em;
  line-height: 1.2;
  font-variant-numeric: tabular-nums;
}

.run-summary__item strong.is-danger {
  color: var(--admin-danger);
}

.run-summary__item small {
  overflow: hidden;
  color: var(--admin-text-muted);
  font-size: 11.5px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.run-filters {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  width: 100%;
}

.run-filters__query {
  width: 260px;
}

.run-filters__icon {
  color: var(--admin-text-subtle);
}

.run-filters__select {
  width: 130px;
}

.run-filters__select.is-wide {
  width: 170px;
}

.run-filters__range {
  width: 250px;
}

.question-preview {
  display: block;
  overflow: hidden;
  font-weight: 500;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mono-cell {
  display: block;
  overflow: hidden;
  color: var(--admin-text-muted);
  font-family: var(--admin-font-mono);
  font-size: var(--admin-font-xs);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mono-cell.is-link:hover {
  color: var(--admin-primary);
  text-decoration: underline;
}

.model-name {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 6px;
}

.model-name__text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.model-name__tag {
  flex: none;
  margin: 0;
  font-size: 10px;
  line-height: 16px;
}

.failure-cell {
  color: var(--admin-danger);
  font-weight: 500;
}

.muted-cell {
  color: var(--admin-text-subtle);
}

.numeric-cell {
  color: var(--admin-text-muted);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
</style>
