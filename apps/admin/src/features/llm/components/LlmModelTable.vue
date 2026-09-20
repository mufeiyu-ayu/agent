<script setup lang="ts">
import type { AdminLlmModel, AdminLlmProvider } from '@agent/contracts'
import type { TableColumnsType } from 'ant-design-vue'
import {
  CheckCircleFilled,
  CloseCircleFilled,
  DeleteOutlined,
  EditOutlined,
  ReloadOutlined,
  StarFilled,
  StarOutlined,
} from '@ant-design/icons-vue'
import {
  Button,
  Empty,
  Popconfirm,
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
  /** 正在重测的模型 id，行尾刷新按钮转圈。 */
  probingIds: Set<string>
}>()

const emit = defineEmits<{
  edit: [model: AdminLlmModel]
  delete: [id: string]
  toggleVisible: [id: string, visible: boolean]
  setDefault: [id: string]
  /** 重测这一行。 */
  probe: [id: string]
}>()

const { locale, t } = useI18n()

const providerById = computed(() => new Map(props.providers.map(provider => [provider.id, provider])))

const columns = computed<TableColumnsType<AdminLlmModel>>(() => [
  {
    title: t('llmModels.models.columns.provider'),
    key: 'provider',
    width: '18%',
    minWidth: 150,
  },
  {
    title: t('llmModels.models.columns.displayName'),
    key: 'nameInfo',
    width: '28%',
    minWidth: 200,
  },
  {
    title: t('llmModels.models.columns.tokens'),
    key: 'tokens',
    width: '20%',
    minWidth: 170,
  },
  {
    title: t('llmModels.models.columns.probe'),
    key: 'probe',
    width: '9%',
    minWidth: 96,
    align: 'center',
  },
  {
    title: t('llmModels.models.columns.reasoning'),
    key: 'reasoning',
    width: '7%',
    minWidth: 70,
    align: 'center',
  },
  {
    title: t('llmModels.models.columns.visible'),
    key: 'visible',
    width: '8%',
    minWidth: 80,
    align: 'center',
  },
  {
    title: t('llmModels.models.columns.isDefault'),
    key: 'isDefault',
    width: '9%',
    minWidth: 90,
    align: 'center',
  },
  {
    title: t('llmModels.models.columns.sortOrder'),
    dataIndex: 'sortOrder',
    key: 'sortOrder',
    width: '5%',
    minWidth: 60,
    align: 'center',
  },
  {
    title: t('llmModels.models.columns.actions'),
    key: 'actions',
    width: '5%',
    minWidth: 70,
    align: 'center',
  },
])

