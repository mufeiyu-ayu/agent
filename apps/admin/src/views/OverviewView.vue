<script setup lang="ts">
import type { OverviewDataSet, OverviewWindowKey } from '@/features/overview/mock-data'
import {
  DownOutlined,
  ReloadOutlined,
  SettingOutlined,
} from '@ant-design/icons-vue'
import { Button, Dropdown, Menu, MenuItem } from 'ant-design-vue'
import { computed, ref, shallowRef, watch } from 'vue'
import { useRouter } from 'vue-router'

import PageContainer from '@/components/common/PageContainer.vue'
import OverviewLeftBottom from '@/features/overview/components/OverviewLeftBottom.vue'
import OverviewLeftKpi from '@/features/overview/components/OverviewLeftKpi.vue'
import OverviewLeftTrend from '@/features/overview/components/OverviewLeftTrend.vue'
import OverviewRightTable from '@/features/overview/components/OverviewRightTable.vue'
import { getOverviewMockData } from '@/features/overview/mock-data'

const router = useRouter()
const activeWindow = ref<OverviewWindowKey>('24h')
const loading = ref(false)
const renderKey = ref(0)
const currentData = shallowRef<OverviewDataSet>(getOverviewMockData('24h'))

async function refreshData(windowKey: OverviewWindowKey) {
  loading.value = true
  await new Promise(resolve => setTimeout(resolve, 180))
  currentData.value = getOverviewMockData(windowKey)
  renderKey.value++
  loading.value = false
}

watch(activeWindow, (newWindow) => {
  void refreshData(newWindow)
})

function handleRefresh() {
  void refreshData(activeWindow.value)
}

function handleSelectWindow(key: OverviewWindowKey) {
  activeWindow.value = key
}

const windowLabels: Record<OverviewWindowKey, string> = {
  '24h': '最近 24 小时 (按小时连续)',
  '7d': '近 7 天 (日维度)',
  '30d': '近 30 天 (月度视角)',
}

const kpi = computed(() => currentData.value.kpi)
const balances = computed(() => currentData.value.balances)
const models = computed(() => currentData.value.models)
const trends = computed(() => currentData.value.trends)
const tools = computed(() => currentData.value.tools)
const sparklines = computed(() => currentData.value.sparklines)
</script>

<template>
  <PageContainer wide>
    <!-- 顶部 Meta 栏 (极简、轻盈、科技感) -->
    <div class="overview-meta-bar dash-card-box">
      <div class="overview-meta-bar__left">
        <Dropdown trigger="click">
          <button class="meta-dropdown-btn">
            <span>{{ windowLabels[activeWindow] }}</span>
            <DownOutlined class="dropdown-arrow" />
          </button>
          <template #overlay>
            <Menu @click="(info) => handleSelectWindow(info.key as OverviewWindowKey)">
              <MenuItem key="24h">
                最近 24 小时 (按小时连续)
              </MenuItem>
              <MenuItem key="7d">
                近 7 天 (日维度)
              </MenuItem>
              <MenuItem key="30d">
                近 30 天 (月度视角)
              </MenuItem>
            </Menu>
          </template>
        </Dropdown>
        <span class="meta-separator">·</span>
        <span class="meta-status-indicator" :class="{ 'is-loading': loading }">
          <span class="status-pulse-dot" />
          <span class="meta-update-time">{{ loading ? '正在同步数据...' : '最后更新：刚刚' }}</span>
        </span>
      </div>

      <div class="overview-meta-bar__right">
        <Button
          size="small"
          type="text"
          :loading="loading"
          class="meta-action-btn"
          @click="handleRefresh"
        >
          <template #icon>
            <ReloadOutlined />
          </template>
          刷新
        </Button>
        <Button
          size="small"
          type="text"
          class="meta-action-btn"
          @click="() => router.push('/llm-models')"
        >
          <template #icon>
            <SettingOutlined />
          </template>
          模型接入配置
        </Button>
      </div>
    </div>

    <!-- 左右双主轴分栏布局 (对标参考图，带阶梯级联酷炫入场动效) -->
    <div :key="renderKey" class="overview-dashboard-grid">
      <!-- 左主栏 (约 56% 宽)：运行大盘、趋势折线、余额与工具生态 -->
      <div class="overview-left-col">
        <!-- 1. 运行核心 KPI (对标 Deliveries) -->
        <div class="dash-card-box dash-card-delay-1">
          <OverviewLeftKpi
            :kpi="kpi"
            :sparklines="sparklines"
            :loading="loading"
          />
        </div>

        <!-- 2. Token 吞吐与调用趋势大图 (对标 Revenue and costs) -->
        <div class="dash-card-box dash-card-delay-2">
          <OverviewLeftTrend
            :trends="trends"
            :active-window="activeWindow"
            :loading="loading"
          />
        </div>

        <!-- 3. 左下两张并排小卡片 (对标 Balance and costs & Costs by category) -->
        <div class="dash-card-box dash-card-delay-4">
          <OverviewLeftBottom
            :balances="balances"
            :tools="tools"
            :sparklines="sparklines"
            :loading="loading"
          />
        </div>
      </div>

      <!-- 右主栏 (约 44% 宽，全高度通卡，对标 Invoices) -->
      <div class="overview-right-col">
        <div class="dash-card-box dash-card-delay-3 h-full">
          <OverviewRightTable
            :models="models"
            :loading="loading"
          />
        </div>
      </div>
    </div>
  </PageContainer>
