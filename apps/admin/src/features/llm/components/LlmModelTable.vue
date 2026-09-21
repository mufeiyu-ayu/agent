<script setup lang="ts">
import type { AdminLlmModel, AdminLlmProvider, ReasoningEffort } from '@agent/contracts'
import type { TableColumnsType } from 'ant-design-vue'
import { reasoningEffortsOf } from '@agent/contracts'
import {
  CheckCircleFilled,
  CloseCircleFilled,
  DeleteOutlined,
  EditOutlined,
  MinusCircleOutlined,
  PushpinFilled,
  PushpinOutlined,
} from '@ant-design/icons-vue'
import {
  Button,
  Empty,
  Popconfirm,
  Select,
  Switch,
  Table,
  Tooltip,
} from 'ant-design-vue'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import LlmFamilyLogo from '@/features/llm/components/LlmFamilyLogo.vue'
import { formatShortDateTime, formatTokens } from '@/features/runs/run.utils'

const props = defineProps<{
  models: AdminLlmModel[]
  /** 用来渲染「服务商」列的标识与备注。 */
  providers: AdminLlmProvider[]
  loading: boolean
  /** 正在重测的模型 id，状态图标转圈。 */
  probingIds: Set<string>
}>()

const emit = defineEmits<{
  edit: [model: AdminLlmModel]
  delete: [id: string]
  toggleVisible: [id: string, visible: boolean]
  /** 表格里直接改推理强度；null 表示不发。 */
  updateReasoningEffort: [id: string, reasoningEffort: ReasoningEffort | null]
  setDefault: [id: string]
  /** 重测这一行。 */
  probe: [id: string]
}>()

const { locale, t } = useI18n()

const providerById = computed(() => new Map(props.providers.map(provider => [provider.id, provider])))

/** 该行所属家族允许的 reasoning_effort，直接用参数值做选项文案。 */
function effortOptionsOf(row: unknown) {
  const record = row as AdminLlmModel
  const family = providerById.value.get(record.providerId)?.family ?? 'other'

  return reasoningEffortsOf(family).map(value => ({ value, label: value }))
}

const columns = computed<TableColumnsType<AdminLlmModel>>(() => [
  {
    title: t('llmModels.models.columns.provider'),
    key: 'provider',
    width: '16%',
  },
  {
    title: t('llmModels.models.columns.displayName'),
    key: 'nameInfo',
    width: '26%',
  },
  {
    title: t('llmModels.models.columns.tokens'),
    key: 'tokens',
    width: '17%',
  },
  {
    title: t('llmModels.models.columns.reasoningEffort'),
    key: 'reasoningEffort',
    width: '11%',
    align: 'center',
  },
  {
    title: t('llmModels.models.columns.probe'),
    key: 'probe',
    width: '9%',
    align: 'center',
  },
  {
    title: t('llmModels.models.columns.visible'),
    key: 'visible',
    width: '7%',
    align: 'center',
  },
  {
    title: t('llmModels.models.columns.sortOrder'),
    dataIndex: 'sortOrder',
    key: 'sortOrder',
    width: '5%',
    align: 'center',
  },
  {
    title: t('llmModels.models.columns.actions'),
    key: 'actions',
    width: '5%',
    align: 'center',
  },
])

/** 悬浮显示上次测试的时间与失败原因，点图标本身重测；Table 的 bodyCell record 未带类型，这里收窄。 */
function probeTooltip(row: unknown): string {
  const record = row as AdminLlmModel
  const hint = t('llmModels.models.probeClickHint')

  if (record.lastProbeOk === null || !record.lastProbedAt)
    return `${t('llmModels.models.probeNever')}${hint}`

  const when = formatShortDateTime(record.lastProbedAt, locale.value)
  const result = record.lastProbeOk
    ? t('llmModels.models.probeOk', { when })
    : t('llmModels.models.probeFailed', { when, error: record.lastProbeError ?? '' })

  return `${result}${hint}`
}

function onEdit(record: unknown) {
  emit('edit', record as AdminLlmModel)
}
</script>

