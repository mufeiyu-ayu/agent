<script setup lang="ts">
import type { OverviewKpiStats, OverviewProviderBalanceItem } from '../mock-data'
import {
  CheckCircleFilled,
  InfoCircleOutlined,
  ThunderboltFilled,
  WalletOutlined,
} from '@ant-design/icons-vue'
import { Button, Card, Popover, Skeleton, Tag } from 'ant-design-vue'
import { useI18n } from 'vue-i18n'

import LlmFamilyLogo from '@/features/llm/components/LlmFamilyLogo.vue'
import { formatTokens } from '@/features/runs/run.utils'

const props = defineProps<{
  kpi: OverviewKpiStats
  balances: OverviewProviderBalanceItem[]
  loading?: boolean
}>()

const { locale, t } = useI18n()
</script>

<template>
  <section class="kpi-grid">
    <!-- Card 1: 运行与调用 -->
    <Card class="kpi-card" :bordered="false">
      <Skeleton v-if="props.loading" active :paragraph="{ rows: 2 }" />
      <div v-else class="kpi-card__inner">
        <div class="kpi-card__header">
          <span class="kpi-card__label">{{ t('overview.cards.runs') }}</span>
          <Tag color="success" class="kpi-card__tag">
            <template #icon>
              <CheckCircleFilled />
            </template>
            {{ t('overview.cards.runsSuccessRate', { rate: props.kpi.successRate }) }}
          </Tag>
        </div>

        <div class="kpi-card__main">
          <strong class="kpi-card__value">{{ props.kpi.runCount.toLocaleString(locale) }}</strong>
        </div>

        <div class="kpi-card__footer">
          <span class="kpi-card__subtext">
            {{ t('overview.cards.runsDetailSummary', {
              convs: props.kpi.conversationCount.toLocaleString(locale),
              msgs: props.kpi.messageCount.toLocaleString(locale),
            }) }}
          </span>
        </div>
      </div>
    </Card>

    <!-- Card 2: Token 吞吐 -->
    <Card class="kpi-card" :bordered="false">
      <Skeleton v-if="props.loading" active :paragraph="{ rows: 2 }" />
      <div v-else class="kpi-card__inner">
        <div class="kpi-card__header">
          <span class="kpi-card__label">{{ t('overview.cards.tokens') }}</span>
          <span class="kpi-card__extra-label">
            {{ t('overview.cards.tokensAvg', { avg: formatTokens(props.kpi.avgTokensPerRun, locale) }) }}
          </span>
        </div>

        <div class="kpi-card__main">
          <strong class="kpi-card__value">{{ formatTokens(props.kpi.totalTokens, locale) }}</strong>
        </div>

        <div class="kpi-card__footer">
          <div class="kpi-token-bar">
            <div
              class="kpi-token-bar__fill is-input"
              :style="{ width: `${(props.kpi.inputTokens / props.kpi.totalTokens) * 100}%` }"
              title="Input Tokens"
            />
            <div
              class="kpi-token-bar__fill is-output"
              :style="{ width: `${(props.kpi.outputTokens / props.kpi.totalTokens) * 100}%` }"
              title="Output Tokens"
            />
          </div>
          <span class="kpi-card__subtext">
            {{ t('overview.cards.tokensDetail', {
              input: formatTokens(props.kpi.inputTokens, locale),
              output: formatTokens(props.kpi.outputTokens, locale),
            }) }}
          </span>
        </div>
      </div>
    </Card>

    <!-- Card 3: 服务商与模型就绪 -->
    <Card class="kpi-card" :bordered="false">
      <Skeleton v-if="props.loading" active :paragraph="{ rows: 2 }" />
      <div v-else class="kpi-card__inner">
        <div class="kpi-card__header">
          <span class="kpi-card__label">{{ t('overview.cards.providers') }}</span>
          <Popover placement="bottomRight" trigger="hover" overlay-class-name="balance-popover">
            <template #title>
              <div class="balance-popover__title">
                <WalletOutlined />
                <span>{{ t('overview.cards.balancesTitle') }}</span>
              </div>
            </template>
            <template #content>
              <div class="balance-popover__list">
                <div
                  v-for="item in props.balances"
                  :key="item.id"
                  class="balance-popover__item"
                >
                  <div class="balance-popover__item-head">
                    <LlmFamilyLogo :family="item.family" :size="14" badge />
                    <div class="balance-popover__item-names">
                      <strong>{{ t(`llmModels.families.${item.family}`) }}</strong>
                      <small>{{ item.note }}</small>
                    </div>
                  </div>
                  <div class="balance-popover__item-balance">
                    <span class="balance-popover__amount">{{ item.balance }}</span>
                    <span class="balance-popover__currency">{{ item.currency }}</span>
                  </div>
                </div>
              </div>
              <div class="balance-popover__hint">
                <InfoCircleOutlined />
                <span>{{ t('overview.cards.balancesHint') }}</span>
              </div>
            </template>
            <Button size="small" type="link" class="kpi-card__balance-btn">
              <WalletOutlined />
              {{ t('overview.cards.viewBalances') }}
            </Button>
          </Popover>
        </div>

        <div class="kpi-card__main">
          <strong class="kpi-card__value is-success">
            {{ t('overview.cards.providersReady', { ready: props.kpi.healthyProviders, total: props.kpi.totalProviders }) }}
          </strong>
        </div>

        <div class="kpi-card__footer">
          <span class="kpi-card__subtext">
            {{ t('overview.cards.modelsCount', { models: props.kpi.totalModels, visible: props.kpi.visibleModels }) }}
          </span>
        </div>
      </div>
    </Card>

    <!-- Card 4: 工具调用 -->
    <Card class="kpi-card" :bordered="false">
      <Skeleton v-if="props.loading" active :paragraph="{ rows: 2 }" />
      <div v-else class="kpi-card__inner">
        <div class="kpi-card__header">
          <span class="kpi-card__label">{{ t('overview.cards.tools') }}</span>
          <span class="kpi-card__extra-icon"><ThunderboltFilled /></span>
        </div>

        <div class="kpi-card__main">
          <strong class="kpi-card__value">{{ props.kpi.toolCallCount.toLocaleString(locale) }}</strong>
        </div>

        <div class="kpi-card__footer">
          <span class="kpi-card__subtext">
            {{ t('overview.cards.toolsAvg', { avg: props.kpi.avgToolCallsPerRun }) }}
          </span>
        </div>
      </div>
    </Card>
  </section>
