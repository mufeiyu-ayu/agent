<script setup lang="ts">
import type { OverviewKpiStats, OverviewSparklines } from '../mock-data'
import { MoreOutlined } from '@ant-design/icons-vue'
import { Card } from 'ant-design-vue'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import { formatTokens } from '@/features/runs/run.utils'

const props = defineProps<{
  kpi: OverviewKpiStats
  sparklines: OverviewSparklines
  loading?: boolean
}>()

const { locale } = useI18n()

// 计算 Sparkline SVG 路径
const sparklinePath = computed(() => {
  const data = props.sparklines.sparkline
  if (!data.length)
    return ''
  const max = Math.max(...data)
  const min = Math.min(...data)
  const range = max - min || 1
  const width = 110
  const height = 28

  const points = data.map((val, idx) => {
    const x = (idx / (data.length - 1)) * width
    const y = height - ((val - min) / range) * (height - 6) - 3
    return `${x},${y}`
  })

  return `M ${points.join(' L ')}`
})

const sparklineArea = computed(() => {
  if (!sparklinePath.value)
    return ''
  return `${sparklinePath.value} L 110,28 L 0,28 Z`
})
</script>

<template>
  <Card class="kpi-block-card" :bordered="false">
    <div class="kpi-block-card__head">
      <h2 class="kpi-block-card__title">
        Agent 执行大盘
      </h2>
      <button class="kpi-block-card__more-btn" aria-label="More options">
        <MoreOutlined />
      </button>
    </div>

    <div class="kpi-block-card__grid">
      <!-- 指标 1: 运行成功率 (带彩色心跳微细柱状图) -->
      <div class="kpi-metric">
        <span class="kpi-metric__label">RUN SUCCESS RATE</span>
        <div class="kpi-metric__val-wrap">
          <strong class="kpi-metric__value">{{ props.kpi.successRate }}%</strong>
        </div>

        <div class="kpi-heartbeat">
          <div class="kpi-heartbeat__bars">
            <span
              v-for="(h, idx) in props.sparklines.heartbeat"
              :key="idx"
              class="kpi-heartbeat__bar"
              :class="{
                'is-warn': idx === 3,
                'is-alert': idx === 7,
              }"
              :style="{ height: `${h}px`, animationDelay: `${idx * 22}ms` }"
            />
          </div>
          <div class="kpi-indicator is-heartbeat">
            ▼
          </div>
        </div>
      </div>

      <!-- 指标 2: 均单 Run 消耗 (带渐变滑块条) -->
      <div class="kpi-metric">
        <span class="kpi-metric__label">AVG TOKENS / RUN</span>
        <div class="kpi-metric__val-wrap">
          <strong class="kpi-metric__value">{{ formatTokens(props.kpi.avgTokensPerRun, locale) }}</strong>
        </div>

        <div class="kpi-slider-wrap">
          <div class="kpi-gradient-bar" />
          <div class="kpi-indicator is-slider">
            ▼
          </div>
        </div>
      </div>

      <!-- 指标 3: 运行总数 (带上扬微折线 Sparkline) -->
      <div class="kpi-metric">
        <span class="kpi-metric__label">TOTAL DELIVERIES</span>
        <div class="kpi-metric__val-wrap">
          <strong class="kpi-metric__value">{{ props.kpi.runCount.toLocaleString(locale) }}</strong>
          <span class="kpi-metric__growth">↑ 12.4%</span>
        </div>

        <div class="kpi-sparkline-wrap">
          <svg class="kpi-sparkline" viewBox="0 0 110 28" preserveAspectRatio="none">
            <defs>
              <linearGradient id="sparklineGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stop-color="#10b981" stop-opacity="0.3" />
                <stop offset="100%" stop-color="#10b981" stop-opacity="0.0" />
              </linearGradient>
            </defs>
            <path :d="sparklineArea" fill="url(#sparklineGrad)" />
            <path class="sparkline-line" :d="sparklinePath" fill="none" stroke="#10b981" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
            <circle cx="110" cy="5" r="2.5" fill="#10b981" />
          </svg>
        </div>
      </div>
    </div>
  </Card>
</template>

