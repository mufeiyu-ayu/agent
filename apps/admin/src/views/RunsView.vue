<script setup lang="ts">
import type { TableColumnsType } from 'ant-design-vue'
import type { RunFilters, RunListItem, RunStatus } from '@/features/runs/run.model'
import {
  BarsOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  EyeOutlined,
  NumberOutlined,
  RedoOutlined,
  SearchOutlined,
} from '@ant-design/icons-vue'
import {
  Button,
  Card,
  Empty,
  Form,
  FormItem,
  Input,
  Pagination,
  RangePicker,
  Select,
  Table,
  Tooltip,
} from 'ant-design-vue'
import { computed, reactive, ref, watch } from 'vue'
import { useRouter } from 'vue-router'

import PageContainer from '@/components/common/PageContainer.vue'
import PageHeader from '@/components/common/PageHeader.vue'
import StatusBadge from '@/components/common/StatusBadge.vue'
import RunStatusTag from '@/features/runs/components/RunStatusTag.vue'
import { mockRunList, mockRunModels } from '@/features/runs/run.mocks'
import {
  computeRunSummary,
  defaultRunFilters,
  filterRuns,
  formatDuration,
  formatShortDateTime,
  formatTokens,
  paginateRuns,
} from '@/features/runs/run.utils'

const columns: TableColumnsType<RunListItem> = [
  { title: 'Run ID', dataIndex: 'id', key: 'id', width: 176, fixed: 'left' },
  { title: 'User question', dataIndex: 'questionPreview', key: 'question', width: 220 },
  { title: 'Status', dataIndex: 'status', key: 'status', width: 92 },
  { title: 'Model', dataIndex: 'model', key: 'model', width: 104 },
  { title: 'Tools', dataIndex: 'toolCallCount', key: 'tools', width: 62, align: 'center' },
  { title: 'Samples', dataIndex: 'samplingCount', key: 'samplings', width: 72, align: 'center' },
  { title: 'Tokens', dataIndex: 'totalTokens', key: 'tokens', width: 78, align: 'right' },
  { title: 'Duration', dataIndex: 'durationMs', key: 'duration', width: 78, align: 'right' },
  { title: 'Created At', dataIndex: 'createdAt', key: 'createdAt', width: 126 },
  { title: '', key: 'action', width: 54, fixed: 'right', align: 'center' },
]
const router = useRouter()

const statusOptions: Array<{ label: string, value: RunStatus }> = [
  { label: 'RUNNING', value: 'RUNNING' },
  { label: 'COMPLETED', value: 'COMPLETED' },
  { label: 'FAILED', value: 'FAILED' },
  { label: 'ABORTED', value: 'ABORTED' },
]

const draftFilters = reactive<RunFilters>({ ...defaultRunFilters })
const appliedFilters = ref<RunFilters>({ ...defaultRunFilters })
const dateRange = ref<[string, string] | undefined>()
const currentPage = ref(1)
const pageSize = ref(8)

const summary = computed(() => computeRunSummary(mockRunList))
const filteredRuns = computed(() => filterRuns(mockRunList, appliedFilters.value))
const pagedRuns = computed(() => paginateRuns(
  filteredRuns.value,
  currentPage.value,
  pageSize.value,
))

watch(pageSize, () => {
  currentPage.value = 1
})

watch(filteredRuns, (runs) => {
  const lastPage = Math.max(1, Math.ceil(runs.length / pageSize.value))
  currentPage.value = Math.min(currentPage.value, lastPage)
})

function applyFilters() {
  appliedFilters.value = {
    ...draftFilters,
    dateFrom: dateRange.value?.[0] ?? '',
    dateTo: dateRange.value?.[1] ?? '',
  }
  currentPage.value = 1
}

function resetFilters() {
  Object.assign(draftFilters, defaultRunFilters)
  dateRange.value = undefined
  appliedFilters.value = { ...defaultRunFilters }
  currentPage.value = 1
}
</script>

