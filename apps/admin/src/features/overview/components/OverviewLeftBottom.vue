<script setup lang="ts">
import type { OverviewProviderBalanceItem, OverviewSparklines, OverviewToolItem } from '../mock-data'
import { MoreOutlined } from '@ant-design/icons-vue'
import { Card } from 'ant-design-vue'

const props = defineProps<{
  balances: OverviewProviderBalanceItem[]
  tools: OverviewToolItem[]
  sparklines: OverviewSparklines
  loading?: boolean
}>()

const primaryBalance = props.balances[0] ?? {
  balance: '23.88',
  currency: 'CNY',
  note: 'DeepSeek',
}
</script>

<template>
  <div class="left-bottom-grid">
    <!-- Card 1: 平台余额与额度 (对标 Balance and costs) -->
    <Card class="sub-block-card" :bordered="false">
      <div class="sub-block-card__head">
        <h3 class="sub-block-card__title">
          平台余额与额度
        </h3>
        <button class="sub-block-card__more-btn" aria-label="More options">
          <MoreOutlined />
        </button>
      </div>

      <div class="sub-block-card__meta">
        <div class="sub-block-card__val-group">
          <span class="sub-block-card__label">PRIMARY BALANCE</span>
          <strong class="sub-block-card__value">
            {{ primaryBalance.currency === 'CNY' ? '¥' : '$' }}{{ primaryBalance.balance }}
          </strong>
        </div>
        <div class="sub-block-card__target">
          Target: >$10.00
        </div>
      </div>

      <!-- 微柱状条与散点目标线 -->
      <div class="balance-bars-wrap">
        <div class="balance-dots-line">
          <span v-for="i in 12" :key="i" class="balance-dot" />
        </div>
        <div class="balance-bars">
          <span
            v-for="(bar, idx) in props.sparklines.balanceBars"
            :key="idx"
            class="balance-bar"
            :style="{ height: `${bar.height}px`, background: bar.color, animationDelay: `${idx * 26}ms` }"
          />
        </div>
      </div>
    </Card>

    <!-- Card 2: 工具调用分类 (对标 Costs by category) -->
    <Card class="sub-block-card" :bordered="false">
      <div class="sub-block-card__head">
        <h3 class="sub-block-card__title">
          工具链调用生态
        </h3>
        <button class="sub-block-card__more-btn" aria-label="More options">
          <MoreOutlined />
        </button>
      </div>

      <!-- 顶部彩色分段进度条 -->
      <div class="segmented-bar">
        <div
          v-for="item in props.tools"
          :key="item.name"
          class="segmented-bar__segment"
          :style="{ width: `${item.percent}%`, background: item.color }"
        />
      </div>

      <!-- 分类列表 -->
      <ul class="category-list">
        <li v-for="item in props.tools" :key="item.name" class="category-item">
          <div class="category-item__left">
            <span class="category-item__square" :style="{ background: item.color }" />
            <span class="category-item__name">{{ item.category }}</span>
          </div>
          <div class="category-item__right">
            <span class="category-item__amount">{{ item.amountText }}</span>
            <span class="category-item__percent">{{ item.percent }}%</span>
          </div>
        </li>
      </ul>
    </Card>
  </div>
</template>

<style scoped>
.left-bottom-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
  margin-top: 14px;
}

.sub-block-card {
  border: 1px solid var(--admin-border);
  background: var(--admin-surface);
  box-shadow: var(--admin-shadow-sm);
  border-radius: 12px;
  transition: border-color 200ms ease, box-shadow 200ms ease;
}

.sub-block-card:hover {
  border-color: var(--admin-border-strong);
  box-shadow: var(--admin-shadow-md);
}

.sub-block-card :deep(.ant-card-body) {
  padding: 16px 20px;
}

.sub-block-card__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}

.sub-block-card__title {
  margin: 0;
  color: var(--admin-text);
  font-size: 14px;
  font-weight: 700;
  letter-spacing: -0.01em;
}

.sub-block-card__more-btn {
  background: transparent;
  border: none;
  color: var(--admin-text-subtle);
  cursor: pointer;
  font-size: 13px;
  padding: 0;
}

.sub-block-card__meta {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  margin-bottom: 12px;
}

.sub-block-card__val-group {
  display: flex;
  flex-direction: column;
}

.sub-block-card__label {
  color: var(--admin-text-subtle);
  font-size: 10px;
  font-weight: 650;
  letter-spacing: 0.05em;
  text-transform: uppercase;
}

.sub-block-card__value {
  color: var(--admin-text);
  font-size: 20px;
  font-weight: 750;
  letter-spacing: -0.02em;
  line-height: 1.1;
  margin-top: 2px;
}

.sub-block-card__target {
  color: var(--admin-text-subtle);
  font-size: 11px;
}

/* 柱状与散点图 */
.balance-bars-wrap {
  position: relative;
  height: 48px;
  display: flex;
  align-items: flex-end;
}

.balance-dots-line {
  position: absolute;
  top: 6px;
  left: 0;
  right: 0;
  display: flex;
  justify-content: space-between;
  pointer-events: none;
}

.balance-dot {
  width: 2.5px;
  height: 2.5px;
  border-radius: 50%;
  background: var(--admin-text-subtle);
  opacity: 0.4;
}

.balance-bars {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  width: 100%;
  height: 100%;
}

@keyframes growBalanceBar {
  0% {
    transform: scaleY(0.08);
    opacity: 0.15;
  }
  65% {
    transform: scaleY(1.15);
  }
  100% {
    transform: scaleY(1);
    opacity: 0.85;
  }
}

.balance-bar {
  width: 5px;
  border-radius: 2px 2px 0 0;
  opacity: 0.85;
  transform-origin: bottom;
  animation: growBalanceBar 520ms cubic-bezier(0.16, 1, 0.3, 1) both;
  transition: opacity 150ms ease;
}

.balance-bar:hover {
  opacity: 1;
}

/* 分段比例条 */
.segmented-bar {
  display: flex;
  height: 6px;
  border-radius: 3px;
  overflow: hidden;
  margin: 6px 0 14px;
  gap: 1.5px;
}

@keyframes expandSegment {
  0% {
    transform: scaleX(0);
    opacity: 0.2;
  }
  100% {
    transform: scaleX(1);
    opacity: 1;
  }
}

.segmented-bar__segment {
  height: 100%;
  border-radius: 1px;
  transform-origin: left center;
  animation: expandSegment 650ms cubic-bezier(0.16, 1, 0.3, 1) both;
}

/* 分类列表 */
.category-list {
  display: flex;
  flex-direction: column;
  gap: 7px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.category-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 11px;
}

.category-item__left {
  display: flex;
  align-items: center;
  gap: 8px;
}

.category-item__square {
  width: 8px;
  height: 8px;
  border-radius: 2px;
  flex-shrink: 0;
}

.category-item__name {
  color: var(--admin-text);
  font-weight: 500;
}

.category-item__right {
  display: flex;
  align-items: baseline;
  gap: 8px;
}

.category-item__amount {
  color: var(--admin-text);
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.category-item__percent {
  color: var(--admin-text-subtle);
  font-size: 10px;
  min-width: 24px;
  text-align: right;
}

@media (max-width: 900px) {
  .left-bottom-grid {
    grid-template-columns: 1fr;
  }
}
</style>