/** 悬浮显示上次测试的时间与失败原因；Table 的 bodyCell record 未带类型，这里收窄。 */
function probeTooltip(row: unknown): string {
  const record = row as AdminLlmModel

  if (record.lastProbeOk === null || !record.lastProbedAt)
    return t('llmModels.models.probeNever')

  const when = formatShortDateTime(record.lastProbedAt, locale.value)

  return record.lastProbeOk
    ? t('llmModels.models.probeOk', { when })
    : t('llmModels.models.probeFailed', { when, error: record.lastProbeError ?? '' })
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
      size="middle"
      :scroll="{ x: 880 }"
    >
      <template #bodyCell="{ column, record }">
        <!-- 1. 服务商列 -->
        <template v-if="column.key === 'provider'">
          <div v-if="providerById.get(record.providerId)" class="provider-cell">
            <LlmFamilyLogo :family="providerById.get(record.providerId)!.family" :size="16" />
            <span class="provider-name">{{ t(`llmModels.families.${providerById.get(record.providerId)!.family}`) }}</span>
            <span v-if="providerById.get(record.providerId)!.note" class="provider-note-pill">
              {{ providerById.get(record.providerId)!.note }}
            </span>
          </div>
        </template>

        <!-- 2. 模型名称列（去重：仅在与真实代号不同时才展示副标签） -->
        <template v-else-if="column.key === 'nameInfo'">
          <div class="model-name-cell">
            <span class="model-display-name" :title="record.displayName">
              {{ record.displayName }}
            </span>
            <span
              v-if="record.displayName !== record.wireName"
              class="model-wire-sub"
              :title="record.wireName"
            >
              {{ record.wireName }}
            </span>
          </div>
        </template>

        <!-- 3. Tokens 列 -->
        <template v-else-if="column.key === 'tokens'">
          <Tooltip :title="`${t('llmModels.models.form.contextWindowTokens')}: ${record.contextWindowTokens.toLocaleString()} / ${t('llmModels.models.form.maxOutputTokens')}: ${record.maxOutputTokens.toLocaleString()}`">
            <div class="tokens-cell">
              <span class="token-item">
                <span class="token-val">{{ formatTokens(record.contextWindowTokens) }}</span>
                <span class="token-sub">{{ t('llmModels.models.columns.contextWindow') }}</span>
              </span>
              <span class="token-separator">/</span>
              <span class="token-item">
                <span class="token-val is-output">{{ formatTokens(record.maxOutputTokens) }}</span>
                <span class="token-sub">{{ t('llmModels.models.columns.maxOutput') }}</span>
              </span>
            </div>
          </Tooltip>
        </template>

        <!-- 4. 思考模型列 -->
        <template v-else-if="column.key === 'probe'">
          <Tooltip :title="probeTooltip(record)">
            <span class="probe-cell">
              <CheckCircleFilled v-if="record.lastProbeOk === true" class="probe-cell__icon is-ok" />
              <CloseCircleFilled v-else-if="record.lastProbeOk === false" class="probe-cell__icon is-failed" />
              <span v-else class="empty-dash">—</span>
              <Button
                type="text"
                size="small"
                class="action-icon-btn"
                :loading="probingIds.has(record.id)"
                @click="emit('probe', record.id)"
              >
                <template #icon>
                  <ReloadOutlined />
                </template>
              </Button>
            </span>
          </Tooltip>
        </template>

        <template v-else-if="column.key === 'reasoning'">
          <span v-if="record.reasoning" class="badge-reasoning">
            {{ t('llmModels.models.reasoningTag') }}
          </span>
          <span v-else class="empty-dash">—</span>
        </template>

        <!-- 5. 前台可见列 -->
        <template v-else-if="column.key === 'visible'">
          <Switch
            :checked="record.visible"
            size="small"
            @change="(checked) => emit('toggleVisible', record.id, Boolean(checked))"
          />
        </template>

        <!-- 6. 默认模型列 -->
        <template v-else-if="column.key === 'isDefault'">
          <span v-if="record.isDefault" class="badge-default">
            <StarFilled class="star-icon" />
            {{ t('llmModels.models.defaultTag') }}
          </span>
          <button
            v-else
            type="button"
            class="set-default-btn"
            @click="emit('setDefault', record.id)"
          >
            <StarOutlined class="ghost-star" />
            <span class="btn-text">{{ t('llmModels.models.setDefault') }}</span>
          </button>
        </template>

        <!-- 7. 排序列 -->
        <template v-else-if="column.key === 'sortOrder'">
          <span class="sort-order">{{ record.sortOrder }}</span>
        </template>

        <!-- 8. 操作列 -->
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
}

.model-table {
  background: var(--admin-surface);
}

/* 表头风格：浅色背景 + 精致次级字体 */
.model-table :deep(.ant-table-thead > tr > th) {
  height: 40px;
  padding: 8px 14px;
  border-bottom: 1px solid var(--admin-border);
  background: var(--admin-surface-muted);
  color: var(--admin-text-muted);
  font-size: var(--admin-font-xs);
  font-weight: 600;
  letter-spacing: 0.01em;
  white-space: nowrap;
}