<template>
  <PageContainer wide class="runs-page">
    <PageHeader
      eyebrow="Observability"
      title="Agent Runs"
      description="浏览确定性 Demo Run，检查状态、Token 使用与 AgentStep 轨迹；数据来自本地类型化 Mock。"
    >
      <template #actions>
        <StatusBadge tone="info">
          Demo / Mock data
        </StatusBadge>
      </template>
    </PageHeader>

    <section class="summary-grid" aria-label="Run summary">
      <Card class="summary-card" :bordered="false">
        <span class="summary-card__icon is-blue"><BarsOutlined /></span>
        <div>
          <small>Total Runs</small>
          <strong>{{ summary.totalRuns }}</strong>
          <p>当前 Mock 集合</p>
        </div>
      </Card>
      <Card class="summary-card" :bordered="false">
        <span class="summary-card__icon is-green"><CheckCircleOutlined /></span>
        <div>
          <small>Success Rate</small>
          <strong>{{ summary.successRate }}%</strong>
          <p>COMPLETED / 全部 Run</p>
        </div>
      </Card>
      <Card class="summary-card" :bordered="false">
        <span class="summary-card__icon is-amber"><ClockCircleOutlined /></span>
        <div>
          <small>Avg Duration</small>
          <strong>{{ formatDuration(summary.avgDurationMs) }}</strong>
          <p>仅统计已结束 Run</p>
        </div>
      </Card>
      <Card class="summary-card" :bordered="false">
        <span class="summary-card__icon is-violet"><NumberOutlined /></span>
        <div>
          <small>Total Tokens</small>
          <strong>{{ formatTokens(summary.totalTokens) }}</strong>
          <p>仅汇总已知 usage</p>
        </div>
      </Card>
    </section>

    <Card class="filter-card" :bordered="false">
      <Form class="run-filters" layout="vertical" @submit.prevent="applyFilters">
        <FormItem label="Run ID / user question">
          <Input
            v-model:value="draftFilters.query"
            allow-clear
            placeholder="Search Demo Runs"
          />
        </FormItem>
        <FormItem label="Status">
          <Select
            v-model:value="draftFilters.status"
            allow-clear
            :options="statusOptions"
            placeholder="All statuses"
          />
        </FormItem>
        <FormItem label="Model">
          <Select
            v-model:value="draftFilters.model"
            allow-clear
            :options="mockRunModels.map(model => ({ label: model, value: model }))"
            placeholder="All models"
          />
        </FormItem>
        <FormItem label="Date Range">
          <RangePicker
            v-model:value="dateRange"
            class="run-filters__range"
            value-format="YYYY-MM-DD"
            :placeholder="['From', 'To']"
          />
        </FormItem>
        <div class="run-filters__actions">
          <Button type="primary" html-type="submit">
            <template #icon>
              <SearchOutlined />
            </template>
            Search
          </Button>
          <Button @click="resetFilters">
            <template #icon>
              <RedoOutlined />
            </template>
            Reset
          </Button>
        </div>
      </Form>
    </Card>

    <Card class="table-card" :bordered="false">
      <Table
        class="runs-table"
        :columns="columns"
        :data-source="pagedRuns"
        :pagination="false"
        row-key="id"
        size="small"
        :scroll="{ x: 1_062 }"
      >
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'id'">
            <Tooltip :title="record.id">
              <RouterLink class="run-id" :to="`/runs/${record.id}`">
                {{ record.id }}
              </RouterLink>
            </Tooltip>
          </template>
          <template v-else-if="column.key === 'question'">
            <Tooltip :title="record.questionPreview">
              <span class="question-preview">{{ record.questionPreview }}</span>
            </Tooltip>
          </template>
          <template v-else-if="column.key === 'status'">
            <RunStatusTag :status="record.status" />
          </template>
          <template v-else-if="column.key === 'tokens'">
            <span class="numeric-cell">{{ formatTokens(record.totalTokens) }}</span>
          </template>
          <template v-else-if="column.key === 'duration'">
            <span class="numeric-cell">{{ formatDuration(record.durationMs) }}</span>
          </template>
          <template v-else-if="column.key === 'createdAt'">
            <span class="date-cell">{{ formatShortDateTime(record.createdAt) }}</span>
          </template>
          <template v-else-if="column.key === 'action'">
            <Tooltip title="Inspect Run">
              <Button
                type="text"
                shape="circle"
                size="small"
                :aria-label="`查看 ${record.id}`"
                @click="router.push(`/runs/${record.id}`)"
              >
                <template #icon>
                  <EyeOutlined />
                </template>
              </Button>
            </Tooltip>
          </template>
        </template>

        <template #emptyText>
          <Empty description="没有匹配的 Demo Run，请调整筛选条件。" />
        </template>
      </Table>

      <footer class="table-card__footer">
        <span>
          Showing {{ pagedRuns.length }} of {{ filteredRuns.length }} Demo Runs
        </span>
        <Pagination
          v-model:current="currentPage"
          v-model:page-size="pageSize"
          :total="filteredRuns.length"
          :page-size-options="['5', '8']"
          show-size-changer
          size="small"
        />
      </footer>
    </Card>
  </PageContainer>
