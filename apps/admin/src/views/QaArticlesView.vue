<script setup lang="ts">
import type { QaArticleListItem } from '@agent/contracts'
import type { TableColumnsType } from 'ant-design-vue'
import { SearchOutlined } from '@ant-design/icons-vue'
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Empty,
  InputSearch,
  Pagination,
  Skeleton,
  Table,
  Tag,
  Tooltip,
} from 'ant-design-vue'
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import PageContainer from '@/components/common/PageContainer.vue'
import { fetchQaArticles } from '@/features/qa/qa-api'
import { formatShortDateTime } from '@/features/runs/run.utils'
import { createPagedListState } from '@/features/shared/paged-list.state'

const { locale, t } = useI18n()

const searchText = ref('')
const qaCandidateOnly = ref(false)
const publishedOnly = ref(false)

const listState = createPagedListState<QaArticleListItem>(
  (page, pageSize, signal) => fetchQaArticles({
    page,
    pageSize,
    search: searchText.value,
    qaCandidateOnly: qaCandidateOnly.value,
    publishedOnly: publishedOnly.value,
  }, { signal }),
  20,
)

const columns = computed<TableColumnsType<QaArticleListItem>>(() => [
  { title: t('qaArticles.columns.title'), dataIndex: 'title', key: 'title', width: 320, fixed: 'left' },
  { title: t('qaArticles.columns.slug'), dataIndex: 'slug', key: 'slug', width: 240 },
  { title: t('qaArticles.columns.languages'), key: 'languages', width: 96, align: 'center' },
  { title: t('qaArticles.columns.termHits'), dataIndex: 'termHitCount', key: 'termHits', width: 96, align: 'center' },
  { title: t('qaArticles.columns.candidate'), key: 'candidate', width: 96, align: 'center' },
  { title: t('qaArticles.columns.publishedAt'), key: 'publishedAt', width: 126 },
])

onMounted(() => void listState.load())
onBeforeUnmount(listState.cancel)

function applyFilters() {
  void listState.setPage(1)
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
  <PageContainer wide class="qa-articles-page">
    <h1 class="sr-only">
      {{ t('qaArticles.title') }}
    </h1>

    <Card class="table-card" :bordered="false">
      <div class="filter-bar">
        <InputSearch
          v-model:value="searchText"
          class="filter-bar__search"
          :placeholder="t('qaArticles.searchPlaceholder')"
          allow-clear
          @search="applyFilters"
        >
          <template #enterButton>
            <Button type="primary">
              <SearchOutlined />
            </Button>
          </template>
        </InputSearch>
        <Checkbox v-model:checked="qaCandidateOnly" @change="applyFilters">
          {{ t('qaArticles.filterCandidate') }}
        </Checkbox>
        <Checkbox v-model:checked="publishedOnly" @change="applyFilters">
          {{ t('qaArticles.filterPublished') }}
        </Checkbox>
      </div>

      <Alert
        v-if="listState.error.value"
        class="table-error"
        type="error"
        show-icon
        :message="t('qaArticles.loadFailed')"
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
        class="qa-table"
        :columns="columns"
        :data-source="listState.items.value"
        :loading="listState.loading.value"
        :pagination="false"
        row-key="id"
        size="small"
        :scroll="{ x: 980 }"
      >
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'title'">
            <Tooltip :title="record.title">
              <span class="cell-title">{{ record.title }}</span>
            </Tooltip>
          </template>
          <template v-else-if="column.key === 'slug'">
            <Tooltip :title="record.slug">
              <span class="cell-slug">{{ record.slug }}</span>
            </Tooltip>
          </template>
          <template v-else-if="column.key === 'languages'">
            <span
              class="cell-languages"
              :class="{ 'is-empty': record.translatedLanguageCount === 0 }"
            >
              {{ record.translatedLanguageCount }}/{{ record.languageTotal }}
            </span>
          </template>
          <template v-else-if="column.key === 'termHits'">
            <span class="cell-hits">{{ record.termHitCount ?? '—' }}</span>
          </template>
          <template v-else-if="column.key === 'candidate'">
            <Tag v-if="record.isQaCandidate" class="candidate-tag" color="blue">
              {{ t('qaArticles.candidateTag') }}
            </Tag>
            <span v-else class="cell-muted">—</span>
          </template>
          <template v-else-if="column.key === 'publishedAt'">
            <span class="date-cell">
              {{ record.publishedAt ? formatShortDateTime(record.publishedAt, locale) : t('qaArticles.unpublished') }}
            </span>
          </template>
        </template>

        <template #emptyText>
          <Empty
            v-if="!listState.loading.value && !listState.error.value"
            :description="t('qaArticles.empty')"
          />
        </template>
      </Table>

      <footer v-if="!listState.error.value" class="table-card__footer">
        <span>
          {{ t('qaArticles.showing', {
            count: listState.items.value.length,
            total: listState.pagination.value.totalItems,
          }) }}
        </span>
        <Pagination
          :current="listState.currentPage.value"
          :page-size="listState.pageSize.value"
          :total="listState.pagination.value.totalItems"
          :page-size-options="['20', '50']"
          show-size-changer
          size="small"
          @change="handlePageChange"
        />
      </footer>
    </Card>
  </PageContainer>
</template>

<style scoped>
.qa-articles-page {
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

.filter-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px 18px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--admin-border);
}

.filter-bar__search {
  width: 300px;
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
  letter-spacing: 0.01em;
  white-space: nowrap;
}

.qa-table :deep(.ant-table-tbody > tr > td) {
  height: 50px;
  color: var(--admin-text-muted);
  font-size: var(--admin-font-sm);
}

.cell-title {
  display: block;
  overflow: hidden;
  color: var(--admin-text);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cell-slug {
  display: block;
  overflow: hidden;
  color: var(--admin-text-muted);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: var(--admin-font-xs);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cell-languages,
.cell-hits {
  color: var(--admin-text);
  font-variant-numeric: tabular-nums;
}

.cell-languages.is-empty,
.cell-muted {
  color: var(--admin-text-subtle);
}

.candidate-tag {
  margin: 0;
}

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
</style>