<style scoped>
.kpi-block-card {
  border: 1px solid var(--admin-border);
  background: var(--admin-surface);
  box-shadow: var(--admin-shadow-sm);
  border-radius: 12px;
  transition: border-color 200ms ease, box-shadow 200ms ease;
}

.kpi-block-card:hover {
  border-color: var(--admin-border-strong);
  box-shadow: var(--admin-shadow-md);
}

.kpi-block-card :deep(.ant-card-body) {
  padding: 16px 20px;
}

.kpi-block-card__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}

.kpi-block-card__title {
  margin: 0;
  color: var(--admin-text);
  font-size: 16px;
  font-weight: 700;
  letter-spacing: -0.01em;
}

.kpi-block-card__more-btn {
  background: transparent;
  border: none;
  color: var(--admin-text-subtle);
  cursor: pointer;
  font-size: 14px;
  padding: 2px 4px;
}

.kpi-block-card__grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 20px;
}

.kpi-metric {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.kpi-metric__label {
  color: var(--admin-text-subtle);
  font-size: 10px;
  font-weight: 650;
  letter-spacing: 0.05em;
  text-transform: uppercase;
}

.kpi-metric__val-wrap {
  display: flex;
  align-items: baseline;
  gap: 6px;
  margin: 4px 0 8px;
}

.kpi-metric__value {
  color: var(--admin-text);
  font-size: 24px;
  font-weight: 750;
  letter-spacing: -0.03em;
  font-variant-numeric: tabular-nums;
  line-height: 1.1;
}

.kpi-metric__growth {
  color: #10b981;
  font-size: 11px;
  font-weight: 600;
}

/* 微心跳柱状条 */
.kpi-heartbeat {
  position: relative;
  display: flex;
  align-items: flex-end;
  height: 24px;
}

.kpi-heartbeat__bars {
  display: flex;
  align-items: flex-end;
  gap: 2.5px;
  height: 100%;
}

@keyframes growBar {
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

.kpi-heartbeat__bar {
  width: 3.5px;
  border-radius: 1px;
  background: #10b981;
  opacity: 0.85;
  transform-origin: bottom;
  animation: growBar 520ms cubic-bezier(0.16, 1, 0.3, 1) both;
}

.kpi-heartbeat__bar.is-warn {
  background: #f59e0b;
}

.kpi-heartbeat__bar.is-alert {
  background: #f43f5e;
}

/* 渐变进度滑块 */
.kpi-slider-wrap {
  position: relative;
  height: 24px;
  display: flex;
  align-items: center;
}

.kpi-gradient-bar {
  width: 100%;
  height: 6px;
  border-radius: 3px;
  background: linear-gradient(90deg, #f59e0b 0%, #eab308 25%, #10b981 75%, #059669 100%);
}

@keyframes slideIndicator {
  0% {
    opacity: 0;
    transform: translateX(-14px);
  }
  100% {
    opacity: 1;
    transform: translateX(0);
  }
}

/* 指示小三角 */
.kpi-indicator {
  position: absolute;
  top: -6px;
  font-size: 8px;
  color: var(--admin-text-subtle);
  line-height: 1;
  animation: slideIndicator 600ms cubic-bezier(0.16, 1, 0.3, 1) both;
}

.kpi-indicator.is-heartbeat {
  left: 78%;
}

.kpi-indicator.is-slider {
  left: 88%;
}

/* Sparkline 折线图 */
.kpi-sparkline-wrap {
  height: 24px;
  width: 100%;
}

@keyframes drawSparkline {
  0% {
    stroke-dashoffset: 200;
    opacity: 0;
  }
  100% {
    stroke-dashoffset: 0;
    opacity: 1;
  }
}

.sparkline-line {
  stroke-dasharray: 200;
  stroke-dashoffset: 0;
  animation: drawSparkline 750ms cubic-bezier(0.16, 1, 0.3, 1) both;
}

.kpi-sparkline {
  width: 100%;
  height: 100%;
  overflow: visible;
}

@media (max-width: 768px) {
  .kpi-block-card__grid {
    grid-template-columns: 1fr;
    gap: 12px;
  }
}
</style>
