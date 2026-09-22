<script setup lang="ts">
import type { LlmProviderFamily } from '@agent/contracts'
import type { OverviewModelUsageItem } from '../mock-data'
import {
  MoreOutlined,
  SearchOutlined,
} from '@ant-design/icons-vue'
import { Card, Input } from 'ant-design-vue'
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'

import LlmFamilyLogo from '@/features/llm/components/LlmFamilyLogo.vue'
import { formatTokens } from '@/features/runs/run.utils'

const props = defineProps<{
  models: OverviewModelUsageItem[]
  loading?: boolean
}>()

const { locale } = useI18n()
const router = useRouter()

// 过滤 Tab
type FilterTabKey = 'all' | LlmProviderFamily
const activeTab = ref<FilterTabKey>('all')
const searchQuery = ref('')

const tabs: { key: FilterTabKey, label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'openai', label: 'OpenAI' },
  { key: 'deepseek', label: 'DeepSeek' },
  { key: 'claude', label: 'Claude' },
  { key: 'gemini', label: 'Gemini' },
]

const filteredModels = computed(() => {
  return props.models.filter((m) => {
    const matchTab = activeTab.value === 'all' || m.providerFamily === activeTab.value
    const matchQuery = !searchQuery.value
      || m.displayName.toLowerCase().includes(searchQuery.value.toLowerCase())
      || m.wireName.toLowerCase().includes(searchQuery.value.toLowerCase())
    return matchTab && matchQuery
  })
})

function navigateToModels() {
  void router.push('/llm-models')
}
</script>

<template>
  <Card class="invoices-card" :bordered="false">
    <!-- 头部标题 -->
    <div class="invoices-card__head">
      <h2 class="invoices-card__title">
        多模型治理大盘
      </h2>
      <button class="invoices-card__more-btn" aria-label="More options" @click="navigateToModels">
        <MoreOutlined />
      </button>
    </div>

    <!-- 上半部：3 个核心大指标 (对标 PAID / RESENT REQUEST / UNPAID) -->
    <div class="invoices-kpi-row">
      <div class="invoices-kpi-cell">
        <span class="invoices-kpi-cell__label">ACTIVE MODELS</span>
        <strong class="invoices-kpi-cell__value">6</strong>
        <span class="invoices-kpi-cell__percent">51.5%</span>
      </div>

      <div class="invoices-kpi-cell">
        <span class="invoices-kpi-cell__label">TOKEN USAGE</span>
        <strong class="invoices-kpi-cell__value">1.49M</strong>
        <span class="invoices-kpi-cell__percent">29.0%</span>
      </div>

      <div class="invoices-kpi-cell">
        <span class="invoices-kpi-cell__label">HEALTH PROBE</span>
        <strong class="invoices-kpi-cell__value">100%</strong>
        <span class="invoices-kpi-cell__percent">19.5%</span>
      </div>
    </div>

    <!-- 全宽三色拼接进度条 (对标参考图的整条彩色条) -->
    <div class="invoices-progress-bar">
      <div class="invoices-progress-bar__seg is-green" style="width: 51.5%;" />
      <div class="invoices-progress-bar__seg is-lightgreen" style="width: 29.0%;" />
      <div class="invoices-progress-bar__seg is-gray" style="width: 19.5%;" />
    </div>

    <!-- 中部：Tabs 过滤 + 搜索框 -->
    <div class="invoices-toolbar">
      <div class="invoices-tabs">
        <button
          v-for="tab in tabs"
          :key="tab.key"
          class="invoices-tab-btn"
          :class="{ 'is-active': activeTab === tab.key }"
          @click="activeTab = tab.key"
        >
          {{ tab.label }}
        </button>
      </div>

      <div class="invoices-search">
        <Input
          v-model:value="searchQuery"
          placeholder="Search ⌘F"
          size="small"
          class="search-input"
        >
          <template #prefix>
            <SearchOutlined class="search-icon" />
          </template>
        </Input>
      </div>
    </div>

    <!-- 下半部：高质感数据表格 -->
    <div class="invoices-table-wrap">
      <table class="invoices-table">
        <thead>
          <tr>
            <th>Company / Model</th>
            <th>Issue date ▾</th>
            <th>Contact</th>
            <th style="text-align: right;">
              Tokens / Value
            </th>
            <th style="width: 24px;" />
          </tr>
        </thead>
        <tbody>
          <tr v-for="model in filteredModels" :key="model.id" class="invoices-row">
            <td>
              <div class="model-info">
                <div class="model-logo-wrap">
                  <LlmFamilyLogo :family="model.providerFamily" :size="15" badge />
                </div>
                <div class="model-names">
                  <strong class="model-display-name">{{ model.displayName }}</strong>
                  <span class="model-wire-name">{{ model.wireName }}</span>
                </div>
              </div>
            </td>
            <td class="date-cell">
              {{ model.issueDate }}
            </td>
            <td class="contact-cell">
              {{ model.contact }}
            </td>
            <td class="value-cell">
              <strong class="value-amount">{{ formatTokens(model.totalTokens, locale) }}</strong>
              <small class="value-calls">{{ model.callCount }} 次</small>
            </td>
            <td class="action-cell">
              <button class="row-more-btn" aria-label="Row options">
                <MoreOutlined />
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- 底部标准分页条 -->
    <div class="invoices-pagination">
      <div class="pagination-left">
        <span>Show by <strong>10</strong> ▾</span>
      </div>
      <div class="pagination-right">
        <span>1 / 1 &gt;</span>
      </div>
    </div>
  </Card>
</template>