<template>
  <div class="model-catalog">
    <Table
      class="model-table"
      :columns="columns"
      :data-source="models"
      :loading="loading"
      :pagination="false"
      row-key="id"
      size="small"
    >
      <template #bodyCell="{ column, record }">
        <!-- 1. 服务商列 -->
        <template v-if="column.key === 'provider'">
          <div v-if="providerById.get(record.providerId)" class="provider-cell">
            <LlmFamilyLogo :family="providerById.get(record.providerId)!.family" :size="14" badge />
            <div class="provider-info-text">
              <span class="provider-name">{{ t(`llmModels.families.${providerById.get(record.providerId)!.family}`) }}</span>
              <span v-if="providerById.get(record.providerId)!.note" class="provider-note-pill" :title="providerById.get(record.providerId)!.note">
                {{ providerById.get(record.providerId)!.note }}
              </span>
            </div>
          </div>
        </template>

        <!-- 2. 模型名称列：副标签只在与真实代号不同时展示；默认星标跟在最后一行末尾，点它设默认 -->
        <template v-else-if="column.key === 'nameInfo'">
          <div class="model-name-cell">
            <span class="model-name-text">
              <span class="model-display-name" :title="record.displayName">
                {{ record.displayName }}
              </span>
              <span v-if="record.displayName !== record.wireName" class="model-wire-sub" :title="record.wireName">
                {{ record.wireName }}
              </span>
            </span>
            <button
              type="button"
              class="default-star-btn"
              :class="{ 'is-default': record.isDefault }"
              :title="record.isDefault ? t('llmModels.models.defaultTag') : t('llmModels.models.setDefault')"
              :disabled="record.isDefault"
              @click="emit('setDefault', record.id)"
            >
              <PushpinFilled v-if="record.isDefault" />
              <PushpinOutlined v-else />
            </button>
          </div>
        </template>

        <!-- 3. Tokens 列 -->
        <template v-else-if="column.key === 'tokens'">
          <Tooltip :title="`${t('llmModels.models.form.contextWindowTokens')}: ${record.contextWindowTokens.toLocaleString()} / ${t('llmModels.models.form.maxOutputTokens')}: ${record.maxOutputTokens.toLocaleString()}`">
            <div class="tokens-cell">
              <span class="token-val">{{ formatTokens(record.contextWindowTokens) }}</span>
              <span class="token-separator">/</span>
              <span class="token-val is-output">{{ formatTokens(record.maxOutputTokens) }}</span>
            </div>
          </Tooltip>
        </template>

        <!-- 推理强度列：直接在表格里选，值原样发给服务商；清空为不发 -->
        <template v-else-if="column.key === 'reasoningEffort'">
          <Select
            v-if="effortOptionsOf(record).length > 0"
            :value="record.reasoningEffort ?? undefined"
            :options="effortOptionsOf(record)"
            :placeholder="t('llmModels.models.form.reasoningEffortNone')"
            size="small"
            :bordered="false"
            allow-clear
            class="effort-select"
            @change="(value) => emit('updateReasoningEffort', record.id, (value ?? null) as ReasoningEffort | null)"
          />
          <span v-else class="empty-dash">—</span>
        </template>

        <!-- 4. 模型状态列：图标即按钮，点击重测 -->
        <template v-else-if="column.key === 'probe'">
          <Tooltip :title="probeTooltip(record)">
            <Button
              type="text"
              size="small"
              class="action-icon-btn probe-btn"
              :loading="probingIds.has(record.id)"
              @click="emit('probe', record.id)"
            >
              <template #icon>
                <CheckCircleFilled v-if="record.lastProbeOk === true" class="probe-btn__icon is-ok" />
                <CloseCircleFilled v-else-if="record.lastProbeOk === false" class="probe-btn__icon is-failed" />
                <MinusCircleOutlined v-else class="probe-btn__icon is-never" />
              </template>
            </Button>
          </Tooltip>
        </template>

        <!-- 5. 前台可见列 -->
        <template v-else-if="column.key === 'visible'">
          <Switch
            :checked="record.visible"
            size="small"
            @change="(checked) => emit('toggleVisible', record.id, Boolean(checked))"
          />
        </template>

        <!-- 6. 排序列 -->
        <template v-else-if="column.key === 'sortOrder'">
          <span class="sort-order">{{ record.sortOrder }}</span>
        </template>

        <!-- 7. 操作列 -->
        <template v-else-if="column.key === 'actions'">
          <div class="action-cell">
            <Tooltip :title="t('llmModels.actions.edit')">
              <Button
                type="text"
                size="small"
                class="action-icon-btn"
                @click="onEdit(record)"
              >
                <template #icon>
                  <EditOutlined />
                </template>
              </Button>
            </Tooltip>

            <Popconfirm
              :title="t('llmModels.models.deleteConfirmTitle')"
              :description="t('llmModels.models.deleteConfirmDescription')"
              :ok-text="t('llmModels.actions.confirm')"
              :cancel-text="t('llmModels.actions.cancel')"
              placement="topRight"
              @confirm="emit('delete', record.id)"
            >
              <Tooltip :title="t('llmModels.actions.delete')">
                <Button
                  type="text"
                  danger
                  size="small"
                  class="action-icon-btn is-danger"
                >
                  <template #icon>
                    <DeleteOutlined />
                  </template>
                </Button>
              </Tooltip>
            </Popconfirm>
          </div>
        </template>
      </template>

      <template #emptyText>
        <Empty :image="Empty.PRESENTED_IMAGE_SIMPLE" :description="t('llmModels.models.empty')" />
      </template>
    </Table>
  </div>
</template>

<style scoped>
.model-catalog {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-width: 0;
  overflow-x: auto;
}

.model-table {
  background: var(--admin-surface);
  min-width: 780px;
}

.model-table :deep(table) {
  table-layout: fixed;
  width: 100%;
}

/* 首列与末列内边距，与 Header 左右 18px 严格对齐，彻底消除贴边压迫感 */
.model-table :deep(.ant-table-thead > tr > th:first-child),
.model-table :deep(.ant-table-tbody > tr > td:first-child) {
  padding-left: 18px !important;
}