</template>

<style scoped>
.kpi-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 14px;
  margin-bottom: 16px;
}

.kpi-card {
  border: 1px solid var(--admin-border);
  background: var(--admin-surface);
  box-shadow: var(--admin-shadow-sm);
  border-radius: var(--admin-radius-md, 10px);
  transition: transform 180ms ease, box-shadow 180ms ease, border-color 180ms ease;
}

.kpi-card:hover {
  border-color: var(--admin-border-strong);
  box-shadow: var(--admin-shadow-md);
}

.kpi-card :deep(.ant-card-body) {
  padding: 16px 18px 14px;
}

.kpi-card__inner {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.kpi-card__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 24px;
}

.kpi-card__label {
  color: var(--admin-text-muted);
  font-size: var(--admin-font-xs, 12px);
  font-weight: 600;
  letter-spacing: 0.02em;
}

.kpi-card__tag {
  margin: 0;
  font-size: var(--admin-font-2xs, 11px);
  padding: 0 6px;
  line-height: 20px;
  border-radius: 4px;
}

.kpi-card__extra-label {
  color: var(--admin-text-subtle);
  font-size: var(--admin-font-2xs, 11px);
}

.kpi-card__extra-icon {
  color: var(--admin-warning);
  font-size: 14px;
}

.kpi-card__balance-btn {
  padding: 0 4px;
  height: 22px;
  font-size: var(--admin-font-2xs, 11px);
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.kpi-card__main {
  margin: 10px 0 6px;
}

.kpi-card__value {
  display: block;
  color: var(--admin-text);
  font-size: var(--admin-font-2xl, 24px);
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.03em;
  line-height: 1.15;
}

.kpi-card__value.is-success {
  color: var(--admin-success-strong);
}

.kpi-card__footer {
  margin-top: auto;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.kpi-card__subtext {
  color: var(--admin-text-subtle);
  font-size: var(--admin-font-2xs, 11px);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.kpi-token-bar {
  display: flex;
  height: 4px;
  border-radius: 2px;
  overflow: hidden;
  background: var(--admin-bg-deep);
  margin-bottom: 2px;
}

.kpi-token-bar__fill.is-input {
  background: var(--admin-primary);
}

.kpi-token-bar__fill.is-output {
  background: var(--admin-success);
}

/* Balance Popover styles */
.balance-popover__title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: var(--admin-font-sm, 13px);
  color: var(--admin-text);
}

.balance-popover__list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 8px 0;
  min-width: 240px;
}

.balance-popover__item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 6px 8px;
  border-radius: var(--admin-radius-sm, 6px);
  background: var(--admin-surface-muted);
}

.balance-popover__item-head {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.balance-popover__item-names {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.balance-popover__item-names strong {
  font-size: var(--admin-font-xs, 12px);
  color: var(--admin-text);
  line-height: 1.2;
}

.balance-popover__item-names small {
  font-size: var(--admin-font-2xs, 11px);
  color: var(--admin-text-subtle);
}

.balance-popover__item-balance {
  display: flex;
  align-items: baseline;
  gap: 4px;
  flex-shrink: 0;
}

.balance-popover__amount {
  font-size: var(--admin-font-sm, 13px);
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  color: var(--admin-text);
}

.balance-popover__currency {
  font-size: var(--admin-font-2xs, 11px);
  color: var(--admin-text-muted);
}

.balance-popover__hint {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: var(--admin-font-2xs, 11px);
  color: var(--admin-text-subtle);
  padding-top: 6px;
  border-top: 1px solid var(--admin-border);
}

@media (max-width: 1240px) {
  .kpi-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 640px) {
  .kpi-grid {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
