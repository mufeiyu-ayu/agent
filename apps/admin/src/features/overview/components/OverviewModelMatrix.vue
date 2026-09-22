<script setup lang="ts">
import type { OverviewModelUsageItem } from '../mock-data'
import {
  ArrowRightOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
} from '@ant-design/icons-vue'
import { Button, Card, Table, Tag } from 'ant-design-vue'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'

import LlmFamilyLogo from '@/features/llm/components/LlmFamilyLogo.vue'
import { formatTokens } from '@/features/runs/run.utils'

const props = defineProps<{
  models: OverviewModelUsageItem[]
  loading?: boolean
}>()

const { locale, t } = useI18n()
const router = useRouter()

const columns = computed(() => [
  {
    title: t('overview.modelMatrix.columns.model'),
    key: 'model',
    width: 220,
  },
  {
    title: t('overview.modelMatrix.columns.provider'),
    key: 'provider',
    width: 140,
  },
  {
    title: t('overview.modelMatrix.columns.calls'),
    key: 'calls',
    align: 'right' as const,
    width: 90,
  },
  {
    title: t('overview.modelMatrix.columns.tokens'),
    key: 'tokens',
    align: 'left' as const,
    width: 180,
  },
  {
    title: t('overview.modelMatrix.columns.probe'),
    key: 'probe',
    align: 'center' as const,
    width: 110,
  },
])

function navigateToModels() {
  void router.push('/llm-models')
}
</script>

<template>
  <Card class="model-matrix-card" :bordered="false">
    <div class="model-matrix-card__head">
      <div class="model-matrix-card__titles">
        <h2 class="model-matrix-card__title">
          {{ t('overview.modelMatrix.title') }}
        </h2>
        <p class="model-matrix-card__subtitle">
          {{ t('overview.modelMatrix.subtitle') }}
        </p>
      </div>
      <Button
        type="link"
        size="small"
        class="model-matrix-card__link"
        @click="navigateToModels"
      >
        <span>{{ t('overview.modelMatrix.manageModels') }}</span>
        <ArrowRightOutlined />
      </Button>
    </div>

    <Table
      :columns="columns"
      :data-source="props.models"
      row-key="id"
      size="small"
      :pagination="false"
      :loading="props.loading"
      class="model-matrix-table"
    >
      <!-- Model 列 -->
      <template #bodyCell="{ column, record }">
        <template v-if="column.key === 'model'">
          <div class="model-cell">
            <strong class="model-cell__name">{{ record.displayName }}</strong>
            <span class="model-cell__wire">{{ record.wireName }}</span>
          </div>
        </template>

        <!-- Provider 列 -->
        <template v-else-if="column.key === 'provider'">
          <div class="provider-cell">
            <LlmFamilyLogo :family="record.providerFamily" :size="14" badge />
            <span class="provider-cell__name">
              {{ t(`llmModels.families.${record.providerFamily}`) }}
            </span>
          </div>
        </template>

        <!-- Calls 列 -->
        <template v-else-if="column.key === 'calls'">
          <span class="number-cell">{{ record.callCount.toLocaleString(locale) }}</span>
        </template>

        <!-- Tokens 列 -->
        <template v-else-if="column.key === 'tokens'">
          <div class="token-cell">
            <div class="token-cell__meta">
              <strong class="token-cell__total">{{ formatTokens(record.totalTokens, locale) }}</strong>
              <small class="token-cell__percent">{{ record.percent }}%</small>
            </div>
            <div class="token-cell__track">
              <div
                class="token-cell__fill"
                :style="{ width: `${record.percent}%` }"
              />
            </div>
          </div>
        </template>

        <!-- Probe 状态列 -->
        <template v-else-if="column.key === 'probe'">
          <div class="probe-cell">
            <Tag v-if="record.lastProbeOk" color="success" class="probe-tag">
              <template #icon>
                <CheckCircleOutlined />
              </template>
              {{ t('overview.modelMatrix.probeOk') }}
            </Tag>
            <Tag v-else color="error" class="probe-tag">
              <template #icon>
                <CloseCircleOutlined />
              </template>
              {{ t('overview.modelMatrix.probeFailed') }}
            </Tag>
            <small class="latency-hint">{{ record.avgLatencyMs }}ms</small>
          </div>
        </template>
      </template>
    </Table>

    <div class="model-matrix-card__foot">
      <span class="model-matrix-card__hint">
        当前接入 {{ props.models.length }} 个活跃模型 · 默认使用 GPT-4o (Omni)
      </span>
      <span class="model-matrix-card__hint-extra">
        平均响应延迟 ~1.6s
      </span>
    </div>
  </Card>
