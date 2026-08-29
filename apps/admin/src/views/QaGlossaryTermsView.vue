<script setup lang="ts">
import type { QaGlossaryTermListItem } from '@agent/contracts'
import type { TableColumnsType } from 'ant-design-vue'
import { SearchOutlined } from '@ant-design/icons-vue'
import {
  Alert,
  Button,
  Card,
  Empty,
  InputSearch,
  Pagination,
  Select,
  SelectOption,
  Skeleton,
  Table,
  Tag,
} from 'ant-design-vue'
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute } from 'vue-router'

import PageContainer from '@/components/common/PageContainer.vue'
import { fetchQaGlossaryTerms } from '@/features/qa/qa-api'
import { createPagedListState } from '@/features/shared/paged-list.state'

const route = useRoute()
const { t } = useI18n()

const glossaryId = Number(route.params.glossaryId)
const glossaryName = ref('')
const searchText = ref('')
const targetLanguage = ref('en')
const availableLanguages = ref<string[]>([])

const listState = createPagedListState<QaGlossaryTermListItem>(
  async (page, pageSize, signal) => {
    const response = await fetchQaGlossaryTerms(glossaryId, {
      page,
      pageSize,
      search: searchText.value,
      targetLanguage: targetLanguage.value,
    }, { signal })

    glossaryName.value = response.glossary.name
    targetLanguage.value = response.targetLanguage
    availableLanguages.value = response.availableLanguages
    return { items: response.items, pagination: response.pagination }
  },
  20,
)

const columns = computed<TableColumnsType<QaGlossaryTermListItem>>(() => [
  { title: t('qaGlossaryTerms.columns.termId'), dataIndex: 'termId', key: 'termId', width: 96 },
  { title: t('qaGlossaryTerms.columns.source'), key: 'source', width: 320 },
  { title: t('qaGlossaryTerms.columns.target', { language: targetLanguage.value }), key: 'target' },
  { title: t('qaGlossaryTerms.columns.status'), key: 'status', width: 88, align: 'center' },
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
  <PageContainer wide class="qa-terms-page">
    <h1 class="sr-only">
      {{ t('qaGlossaryTerms.title', { name: glossaryName }) }}
    </h1>

    <Card class="table-card" :bordered="false">
      <div class="filter-bar">
        <span v-if="glossaryName" class="glossary-label">{{ glossaryName }}</span>
        <Select
          v-model:value="targetLanguage"
          class="filter-bar__language"
          size="middle"
          :aria-label="t('qaGlossaryTerms.targetLanguage')"
          @change="applyFilters"
        >
          <SelectOption v-for="code in availableLanguages" :key="code" :value="code">
            {{ code }}
          </SelectOption>
        </Select>
        <InputSearch
          v-model:value="searchText"
          class="filter-bar__search"
          :placeholder="t('qaGlossaryTerms.searchPlaceholder')"
          allow-clear
          @search="applyFilters"
        >
          <template #enterButton>
            <Button type="primary">
              <SearchOutlined />
            </Button>
          </template>
        </InputSearch>
      </div>

      <Alert
        v-if="listState.error.value"
        class="table-error"
        type="error"
        show-icon
        :message="t('qaGlossaryTerms.loadFailed')"
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
        row-key="termId"
        size="small"
        :scroll="{ x: 760 }"
      >
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'termId'">
            <span class="cell-id">#{{ record.termId }}</span>
          </template>
          <template v-else-if="column.key === 'source'">
            <span class="cell-source">{{ record.sourceText ?? '—' }}</span>
          </template>
          <template v-else-if="column.key === 'target'">
            <span class="cell-target" :class="{ 'is-missing': record.targetText === null }">
              {{ record.targetText ?? t('qaGlossaryTerms.missingTranslation') }}
            </span>
          </template>
          <template v-else-if="column.key === 'status'">
            <Tag class="status-tag" :color="record.isActive ? 'green' : 'default'">
              {{ record.isActive ? t('qaGlossaries.active') : t('qaGlossaries.inactive') }}
            </Tag>
          </template>
        </template>

        <template #emptyText>
          <Empty
            v-if="!listState.loading.value && !listState.error.value"
            :description="t('qaGlossaryTerms.empty')"
          />
        </template>
      </Table>

      <footer v-if="!listState.error.value" class="table-card__footer">
        <span>
          {{ t('qaGlossaryTerms.showing', {
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
.qa-terms-page {
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

.glossary-label {
  color: var(--admin-text);
  font-size: var(--admin-font-md);
  font-weight: 600;
}

.filter-bar__language {
  width: 120px;
}

.filter-bar__search {
  width: 280px;
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

.cell-id {
  color: var(--admin-text-subtle);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: var(--admin-font-xs);
  font-variant-numeric: tabular-nums;
}

.cell-source {
  color: var(--admin-text);
}

.cell-target {
  color: var(--admin-text);
  overflow-wrap: anywhere;
}

.cell-target.is-missing {
  color: var(--admin-text-subtle);
}

.status-tag {
  margin: 0;
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
