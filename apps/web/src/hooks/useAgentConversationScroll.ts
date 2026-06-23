import type { ComputedRef, CSSProperties, Ref } from 'vue'

import { computed, nextTick, onUnmounted, ref, watch } from 'vue'

interface UseAgentConversationScrollOptions {
  containerRef: Ref<HTMLElement | null>
  activeTurnId: ComputedRef<string | undefined>
  activeTurnSignature: ComputedRef<string>
  enabled: ComputedRef<boolean>
}

interface ConversationScrollMetrics {
  anchorTop: number
  baseScrollHeight: number
  viewport: HTMLElement
}

const ACTIVE_TURN_TOP_RATIO = 0.42
const SCROLLABLE_TOLERANCE_PX = 2

/**
 * 将最新一轮 AI 回复区域锚定在对话视口中部偏上的位置。
 *
 * 这个 hook 只负责展示层滚动：首次对话保持自然布局；历史内容溢出后，
 * 最新一轮 loading、成功、错误状态共用同一个 active turn 锚点。
 */
export function useAgentConversationScroll(options: UseAgentConversationScrollOptions) {
  const activeTopSpacerHeight = ref(0)
  const activeBottomSpacerHeight = ref(0)

  const activeTopSpacerStyle = computed<CSSProperties>(() => ({
    height: `${activeTopSpacerHeight.value}px`,
  }))

  const activeBottomSpacerStyle = computed<CSSProperties>(() => ({
    height: `${activeBottomSpacerHeight.value}px`,
  }))

  let alignmentRunId = 0
  let resizeObserver: ResizeObserver | undefined
  let observedViewport: HTMLElement | undefined

  async function alignActiveTurn() {
    if (!options.enabled.value) {
      resetSpacers()
      return
    }

    const activeTurnId = options.activeTurnId.value

    if (!activeTurnId) {
      resetSpacers()
      return
    }

    const runId = ++alignmentRunId

    await waitForLayout()

    if (!isCurrentAlignment(runId))
      return

    const metrics = readMetrics(activeTurnId)

    if (!metrics)
      return

    bindViewportResizeObserver(metrics.viewport)

    if (!isContentScrollable(metrics)) {
      resetSpacers()
      return
    }

    const targetTop = metrics.viewport.clientHeight * ACTIVE_TURN_TOP_RATIO
    const nextTopSpacerHeight = Math.max(0, targetTop - metrics.anchorTop)
    const adjustedAnchorTop = metrics.anchorTop + nextTopSpacerHeight
    const adjustedScrollHeight = metrics.baseScrollHeight + nextTopSpacerHeight
    const adjustedMaxScrollTop = Math.max(0, adjustedScrollHeight - metrics.viewport.clientHeight)
    const targetScrollTop = Math.max(0, adjustedAnchorTop - targetTop)
    const nextBottomSpacerHeight = Math.max(0, targetScrollTop - adjustedMaxScrollTop)
    const finalMaxScrollTop = adjustedMaxScrollTop + nextBottomSpacerHeight

    activeTopSpacerHeight.value = Math.ceil(nextTopSpacerHeight)
    activeBottomSpacerHeight.value = Math.ceil(nextBottomSpacerHeight)
    await waitForLayout()

    if (!isCurrentAlignment(runId))
      return

    const finalTargetScrollTop = clampScrollTop(targetScrollTop, finalMaxScrollTop)

    metrics.viewport.scrollTo({
      top: finalTargetScrollTop,
      behavior: 'auto',
    })
  }

  function readMetrics(activeTurnId: string): ConversationScrollMetrics | null {
    const viewport = getScrollViewport()
    const anchor = getActiveTurnAnchor(activeTurnId)

    if (!viewport || !anchor)
      return null

    const viewportRect = viewport.getBoundingClientRect()
    const anchorRect = anchor.getBoundingClientRect()
    const currentTopSpacerHeight = activeTopSpacerHeight.value
    const currentBottomSpacerHeight = activeBottomSpacerHeight.value
    const anchorTop = anchorRect.top - viewportRect.top + viewport.scrollTop - currentTopSpacerHeight

    return {
      anchorTop,
      baseScrollHeight: Math.max(0, viewport.scrollHeight - currentTopSpacerHeight - currentBottomSpacerHeight),
      viewport,
    }
  }

  function getScrollViewport() {
    return options.containerRef.value?.querySelector<HTMLElement>('[data-slot="scroll-area-viewport"]') ?? null
  }

  function getActiveTurnAnchor(activeTurnId: string) {
    const anchors = Array.from(
      options.containerRef.value?.querySelectorAll<HTMLElement>('[data-agent-active-turn-anchor="true"]') ?? [],
    )

    return anchors.find(anchor => anchor.dataset.agentTurnId === activeTurnId) ?? null
  }

  function bindViewportResizeObserver(viewport: HTMLElement) {
    if (!('ResizeObserver' in window))
      return

    if (observedViewport === viewport)
      return

    resizeObserver?.disconnect()
    observedViewport = viewport
    resizeObserver = new ResizeObserver(() => {
      void alignActiveTurn()
    })
    resizeObserver.observe(viewport)
  }

  function resetSpacers() {
    activeTopSpacerHeight.value = 0
    activeBottomSpacerHeight.value = 0
  }

  function isCurrentAlignment(runId: number) {
    return runId === alignmentRunId && options.enabled.value && Boolean(options.activeTurnId.value)
  }

  function isContentScrollable(metrics: ConversationScrollMetrics) {
    return metrics.baseScrollHeight - metrics.viewport.clientHeight > SCROLLABLE_TOLERANCE_PX
  }

  function clampScrollTop(value: number, maxScrollTop: number) {
    return Math.min(Math.max(0, value), maxScrollTop)
  }

  async function waitForLayout() {
    await nextTick()
    await new Promise<void>((resolve) => {
      window.requestAnimationFrame(() => resolve())
    })
  }

  watch(
    [
      () => options.activeTurnSignature.value,
      () => options.enabled.value,
      () => options.containerRef.value,
    ],
    () => {
      void alignActiveTurn()
    },
    {
      flush: 'post',
      immediate: true,
    },
  )

  onUnmounted(() => {
    resizeObserver?.disconnect()
    observedViewport = undefined
    alignmentRunId += 1
  })

  return {
    activeTopSpacerHeight,
    activeTopSpacerStyle,
    activeBottomSpacerHeight,
    activeBottomSpacerStyle,
  }
}