</template>

<style scoped>
.runs-page {
  display: flex;
  min-height: calc(100dvh - var(--admin-header-height) - var(--admin-tabs-height) - 40px);
  flex-direction: column;
}

.summary-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
}

.summary-card,
.filter-card,
.table-card {
  border: 1px solid var(--admin-border);
  background: var(--admin-surface);
  box-shadow: var(--admin-card-shadow);
}

.summary-card :deep(.ant-card-body) {
  display: flex;
  min-height: 96px;
  align-items: center;
  gap: 13px;
  padding: 16px;
}

.summary-card__icon {
  display: grid;
  width: 36px;
  height: 36px;
  flex: 0 0 36px;
  place-items: center;
  border-radius: 9px;
  font-size: 16px;
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
  color: #b76400;
  background: rgb(245 158 11 / 12%);
}

.summary-card__icon.is-violet {
  color: #7950c7;
  background: rgb(121 80 199 / 12%);
}

.summary-card small,
.summary-card strong,
.summary-card p {
  display: block;
}

.summary-card small {
  color: var(--admin-text-muted);
  font-size: 10px;
  font-weight: 600;
}

.summary-card strong {
  margin-top: 3px;
  color: var(--admin-text);
  font-size: 20px;
  font-weight: 680;
  letter-spacing: -0.025em;
}

.summary-card p {
  margin: 2px 0 0;
  color: var(--admin-text-subtle);
  font-size: 10px;
}

.filter-card,
.table-card {
  margin-top: 12px;
}

.filter-card :deep(.ant-card-body) {
  padding: 14px 16px 12px;
}

.run-filters {
  display: grid;
  grid-template-columns:
    minmax(180px, 1.25fr)
    minmax(120px, 0.72fr)
    minmax(130px, 0.78fr)
    minmax(230px, 1.2fr)
    auto;
  align-items: end;
  gap: 12px;
}

.run-filters :deep(.ant-form-item) {
  margin-bottom: 0;
}

.run-filters :deep(.ant-form-item-label) {
  padding-bottom: 4px;
}

.run-filters :deep(.ant-form-item-label > label) {
  height: auto;
  color: var(--admin-text-muted);
  font-size: 10px;
  font-weight: 600;
}

.run-filters__range {
  width: 100%;
}

.run-filters__actions {
  display: flex;
  gap: 7px;
}

.table-card {
  display: flex;
  flex: 1 0 auto;
  flex-direction: column;
}

.table-card :deep(> .ant-card-body) {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
  padding: 0;
}

.runs-table :deep(.ant-table) {
  border-radius: 8px 8px 0 0;
}

.runs-table :deep(.ant-table-thead > tr > th) {
  height: 42px;
  color: var(--admin-text-muted);
  font-size: 10px;
  font-weight: 650;
  letter-spacing: 0.025em;
  white-space: nowrap;
}

.runs-table :deep(.ant-table-tbody > tr > td) {
  height: 47px;
  color: var(--admin-text-muted);
  font-size: 11px;
}

.run-id {
  display: block;
  overflow: hidden;
  color: var(--admin-primary);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 10px;
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

.numeric-cell,
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

@media (max-width: 1240px) {
  .summary-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .run-filters {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }

  .run-filters__actions {
    grid-column: span 2;
    justify-content: flex-end;
  }
}
</style>
