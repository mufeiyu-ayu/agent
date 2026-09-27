<script setup lang="ts" generic="T extends object">
import type { TableColumnsType } from 'ant-design-vue'
import type { RouteLocationRaw } from 'vue-router'
import { RightOutlined } from '@ant-design/icons-vue'
import { Alert, Button, Empty, Pagination, Skeleton, Table } from 'ant-design-vue'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'

/**
 * 管理台列表的统一外观：表头吸顶、分页栏贴底、撑满内容面板；
 * 错误、首屏骨架与空态在这里统一处理，页面只管列定义与单元格内容。
 */
const props = withDefaults(defineProps<{
  columns: TableColumnsType<T>
  dataSource: T[]
  rowKey: string
  loading?: boolean
  error?: string
  errorTitle?: string
  emptyText?: string
  /** 横向最小宽度，列多时出现横向滚动 */
  scrollX?: number
  pagination?: { current: number, pageSize: number, total: number }
  /** 分页栏左侧的说明，如「共 22 条」 */
  summary?: string
  /** 整行可点击时的跳转目标；行尾会出现指示箭头 */
  rowTo?: (record: T) => RouteLocationRaw
  /** 不撑满面板（嵌在详情页等非整页场景） */
  compact?: boolean
}>(), {
  loading: false,
  error: '',
  errorTitle: '',
  emptyText: '',
  scrollX: undefined,
  pagination: undefined,
  summary: '',
  rowTo: undefined,
  compact: false,
})

const emit = defineEmits<{
  pageChange: [page: number, pageSize: number]
  retry: []
}>()

defineSlots<{
  bodyCell?: (props: { column: TableColumnsType<T>[number], record: T, index: number, text: unknown }) => unknown
  toolbar?: () => unknown
}>()

const router = useRouter()
const { t } = useI18n()

const PAGE_SIZE_OPTIONS = ['20', '50']
/** 表头吸在面板顶栏下方：必须等于 styles/index.css 的 --admin-tabs-height */
const STICKY_OFFSET = 44
const ROW_LINK_KEY = '__row-link'

const tableColumns = computed(() => (
  props.rowTo
    ? [...props.columns, { key: ROW_LINK_KEY, width: 36, align: 'right' as const }]
    : props.columns
))

const showSkeleton = computed(() => props.loading && props.dataSource.length === 0)

function customRow(record: T) {
  if (!props.rowTo)
    return {}

  return {
    class: 'is-clickable',
    onClick: (event: MouseEvent) => {
      // 行内自己的链接和按钮优先；正在选中文字复制时不跳
      if ((event.target as HTMLElement).closest('a, button, .ant-dropdown-trigger') || window.getSelection()?.toString())
        return
      // Cmd / Ctrl 点击整行：照链接的习惯开新标签
      if (event.metaKey || event.ctrlKey) {
        window.open(router.resolve(props.rowTo!(record)).href, '_blank')
        return
      }
      void router.push(props.rowTo!(record))
    },
  }
}

function handlePageChange(page: number, pageSize: number) {
  emit('pageChange', page, pageSize)
}
</script>

