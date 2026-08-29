<script setup lang="ts">
import type { QaGlossaryListItem } from '@agent/contracts'
import type { TableColumnsType } from 'ant-design-vue'
import { RightOutlined } from '@ant-design/icons-vue'
import {
  Alert,
  Button,
  Card,
  Empty,
  Skeleton,
  Table,
  Tag,
  Tooltip,
} from 'ant-design-vue'
import { computed, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'

import PageContainer from '@/components/common/PageContainer.vue'
import { fetchQaGlossaries } from '@/features/qa/qa-api'
import { createDetailFetchState } from '@/features/shared/detail-fetch.state'

const router = useRouter()
const { locale, t } = useI18n()

// 列表无 id 概念，复用 detail-fetch 的 abort / 竞态处理，getId 恒定即可
const fetchState = createDetailFetchState(
  () => 'glossaries',
  (_id, signal) => fetchQaGlossaries({ signal }),
)
const { error, loading, retry: load } = fetchState
const items = computed<QaGlossaryListItem[]>(() => fetchState.data.value?.items ?? [])

void load()
onBeforeUnmount(fetchState.cancel)

const columns = computed<TableColumnsType<QaGlossaryListItem>>(() => [
  { title: t('qaGlossaries.columns.name'), dataIndex: 'name', key: 'name', width: 240 },
  { title: t('qaGlossaries.columns.description'), dataIndex: 'description', key: 'description' },
  { title: t('qaGlossaries.columns.terms'), key: 'terms', width: 96, align: 'center' },
  { title: t('qaGlossaries.columns.languages'), key: 'languages', width: 88, align: 'center' },
  { title: t('qaGlossaries.columns.status'), key: 'status', width: 88, align: 'center' },
  { title: '', key: 'action', width: 54, align: 'center' },
])

function getTermsLocation(glossaryId: number) {
  return { name: 'qa-glossary-terms', params: { glossaryId } }
}
</script>

<template>
  <PageContainer wide class="qa-glossaries-page">
    <h1 class="sr-only">
      {{ t('qaGlossaries.title') }}
    </h1>

    <Card class="table-card" :bordered="false">
      <Alert
        v-if="error"
        class="table-error"
        type="error"
        show-icon
        :message="t('qaGlossaries.loadFailed')"
        :description="error"
      >
        <template #action>
          <Button size="small" :loading="loading" @click="load">
            {{ t('common.actions.retry') }}
          </Button>
        </template>
      </Alert>

      <Skeleton
        v-else-if="loading && !items.length"
        active
        class="table-skeleton"
        :paragraph="{ rows: 5 }"
      />

      <Table
        v-else
        class="qa-table"
        :columns="columns"
        :data-source="items"
        :loading="loading"
        :pagination="false"
        row-key="id"
        size="small"
        :scroll="{ x: 760 }"
        :custom-row="(record: QaGlossaryListItem) => ({
          onClick: () => router.push(getTermsLocation(record.id)),
          style: { cursor: 'pointer' },
        })"
      >
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'name'">
            <RouterLink class="glossary-name" :to="getTermsLocation(record.id)" @click.stop>
              {{ record.name }}
            </RouterLink>
          </template>
          <template v-else-if="column.key === 'description'">
            <Tooltip :title="record.description ?? ''">
              <span class="cell-description">{{ record.description || '—' }}</span>
            </Tooltip>
          </template>
          <template v-else-if="column.key === 'terms'">
            <span class="cell-count">{{ record.termCount.toLocaleString(locale) }}</span>
          </template>
          <template v-else-if="column.key === 'languages'">
            <span class="cell-count">{{ record.languageCount }}</span>
          </template>
          <template v-else-if="column.key === 'status'">
            <Tag class="status-tag" :color="record.isActive ? 'green' : 'default'">
              {{ record.isActive ? t('qaGlossaries.active') : t('qaGlossaries.inactive') }}
            </Tag>
          </template>
          <template v-else-if="column.key === 'action'">
            <RightOutlined class="row-arrow" />
          </template>
        </template>

        <template #emptyText>
          <Empty
            v-if="!loading && !error"
            :description="t('qaGlossaries.empty')"
          />
        </template>
      </Table>
    </Card>
  </PageContainer>
</template>

<style scoped>
.qa-glossaries-page {
  display: flex;
  flex-direction: column;
}

.table-card {
  display: flex;
  flex-direction: column;
  border: 1px solid var(--admin-border);
  border-radius: var(--admin-radius-md);
  background: var(--admin-surface);
  box-shadow: var(--admin-shadow-sm);
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

.qa-table :deep(.ant-table-thead > tr > th) {
  height: 44px;
  border-bottom: 1px solid var(--admin-border);
  color: var(--admin-text-muted);
  font-size: var(--admin-font-xs);
  font-weight: 600;
  white-space: nowrap;
}

.qa-table :deep(.ant-table-tbody > tr > td) {
  height: 50px;
  color: var(--admin-text-muted);
  font-size: var(--admin-font-sm);
}

.glossary-name {
  color: var(--admin-primary);
  font-weight: 600;
}

.cell-description {
  display: block;
  overflow: hidden;
  max-width: 46ch;
  color: var(--admin-text-muted);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cell-count {
  color: var(--admin-text);
  font-variant-numeric: tabular-nums;
}

.status-tag {
  margin: 0;
}

.row-arrow {
  color: var(--admin-text-subtle);
  font-size: var(--admin-font-2xs);
}
</style>