<style scoped>
.invoices-card {
  border: 1px solid var(--admin-border);
  background: var(--admin-surface);
  box-shadow: var(--admin-shadow-sm);
  border-radius: 12px;
  height: 100%;
  display: flex;
  flex-direction: column;
  transition: border-color 200ms ease, box-shadow 200ms ease;
}

.invoices-card:hover {
  border-color: var(--admin-border-strong);
  box-shadow: var(--admin-shadow-md);
}

.invoices-card :deep(.ant-card-body) {
  padding: 18px 20px 14px;
  display: flex;
  flex-direction: column;
  height: 100%;
}

.invoices-card__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}

.invoices-card__title {
  margin: 0;
  color: var(--admin-text);
  font-size: 16px;
  font-weight: 700;
  letter-spacing: -0.01em;
}

.invoices-card__more-btn {
  background: transparent;
  border: none;
  color: var(--admin-text-subtle);
  cursor: pointer;
  font-size: 14px;
  padding: 0;
}

/* 3 个指标大数 */
.invoices-kpi-row {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 16px;
  margin-bottom: 8px;
}

.invoices-kpi-cell {
  display: flex;
  flex-direction: column;
}

.invoices-kpi-cell__label {
  color: var(--admin-text-subtle);
  font-size: 10px;
  font-weight: 650;
  letter-spacing: 0.05em;
  text-transform: uppercase;
}

.invoices-kpi-cell__value {
  color: var(--admin-text);
  font-size: 22px;
  font-weight: 750;
  letter-spacing: -0.02em;
  line-height: 1.15;
  margin: 2px 0 2px;
  font-variant-numeric: tabular-nums;
}

.invoices-kpi-cell__percent {
  color: var(--admin-text-subtle);
  font-size: 11px;
}

/* 全宽分段条 */
.invoices-progress-bar {
  display: flex;
  height: 6px;
  border-radius: 3px;
  overflow: hidden;
  margin: 6px 0 16px;
}

@keyframes expandProgressSeg {
  0% {
    transform: scaleX(0);
    opacity: 0.2;
  }
  100% {
    transform: scaleX(1);
    opacity: 1;
  }
}

.invoices-progress-bar__seg {
  height: 100%;
  transform-origin: left center;
  animation: expandProgressSeg 600ms cubic-bezier(0.16, 1, 0.3, 1) both;
}

.invoices-progress-bar__seg.is-green {
  background: #10b981;
}

.invoices-progress-bar__seg.is-lightgreen {
  background: #86efac;
}

.invoices-progress-bar__seg.is-gray {
  background: #e2e8f0;
}

/* 过滤 Tab 与搜索 */
.invoices-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
  flex-wrap: wrap;
}

.invoices-tabs {
  display: flex;
  align-items: center;
  gap: 4px;
}

.invoices-tab-btn {
  background: transparent;
  border: none;
  color: var(--admin-text-subtle);
  font-size: 12px;
  font-weight: 500;
  padding: 4px 10px;
  border-radius: 6px;
  cursor: pointer;
  transition: all 150ms ease;
}

.invoices-tab-btn:hover {
  color: var(--admin-text);
}

.invoices-tab-btn.is-active {
  color: var(--admin-text);
  font-weight: 700;
  border-bottom: 2px solid var(--admin-text);
  border-radius: 0;
}

.invoices-search {
  width: 140px;
}

.search-input {
  border-radius: 6px;
  border-color: var(--admin-border);
  font-size: 11px;
}

.search-icon {
  color: var(--admin-text-subtle);
  font-size: 11px;
}

/* 数据表格 */
.invoices-table-wrap {
  flex: 1;
  overflow-x: auto;
}

.invoices-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}

.invoices-table th {
  padding: 8px 6px;
  color: var(--admin-text-subtle);
  font-size: 11px;
  font-weight: 600;
  text-align: left;
  border-bottom: 1px solid var(--admin-border);
}

.invoices-row {
  border-bottom: 1px solid var(--admin-border);
  transition: background 150ms ease;
}

.invoices-row:hover {
  background: var(--admin-bg-deep);
}

.invoices-row td {
  padding: 10px 6px;
  vertical-align: middle;
}

.model-info {
  display: flex;
  align-items: center;
  gap: 8px;
}

.model-names {
  display: flex;
  flex-direction: column;
}

.model-display-name {
  color: var(--admin-text);
  font-size: 12px;
  font-weight: 600;
  line-height: 1.2;
}

.model-wire-name {
  color: var(--admin-text-subtle);
  font-size: 10px;
  font-family: monospace;
}

.date-cell {
  color: var(--admin-text-muted);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}

.contact-cell {
  color: var(--admin-text-subtle);
  font-size: 11px;
  font-family: monospace;
}

.value-cell {
  text-align: right;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
}

.value-amount {
  color: var(--admin-text);
  font-size: 12px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

.value-calls {
  color: var(--admin-text-subtle);
  font-size: 10px;
}

.action-cell {
  text-align: center;
}

.row-more-btn {
  background: transparent;
  border: none;
  color: var(--admin-text-subtle);
  cursor: pointer;
  padding: 0 4px;
  font-size: 12px;
}

.row-more-btn:hover {
  color: var(--admin-text);
}

/* 分页 */
.invoices-pagination {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-top: 10px;
  border-top: 1px solid var(--admin-border);
  margin-top: auto;
  color: var(--admin-text-subtle);
  font-size: 11px;
}

.pagination-left strong {
  color: var(--admin-text);
}

@media (max-width: 640px) {
  .invoices-kpi-row {
    grid-template-columns: 1fr;
    gap: 8px;
  }
}
</style>