<template>
  <section class="data-table" :class="{ 'is-compact': compact }">
    <div v-if="$slots.toolbar" class="data-table__toolbar">
      <slot name="toolbar" />
    </div>

    <Alert
      v-if="error"
      class="data-table__error"
      type="error"
      show-icon
      :message="errorTitle"
      :description="error"
    >
      <template #action>
        <Button size="small" :loading="loading" @click="emit('retry')">
          {{ t('common.actions.retry') }}
        </Button>
      </template>
    </Alert>

    <Skeleton
      v-else-if="showSkeleton"
      active
      class="data-table__skeleton"
      :title="false"
      :paragraph="{ rows: 8, width: '100%' }"
    />

    <Table
      v-else
      class="data-table__table"
      :columns="tableColumns"
      :data-source="dataSource"
      :loading="loading"
      :pagination="false"
      :row-key="rowKey"
      :scroll="scrollX ? { x: scrollX } : undefined"
      :sticky="compact ? undefined : { offsetHeader: STICKY_OFFSET }"
      :custom-row="customRow"
    >
      <template #bodyCell="slotProps">
        <!-- 行尾箭头是真正的链接：键盘 Tab 可达，中键 / Cmd 点击能开新标签 -->
        <RouterLink
          v-if="slotProps.column.key === ROW_LINK_KEY && rowTo"
          class="data-table__row-link"
          :to="rowTo(slotProps.record as T)"
          :aria-label="t('common.actions.openDetail')"
        >
          <RightOutlined class="data-table__chevron" />
        </RouterLink>
        <slot
          v-else
          name="bodyCell"
          :column="slotProps.column"
          :record="(slotProps.record as T)"
          :index="slotProps.index"
          :text="slotProps.text"
        />
      </template>

      <template #emptyText>
        <Empty
          v-if="!loading"
          class="data-table__empty"
          :image="Empty.PRESENTED_IMAGE_SIMPLE"
          :description="emptyText"
        />
      </template>
    </Table>

    <footer v-if="(pagination || summary) && !error" class="data-table__footer">
      <span class="data-table__summary">{{ summary }}</span>
      <Pagination
        v-if="pagination"
        :current="pagination.current"
        :page-size="pagination.pageSize"
        :total="pagination.total"
        :page-size-options="PAGE_SIZE_OPTIONS"
        :show-size-changer="pagination.total > Number(PAGE_SIZE_OPTIONS[0])"
        size="small"
        @change="handlePageChange"
      />
    </footer>
  </section>
</template>

<style scoped>
.data-table {
  display: flex;
  min-width: 0;
  min-height: 0;
  flex: 1;
  flex-direction: column;
}

.data-table.is-compact {
  flex: none;
}

.data-table__toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  padding-bottom: 14px;
}

.data-table__error {
  margin-bottom: 12px;
}

.data-table__skeleton {
  padding: 12px 4px;
}

.data-table__table :deep(.ant-table-thead > tr > th) {
  height: 38px;
  padding-block: 0;
  color: var(--admin-text-muted);
  font-size: var(--admin-font-xs);
  font-weight: 500;
  white-space: nowrap;
  background: var(--admin-bg-deep);
}

.data-table__table :deep(.ant-table-tbody > tr > td) {
  height: 46px;
  padding-block: 6px;
  color: var(--admin-text);
  font-size: 13.5px;
}

.data-table__table :deep(.ant-table-thead > tr > th:first-child),
.data-table__table :deep(.ant-table-tbody > tr > td:first-child) {
  padding-left: 8px;
}

.data-table__table :deep(.ant-table-tbody > tr.is-clickable) {
  cursor: pointer;
}

.data-table__table :deep(.ant-table-tbody > tr > td.ant-table-cell-row-hover) {
  background: var(--admin-hover-solid);
}

.data-table__table :deep(.ant-table-cell-fix-left),
.data-table__table :deep(.ant-table-cell-fix-right) {
  background: var(--admin-bg-deep);
}

.data-table__chevron {
  color: var(--admin-text-subtle);
  font-size: 11px;
  transition: transform 140ms ease, color 140ms ease;
}

.data-table__row-link {
  display: inline-grid;
  width: 24px;
  height: 24px;
  place-items: center;
  border-radius: 6px;
}

.data-table__row-link:focus-visible {
  outline: 2px solid var(--admin-primary);
  outline-offset: 1px;
}

.data-table__table :deep(tr.is-clickable:hover) .data-table__chevron {
  color: var(--admin-text);
  transform: translateX(2px);
}

.data-table__empty {
  margin: 40px 0;
}

.data-table__footer {
  position: sticky;
  z-index: 3;
  bottom: 0;
  display: flex;
  min-height: 52px;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-top: auto;
  padding: 10px 4px 10px 8px;
  border-top: 0.5px solid var(--admin-border-strong);
  background: color-mix(in srgb, var(--admin-bg-deep) 88%, transparent);
  backdrop-filter: saturate(180%) blur(16px);
}

.is-compact .data-table__footer {
  position: static;
  margin-top: 0;
}

.data-table__summary {
  color: var(--admin-text-muted);
  font-size: var(--admin-font-xs);
  font-variant-numeric: tabular-nums;
}
</style>