.model-table :deep(.ant-table-thead > tr > th:last-child),
.model-table :deep(.ant-table-tbody > tr > td:last-child) {
  padding-right: 18px !important;
}

/* 表头风格：紧凑浅色背景 + 精致次级字体 */
.model-table :deep(.ant-table-thead > tr > th) {
  height: 36px;
  padding: 6px 10px;
  border-bottom: 1px solid var(--admin-border);
  background: var(--admin-surface-muted);
  color: var(--admin-text-muted);
  font-size: var(--admin-font-xs);
  font-weight: 600;
  letter-spacing: 0.01em;
  white-space: nowrap;
}

/* 表身单元格：紧凑高度，快速扫描 */
.model-table :deep(.ant-table-tbody > tr > td) {
  height: 40px;
  padding: 5px 10px;
  border-bottom: 1px solid var(--admin-border);
  color: var(--admin-text);
  font-size: var(--admin-font-xs);
  transition: background-color 100ms ease;
}

.model-table :deep(.ant-table-tbody > tr:hover > td) {
  background: var(--admin-hover) !important;
}

/* 1. 服务商单元格 */
.provider-cell {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  max-width: 100%;
}

.provider-info-text {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.provider-name {
  color: var(--admin-text);
  font-size: var(--admin-font-xs);
  font-weight: 600;
  white-space: nowrap;
}

.provider-note-pill {
  display: inline-block;
  padding: 0 6px;
  height: 18px;
  line-height: 18px;
  border-radius: 4px;
  background: var(--admin-surface-muted);
  border: 1px solid var(--admin-border);
  color: var(--admin-text-subtle);
  font-size: var(--admin-font-2xs);
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 2. 模型名称单元格：文字块两行，图钉贴在末行末尾 */
.model-name-cell {
  display: flex;
  align-items: flex-end;
  gap: 6px;
  min-width: 0;
  line-height: 1.25;
}

.model-name-text {
  display: inline-flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
}

/* 默认图钉：已默认常亮主色；未默认平时隐藏，行 hover 时显现，点击设为默认 */
.default-star-btn {
  display: inline-flex;
  align-items: center;
  flex-shrink: 0;
  padding: 0 2px;
  border: 0;
  background: transparent;
  color: var(--admin-text-subtle);
  font-size: 11px;
  line-height: 1;
  cursor: pointer;
  opacity: 0;
  transition: all 120ms ease;
}

.default-star-btn.is-default {
  color: var(--admin-primary);
  opacity: 1;
  cursor: default;
}

:deep(.ant-table-row:hover) .default-star-btn {
  opacity: 1;
}

.default-star-btn:not(.is-default):hover {
  color: var(--admin-primary);
}

.model-display-name {
  color: var(--admin-text);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: var(--admin-font-xs);
  font-weight: 600;
  letter-spacing: -0.01em;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.model-wire-sub {
  color: var(--admin-text-subtle);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: var(--admin-font-2xs);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 3. Tokens 列 */
.tokens-cell {
  display: inline-flex;
  align-items: baseline;
  gap: 6px;
  cursor: help;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.token-val {
  color: var(--admin-text);
  font-size: var(--admin-font-xs);
  font-weight: 600;
}

.token-val.is-output {
  color: var(--admin-text-muted);
}

.token-separator {
  color: var(--admin-border-strong);
  font-size: var(--admin-font-2xs);
}

.empty-dash {
  color: var(--admin-text-subtle);
  opacity: 0.4;
  font-size: var(--admin-font-xs);
}

/* 推理强度：看起来就是一段文本，只有箭头暗示可点；不画边框、背景、阴影 */
.effort-select {
  width: auto;
  min-width: 72px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}

.effort-select :deep(.ant-select-selector) {
  height: 22px !important;
  padding: 0 16px 0 0 !important;
  border: 0 !important;
  background: transparent !important;
  box-shadow: none !important;
  color: var(--admin-text);
  font-size: var(--admin-font-xs);
}

.effort-select :deep(.ant-select-selection-item),
.effort-select :deep(.ant-select-selection-placeholder) {
  padding-inline-end: 0 !important;
  line-height: 22px !important;
}

.effort-select :deep(.ant-select-arrow),
.effort-select :deep(.ant-select-clear) {
  right: 0;
  font-size: 9px;
  color: var(--admin-text-subtle);
  background: transparent;
}

.effort-select:hover :deep(.ant-select-arrow) {
  color: var(--admin-text-muted);
}

/* 4. 模型状态：状态图标本身可点，hover 不改色以免盖掉状态语义 */
.probe-btn__icon {
  font-size: 14px;
}

.probe-btn__icon.is-ok {
  color: var(--admin-success);
}

.probe-btn__icon.is-failed {
  color: var(--admin-danger);
}

.probe-btn__icon.is-never {
  color: var(--admin-text-subtle);
}

.probe-btn:hover {
  color: inherit !important;
}
</style>