</template>

<style scoped>
.overview-meta-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 14px;
  padding: 0 4px;
  flex-wrap: wrap;
  gap: 10px;
}

.overview-meta-bar__left {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--admin-text-subtle);
  font-size: 12px;
}

.meta-dropdown-btn {
  background: transparent;
  border: none;
  color: var(--admin-text);
  font-size: 13px;
  font-weight: 650;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  padding: 0;
}

.dropdown-arrow {
  font-size: 10px;
  color: var(--admin-text-subtle);
}

.meta-separator {
  color: var(--admin-border-strong);
}

.meta-status-indicator {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.status-pulse-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #10b981;
  box-shadow: 0 0 8px rgba(16, 185, 129, 0.6);
  transition: background-color 200ms ease, box-shadow 200ms ease;
}

.meta-status-indicator.is-loading .status-pulse-dot {
  background: #38bdf8;
  box-shadow: 0 0 10px rgba(56, 189, 248, 0.8);
  animation: pulseLoadingDot 0.8s infinite alternate ease-in-out;
}

@keyframes pulseLoadingDot {
  0% {
    transform: scale(0.85);
    opacity: 0.5;
  }
  100% {
    transform: scale(1.35);
    opacity: 1;
  }
}

.meta-update-time {
  color: var(--admin-text-subtle);
  font-size: 11px;
}

.overview-meta-bar__right {
  display: flex;
  align-items: center;
  gap: 6px;
}

.meta-action-btn {
  color: var(--admin-text-muted);
  font-size: 12px;
}

.meta-action-btn:hover {
  color: var(--admin-text);
}

/* 左右分栏核心网格 (56% : 44%) */
.overview-dashboard-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.28fr) minmax(0, 1fr);
  gap: 14px;
  align-items: stretch;
}

.overview-left-col {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.overview-right-col {
  min-width: 0;
  display: flex;
  flex-direction: column;
}

/* 数据盒子炫酷级联入场动效 (Staggered Cascade Entrance) */
@keyframes cardEntrance {
  0% {
    opacity: 0;
    transform: translateY(18px) scale(0.992);
  }
  60% {
    opacity: 0.95;
    transform: translateY(-1px) scale(1);
  }
  100% {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}

.dash-card-box {
  animation: cardEntrance 480ms cubic-bezier(0.16, 1, 0.3, 1) both;
  will-change: transform, opacity;
}

.dash-card-delay-1 {
  animation-delay: 35ms;
}

.dash-card-delay-2 {
  animation-delay: 85ms;
}

.dash-card-delay-3 {
  animation-delay: 135ms;
}

.dash-card-delay-4 {
  animation-delay: 185ms;
}

.h-full {
  height: 100%;
}

@media (max-width: 1240px) {
  .overview-dashboard-grid {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
