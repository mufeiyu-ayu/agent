<script setup lang="ts">
import type { Directive } from 'vue'
import type { TurnRun } from '../../types/chat'

import { computed, provide, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import { useRunStatus } from '@/hooks/useRunStatus'
import { FADE_INITIAL_TEXT } from '@/hooks/useStreamingMarkdown'
import { RUN_DOT_PX as ICON_PX, useTrailingDot } from '@/hooks/useTrailingDot'
import { runStatusText, runSummaryText, thoughtTitle } from '@/utils/run-status'

import AgentRunTimeline from './AgentRunTimeline.vue'

const props = defineProps<{
  run?: TurnRun
  /** 已发出、还没收到 start：只有呼吸点。 */
  waiting: boolean
}>()

/** 流光与呼吸点的周期：所有实例按同一个时钟走，换字、重新挂载时接着当前相位，不从头开始。 */
const PULSE_PERIOD_MS = 2400
/** 状态行上方留 4px，让 32px 高的行中线对齐 40px 头像的中线；呼吸点在图标位时就在这一格里（与 CSS 一致）。 */
const ROW_TOP_PX = 4
const ROW_HEIGHT_PX = 32
const ICON_TOP_PX = ROW_TOP_PX + (ROW_HEIGHT_PX - ICON_PX) / 2
/** 浮层文字离右边不够这么宽就换到下一行行首。 */
const FLOAT_MIN_WIDTH_PX = 160
const FLOAT_LINE_PX = 26

const { t, locale } = useI18n()
const { hasRow, live, floating, shownKey, shownStep, shownThought, seconds, dotVisible, dotTrailing } = useRunStatus(() => props.run, () => props.waiting)
/**
 * 挂载时就已结束（刷新后还原、切换会话再切回，#212）：直接显示定稿的摘要，
 * 不播摘要淡入与勾的描绘，看起来和离开前一样。
 */
const settledAtMount = props.run?.phase === 'ended'
// 挂载时还在等待：之后出现的正文是实时流刚放出的，第一段也要渐显（#214）。
provide(FADE_INITIAL_TEXT, !!props.waiting)

const vPulseSync: Directive<HTMLElement | SVGElement> = {
  mounted(el) {
    el.style.animationDelay = `-${Math.round(performance.now() % PULSE_PERIOD_MS)}ms`
  },
}

const liveText = computed(() => runStatusText(shownStep.value, t, shownThought.value))
const liveKey = computed(() => `live:${shownKey.value}:${locale.value}`)
const summary = computed(() => props.run && runSummaryText(props.run, t))
const summaryKey = computed(() => `summary:${JSON.stringify(summary.value)}`)
/** 结束图标：正常完成打勾；有失败步骤或出错用提示；用户停止用停止符号。 */
const endIcon = computed(() => {
  const run = props.run

  if (run?.outcome === 'aborted')
    return 'stop'

  return run?.outcome === 'error' || run?.steps.some(step => step.status === 'failed') ? 'warn' : 'check'
})
/** 摘要定稿（done / error / aborted）且有工具步骤或思考原文才能展开。 */
const hasWorkspaceSteps = computed(() => props.run?.steps.some(step => step.workspace) ?? false)
const expandable = computed(() => !!props.run && (props.run.phase === 'ended' || hasWorkspaceSteps.value)
  && (props.run.steps.length > 0 || props.run.thoughts.some(thought => thoughtTitle(thought.text))))
const expanded = ref(false)
let manuallyToggled = false
watch(hasWorkspaceSteps, (has) => {
  if (has && !settledAtMount && !manuallyToggled)
    expanded.value = true
})

function toggle() {
  if (expandable.value) {
    manuallyToggled = true
    expanded.value = !expanded.value
  }
}

/** 呼吸点挂上后就不再卸载（start 前就停止或出错时也要淡出）；挂载时已结束的轮次始终不挂。 */
const dotMounted = ref((!!props.run && !settledAtMount) || props.waiting)

watch(() => (!!props.run && props.run.phase !== 'ended') || props.waiting, (active) => {
  if (active)
    dotMounted.value = true
})

// ---------- 尾点：没有状态行时跟在正文最后一个字后面（位置由 useTrailingDot 量） ----------
const rootRef = ref<HTMLElement>()
const contentRef = ref<HTMLElement>()
// 浮层只在呼吸点可见时出现，所以只看呼吸点。
const trail = useTrailingDot(rootRef, contentRef, () => dotTrailing.value && dotVisible.value)

const dotStyle = computed(() => {
  const at = dotTrailing.value && trail.value
    ? { x: trail.value.x - ICON_PX / 2, y: trail.value.y - ICON_PX / 2 }
    : { x: 0, y: ICON_TOP_PX }

  return { transform: `translate(${at.x}px, ${at.y}px)` }
})

/** 浮层文字放在尾点右边、与尾点同一中线；右边放不下就换到下一行行首。 */
const floatStyle = computed(() => {
  if (!trail.value)
    return undefined

  const width = rootRef.value?.clientWidth ?? 0
  const besideDot = trail.value.x + ICON_PX / 2 + 4
  const wrap = width - besideDot < FLOAT_MIN_WIDTH_PX
  const left = wrap ? 0 : besideDot
  const top = trail.value.y - ROW_HEIGHT_PX / 2 + (wrap ? FLOAT_LINE_PX : 0)

  return { transform: `translate(${left}px, ${top}px)`, maxWidth: `${width - left}px` }
})
</script>

<template>
  <div ref="rootRef" class="agent-run">
    <div
      v-if="hasRow"
      class="run-row"
      data-run-row
      :class="{ 'is-settled': !live, 'is-expandable': expandable }"
      :role="expandable ? 'button' : undefined"
      :tabindex="expandable ? 0 : undefined"
      :aria-expanded="expandable ? expanded : undefined"
      @click="toggle"
      @keydown.enter.space.prevent="toggle"
    >
      <span class="run-icon">
        <Transition name="run-icon">
          <svg
            v-if="!live && run"
            :key="endIcon"
            class="run-icon-svg"
            :class="[`is-${endIcon}`, { 'is-static': settledAtMount }]"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2.2"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <circle cx="12" cy="12" r="9" :opacity="endIcon === 'warn' ? 0.3 : 0.22" />
            <path v-if="endIcon === 'warn'" d="M12 8v5M12 16.5v.01" />
            <rect v-else-if="endIcon === 'stop'" x="9" y="9" width="6" height="6" rx="1" fill="currentColor" stroke="none" />
            <path v-else class="run-check-path" d="M8.5 12.5l2.5 2.5 4.5-5" />
          </svg>
        </Transition>
      </span>
      <span class="run-text" role="status">
        <Transition name="run-swap" :appear="!settledAtMount">
          <!-- 思考短句每一两秒换一句，不进读屏播报（aria-hidden），只播步骤与阶段变化 -->
          <span v-if="live" :key="liveKey" class="run-text-item is-live" data-run-text>
            <span v-pulse-sync class="run-label is-live" :aria-hidden="shownThought ? 'true' : undefined">{{ liveText.label }}<b v-if="liveText.object">{{ ` ${liveText.object}` }}</b></span>
            <!-- 计时每秒变一次，不进读屏播报 -->
            <span class="run-meta" :class="{ 'is-pending': seconds < 1 }" aria-hidden="true">{{ t('conversation.run.seconds', { n: seconds }) }}</span>
          </span>
          <span v-else-if="summary" :key="summaryKey" class="run-text-item" data-run-text>
            <span class="run-label">{{ summary.label }}</span>
            <span v-if="summary.meta" class="run-meta">{{ summary.meta }}</span>
            <span v-if="summary.warning" class="run-meta is-warning">{{ summary.warning }}</span>
          </span>
        </Transition>
      </span>
      <Transition name="run-icon">
        <svg
          v-if="expandable"
          class="run-chevron"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <path d="M9 6l6 6-6 6" />
        </svg>
      </Transition>
    </div>

    <!-- 只在有状态行时存在（点状态行才能展开）；收起时 inert：看不见的步骤行与链接不能被 Tab 聚焦，也不被读屏读到 -->
    <div v-if="hasRow && expandable && run" class="run-grow" :class="{ 'is-open': expanded }" :inert="!expanded">
      <div>
        <AgentRunTimeline :run="run" />
      </div>
    </div>

    <div ref="contentRef">
      <slot />
    </div>

    <!--
      隐藏时只淡出、暂停动画，不卸载：done 之后正文还会收尾放字，
      淡出途中尾点仍要跟着字走，而离场过渡中的元素 Vue 不再更新。
    -->
    <span
      v-if="dotMounted"
      class="run-dot"
      data-run-dot
      :class="{ 'is-visible': dotVisible }"
      :style="dotStyle"
      aria-hidden="true"
    >
      <svg :width="ICON_PX" :height="ICON_PX" viewBox="0 0 16 16"><circle v-pulse-sync cx="8" cy="8" r="3.4" fill="currentColor" /></svg>
    </span>

    <!-- 浮层整体淡入淡出；里面换字与状态行一样交叉淡化 -->
    <Transition name="run-swap">
      <span v-if="floating && trail" class="run-float" :style="floatStyle" role="status">
        <Transition name="run-swap">
          <span :key="liveKey" class="run-text-item is-live">
            <span v-pulse-sync class="run-label is-live" :aria-hidden="shownThought ? 'true' : undefined">{{ liveText.label }}<b v-if="liveText.object">{{ ` ${liveText.object}` }}</b></span>
          </span>
        </Transition>
      </span>
    </Transition>
  </div>
</template>

<style scoped>
@property --run-shine {
  syntax: '<color>';
  inherits: true;
  initial-value: transparent;
}

.agent-run {
  --run-ease-out: cubic-bezier(0.22, 0.8, 0.24, 1);
  --run-ease-in-out: cubic-bezier(0.45, 0, 0.25, 1);
  /* 流光高光色：状态行与尾点旁的浮层共用，摘要定稿时状态行里过渡到正文色 */
  --run-shine: var(--agent-ink);

  position: relative;
  /* 挡住状态行的 margin-top 穿透出去：否则状态行出现时整个根元素下移，浮层里的呼吸点跟着跳 */
  display: flow-root;
}

/* ---------- 状态行：「图标 + 一段文字」，计时 / 结果写在文字末尾，右侧不放独立元素 ---------- */
.run-row {
  display: grid;
  grid-template-columns: 16px minmax(0, auto);
  align-items: center;
  column-gap: 10px;
  width: fit-content;
  max-width: 100%;
  height: 32px;
  margin: 4px 0 6px;
  border-radius: 8px;
  color: var(--agent-ink-soft);
  font-size: 14px;
  font-weight: 400;
  transition: --run-shine 0.5s var(--run-ease-out), color 0.45s var(--run-ease-out);
}

.run-row.is-settled {
  --run-shine: var(--agent-ink-muted);

  color: var(--agent-ink-muted);
}

.run-row.is-expandable {
  grid-template-columns: 16px minmax(0, auto) 14px;
  cursor: pointer;
}

.run-row.is-expandable:hover {
  color: var(--agent-ink);
}

.run-row:focus-visible {
  outline: 2px solid color-mix(in oklch, var(--agent-copper) 45%, transparent);
  outline-offset: 2px;
}

.run-icon,
.run-text {
  display: grid;
  align-items: center;
  min-width: 0;
}

.run-icon {
  justify-items: center;
}

/* 新旧文字叠在同一格里交叉淡化，不出这一行、不位移 */
.run-text {
  height: 32px;
  overflow: hidden;
  justify-items: start;
}

.run-icon > *,
.run-text > * {
  grid-area: 1 / 1;
  min-width: 0;
}

.run-text-item {
  max-width: 100%;
  overflow: hidden;
  line-height: 32px;
  text-overflow: ellipsis;
  white-space: nowrap;
  /* 常驻合成层：动画开始 / 结束时字形渲染不切换，不会闪一下 */
  will-change: opacity;
}

/* 进行中：文字过长（思考短句）时只省略文字本身，末尾的计时照常显示；摘要仍整体从末尾省略 */
.run-text-item.is-live {
  display: flex;
}

.run-text-item.is-live .run-label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

.run-text-item.is-live .run-meta {
  flex: none;
}

.run-label b {
  font-weight: 500;
}

/* 流光只作用在动作文字上；全局同一时钟（v-pulse-sync），换字时高光接着走 */
.run-label.is-live {
  background: linear-gradient(
    90deg,
    var(--agent-ink-muted) 0%,
    var(--agent-ink-muted) 38%,
    var(--run-shine) 50%,
    var(--agent-ink-muted) 62%,
    var(--agent-ink-muted) 100%
  );
  background-size: 260% 100%;
  background-clip: text;
  -webkit-background-clip: text;
  color: transparent;
  animation: run-shimmer 2.4s linear infinite;
}

.run-label.is-live b {
  color: transparent;
}

.run-meta {
  color: var(--agent-ink-faint);
  font-variant-numeric: tabular-nums;
  transition: opacity 0.3s var(--run-ease-out);
}

.run-meta::before {
  content: '·';
  margin: 0 0.5em;
}

.run-meta.is-pending {
  opacity: 0;
}

.run-meta.is-warning {
  color: var(--agent-accent);
}

/* 换字：旧字线性淡出 0.28s，40ms 后新字线性淡入 0.28s（最暗时两段总不透明度约 0.86） */
.run-swap-enter-active {
  transition: opacity 0.28s linear 0.04s;
}

.run-swap-leave-active {
  transition: opacity 0.28s linear;
}

.run-swap-enter-from,
.run-swap-leave-to {
  opacity: 0;
}

/* 图标：呼吸点与勾交叉淡化，勾用描边画出来 */
.run-icon-svg {
  display: block;
  width: 16px;
  height: 16px;
}

.run-icon-svg.is-check {
  color: var(--agent-moss);
}

.run-icon-svg.is-warn {
  color: var(--agent-accent);
}

.run-icon-svg.is-stop {
  color: var(--agent-ink-faint);
}

.run-check-path {
  stroke-dasharray: 12;
  animation: run-check-draw 0.38s var(--run-ease-out) 0.08s both;
}

.run-icon-svg.is-static .run-check-path {
  animation: none;
}

.run-chevron {
  width: 14px;
  height: 14px;
  color: var(--agent-ink-faint);
  transition: transform 0.26s var(--run-ease-out), opacity 0.4s var(--run-ease-out);
}

.run-row[aria-expanded='true'] .run-chevron {
  transform: rotate(90deg);
}

.run-icon-enter-active,
.run-icon-leave-active {
  transition: opacity 0.3s var(--run-ease-out), transform 0.3s var(--run-ease-out);
}

.run-icon-enter-from {
  opacity: 0;
  transform: scale(0.85);
}

.run-icon-leave-to {
  opacity: 0;
  transform: scale(0.7);
}

/* 展开 / 收起：高度平滑过渡，只在用户点击时动 */
.run-grow {
  display: grid;
  grid-template-rows: 0fr;
  opacity: 0;
  transition: grid-template-rows 0.36s var(--run-ease-in-out), opacity 0.3s var(--run-ease-out);
}

.run-grow.is-open {
  grid-template-rows: 1fr;
  opacity: 1;
}

.run-grow > div {
  min-height: 0;
  overflow: hidden;
}

/* ---------- 呼吸点：浮层，不参与排版；在图标位或正文末尾 ---------- */
.run-dot {
  position: absolute;
  top: 0;
  left: 0;
  width: 16px;
  height: 16px;
  color: var(--agent-copper);
  pointer-events: none;
  opacity: 0;
  transition: opacity 0.3s var(--run-ease-out);
}

.run-dot.is-visible {
  opacity: 1;
}

.run-dot svg {
  display: block;
  overflow: visible;
  transition: transform 0.3s var(--run-ease-out);
}

.run-dot:not(.is-visible) svg {
  transform: scale(0.7);
}

/* 隐藏后动画暂停：结束的轮次不再每帧跑呼吸动画 */
.run-dot:not(.is-visible) circle {
  animation-play-state: paused;
}

.run-dot circle {
  transform-box: fill-box;
  transform-origin: center;
  animation: run-breathe 2.4s var(--run-ease-in-out) infinite;
}

/* 正文开始后才调工具：进度写在尾点旁，不插状态行 */
.run-float {
  position: absolute;
  top: 0;
  left: 0;
  display: grid;
  height: 32px;
  overflow: hidden;
  color: var(--agent-ink-soft);
  font-size: 14px;
  pointer-events: none;
}

.run-float > * {
  grid-area: 1 / 1;
}

@keyframes run-shimmer {
  from { background-position: 100% 0; }
  to { background-position: 0% 0; }
}

@keyframes run-breathe {
  0%, 100% { opacity: 0.45; transform: scale(0.8); }
  50% { opacity: 1; transform: scale(1); }
}

@keyframes run-check-draw {
  from { stroke-dashoffset: 12; }
  to { stroke-dashoffset: 0; }
}

@media (prefers-reduced-motion: reduce) {
  .agent-run *,
  .agent-run *::before,
  .agent-run *::after {
    animation: none !important;
    transition: none !important;
  }

  .run-label.is-live {
    background: none;
    color: var(--agent-ink-muted);
  }

  .run-label.is-live b {
    color: inherit;
  }
}
</style>