/* 表身单元格 */
.model-table :deep(.ant-table-tbody > tr > td) {
  height: 48px;
  padding: 8px 14px;
  border-bottom: 1px solid var(--admin-border);
  color: var(--admin-text);
  font-size: var(--admin-font-sm);
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

.provider-name {
  color: var(--admin-text);
  font-size: var(--admin-font-xs);
  font-weight: 600;
  white-space: nowrap;
}

.provider-note-pill {
  display: inline-block;
  padding: 1px 8px;
  border-radius: 4px;
  background: var(--admin-surface-muted);
  color: var(--admin-text-subtle);
  font-size: var(--admin-font-2xs);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 2. 模型名称单元格 */
.model-name-cell {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
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
  gap: 8px;
  cursor: help;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.token-item {
  display: inline-flex;
  align-items: baseline;
  gap: 4px;
}

.token-val {
  color: var(--admin-text);
  font-size: var(--admin-font-xs);
  font-weight: 600;
}

.token-val.is-output {
  color: var(--admin-text-muted);
}

.token-sub {
  color: var(--admin-text-subtle);
  font-size: var(--admin-font-2xs);
}

.token-separator {
  color: var(--admin-text-subtle);
  font-size: var(--admin-font-2xs);
  opacity: 0.5;
}

/* 4. 思考模型徽标 */
.badge-reasoning {
  display: inline-flex;
  align-items: center;
  padding: 2px 7px;
  border-radius: 4px;
  background: var(--admin-primary-soft);
  color: var(--admin-primary);
  font-size: var(--admin-font-2xs);
  font-weight: 600;
  line-height: 1.2;
}

.empty-dash {
  color: var(--admin-text-subtle);
  opacity: 0.4;
  font-size: var(--admin-font-xs);
}

/* 6. 默认模型 */
.badge-default {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  border-radius: 12px;
  background: color-mix(in srgb, var(--admin-warning) 12%, transparent);
  color: var(--admin-warning-strong);
  font-size: var(--admin-font-2xs);
  font-weight: 600;
}

.star-icon {
  font-size: 11px;
}

/* 设为默认幽灵按钮：平时弱化，行悬停时更易辨识 */
.set-default-btn {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 2px 6px;
  border: 1px solid transparent;
  border-radius: var(--admin-radius-sm);
  background: transparent;
  color: var(--admin-text-subtle);
  font-size: var(--admin-font-xs);
  cursor: pointer;
  transition: all 120ms ease;
}

/* 表格行 hover 时按钮轻微凸显 */
:deep(.ant-table-row:hover) .set-default-btn {
  color: var(--admin-text-muted);
}

.set-default-btn:hover {
  border-color: var(--admin-border-strong);
  background: var(--admin-surface);
  color: var(--admin-primary);
}

.ghost-star {
  font-size: 11px;
}

/* 7. 排序 */
.sort-order {
  color: var(--admin-text-subtle);
  font-size: var(--admin-font-xs);
  font-variant-numeric: tabular-nums;
}

/* 8. 操作按钮组 */
.action-cell {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
}

.action-icon-btn {
  width: 28px;
  height: 28px;
  padding: 0;
  border-radius: var(--admin-radius-sm);
  color: var(--admin-text-muted);
  transition: all 120ms ease;
}

.action-icon-btn:hover {
  color: var(--admin-primary);
  background: var(--admin-hover);
}

.action-icon-btn.is-danger:hover {
  color: var(--admin-danger);
  background: var(--admin-danger-soft);
}

.model-table :deep(.ant-table-placeholder) {
  min-height: 260px;
}

.model-table :deep(.ant-table-placeholder .ant-empty) {
  margin: 60px 0;
}
.probe-cell {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.probe-cell__icon {
  font-size: 14px;
}

.probe-cell__icon.is-ok {
  color: var(--admin-success);
}

.probe-cell__icon.is-failed {
  color: var(--admin-danger);
}
</style>