</template>

<style scoped>
.model-matrix-card {
  border: 1px solid var(--admin-border);
  background: var(--admin-surface);
  box-shadow: var(--admin-shadow-sm);
  border-radius: var(--admin-radius-md, 10px);
  height: 100%;
  display: flex;
  flex-direction: column;
}

.model-matrix-card__foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: auto;
  padding-top: 10px;
  border-top: 1px solid var(--admin-border);
  color: var(--admin-text-subtle);
  font-size: var(--admin-font-2xs, 11px);
}

.model-matrix-card :deep(.ant-card-body) {
  padding: 16px;
  display: flex;
  flex-direction: column;
  flex: 1;
}

.model-matrix-card__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 14px;
}

.model-matrix-card__title {
  margin: 0;
  color: var(--admin-text);
  font-size: var(--admin-font-md, 14px);
  font-weight: 650;
  line-height: 1.3;
}

.model-matrix-card__subtitle {
  margin: 2px 0 0;
  color: var(--admin-text-subtle);
  font-size: var(--admin-font-xs, 12px);
}

.model-matrix-card__link {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: var(--admin-font-xs, 12px);
  padding: 0;
  height: auto;
}

.model-matrix-table {
  flex: 1;
}

.model-matrix-table :deep(.ant-table-thead > tr > th) {
  background: var(--admin-bg-deep);
  color: var(--admin-text-muted);
  font-size: var(--admin-font-2xs, 11px);
  font-weight: 600;
  padding: 8px 10px;
  border-bottom: 1px solid var(--admin-border);
}

.model-matrix-table :deep(.ant-table-tbody > tr > td) {
  padding: 10px;
  border-bottom: 1px solid var(--admin-border);
  font-size: var(--admin-font-xs, 12px);
}

.model-cell {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.model-cell__name {
  color: var(--admin-text);
  font-weight: 600;
  line-height: 1.3;
}

.model-cell__wire {
  color: var(--admin-text-subtle);
  font-size: var(--admin-font-2xs, 11px);
  font-family: monospace;
}

.provider-cell {
  display: flex;
  align-items: center;
  gap: 6px;
}

.provider-cell__name {
  color: var(--admin-text);
  font-weight: 500;
}

.number-cell {
  color: var(--admin-text);
  font-variant-numeric: tabular-nums;
  font-weight: 600;
}

.token-cell {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.token-cell__meta {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
}

.token-cell__total {
  color: var(--admin-text);
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.token-cell__percent {
  color: var(--admin-text-muted);
  font-size: var(--admin-font-2xs, 11px);
}

.token-cell__track {
  height: 5px;
  border-radius: 2.5px;
  background: var(--admin-bg-deep);
  overflow: hidden;
}

.token-cell__fill {
  height: 100%;
  border-radius: 2.5px;
  background: var(--admin-primary);
  transition: width 300ms ease;
}

.probe-cell {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
}

.probe-tag {
  margin: 0;
  font-size: var(--admin-font-2xs, 11px);
  padding: 0 6px;
  line-height: 18px;
  border-radius: 4px;
}

.latency-hint {
  color: var(--admin-text-subtle);
  font-size: var(--admin-font-2xs, 10px);
  font-variant-numeric: tabular-nums;
}
</style>
