import type { ComputedRef, Ref } from 'vue'

import { nextTick, onUnmounted, watch } from 'vue'

interface UseAgentConversationScrollOptions {
  viewportRef: Ref<HTMLElement | null>
  activeTurnId: ComputedRef<string | undefined>
  activeTurnSignature: ComputedRef<string>
  enabled: ComputedRef<boolean>
}

const BOTTOM_THRESHOLD_PX = 96

/**
 * 新一轮开始时定位到用户消息；流式输出只在用户仍停留在底部时自动跟随。
 */
export function useAgentConversationScroll(options: UseAgentConversationScrollOptions) {
  let alignmentRunId = 0
  let shouldFollowLatest = true
  let lastScrollTop = 0
  let observedViewport: HTMLElement | undefined
  let removeScrollListener: (() => void) | undefined

  function bindScrollListener() {
    const viewport = options.viewportRef.value

    if (observedViewport === viewport)
      return

    removeScrollListener?.()
    observedViewport = viewport ?? undefined

    if (!viewport)
      return

    lastScrollTop = viewport.scrollTop
    let lastTouchY: number | undefined

    const handleScroll = () => {
      const nextScrollTop = viewport.scrollTop

      if (nextScrollTop < lastScrollTop)
        shouldFollowLatest = false
      else if (isNearBottom(viewport))
        shouldFollowLatest = true

      lastScrollTop = nextScrollTop
    }

    const handleWheel = (event: WheelEvent) => {
      if (event.deltaY < 0)
        shouldFollowLatest = false
    }

    const handleTouchStart = (event: TouchEvent) => {
      lastTouchY = event.touches[0]?.clientY
    }

    const handleTouchMove = (event: TouchEvent) => {
      const nextTouchY = event.touches[0]?.clientY

      if (lastTouchY !== undefined && nextTouchY !== undefined && nextTouchY > lastTouchY)
        shouldFollowLatest = false

      lastTouchY = nextTouchY
    }

    const handleTouchEnd = () => {
      lastTouchY = undefined
    }

    viewport.addEventListener('scroll', handleScroll, { passive: true })
    viewport.addEventListener('wheel', handleWheel, { passive: true })
    viewport.addEventListener('touchstart', handleTouchStart, { passive: true })
    viewport.addEventListener('touchmove', handleTouchMove, { passive: true })
    viewport.addEventListener('touchend', handleTouchEnd, { passive: true })
    viewport.addEventListener('touchcancel', handleTouchEnd, { passive: true })
    removeScrollListener = () => {
      viewport.removeEventListener('scroll', handleScroll)
      viewport.removeEventListener('wheel', handleWheel)
      viewport.removeEventListener('touchstart', handleTouchStart)
      viewport.removeEventListener('touchmove', handleTouchMove)
      viewport.removeEventListener('touchend', handleTouchEnd)
      viewport.removeEventListener('touchcancel', handleTouchEnd)
    }
  }

  async function alignActiveTurn() {
    const activeTurnId = options.activeTurnId.value

    if (!options.enabled.value || !activeTurnId)
      return

    const runId = ++alignmentRunId

    await waitForLayout()

    if (!isCurrentAlignment(runId, activeTurnId))
      return

    bindScrollListener()

    const viewport = options.viewportRef.value
    const anchor = findUserTurnAnchor(viewport, activeTurnId)

    if (!viewport || !anchor)
      return

    const viewportRect = viewport.getBoundingClientRect()
    const anchorRect = anchor.getBoundingClientRect()
    const targetTop = viewport.scrollTop + anchorRect.top - viewportRect.top - 16

    shouldFollowLatest = true
    scrollViewport(viewport, targetTop)
  }

  async function followActiveTurn() {
    const activeTurnId = options.activeTurnId.value

    if (!options.enabled.value || !activeTurnId || !shouldFollowLatest)
      return

    const runId = alignmentRunId

    await waitForLayout()

    if (!isCurrentAlignment(runId, activeTurnId) || !shouldFollowLatest)
      return

    const viewport = options.viewportRef.value

    if (viewport)
      scrollViewport(viewport, viewport.scrollHeight)
  }

  function scrollViewport(viewport: HTMLElement, top: number) {
    viewport.scrollTo({ top, behavior: 'auto' })
    lastScrollTop = viewport.scrollTop
  }

  function findUserTurnAnchor(viewport: HTMLElement | null, activeTurnId: string) {
    const anchors = Array.from(
      viewport?.querySelectorAll<HTMLElement>('[data-agent-user-turn-id]') ?? [],
    )

    return anchors.find(anchor => anchor.dataset.agentUserTurnId === activeTurnId) ?? null
  }

  function isCurrentAlignment(runId: number, activeTurnId: string) {
    return runId === alignmentRunId
      && options.enabled.value
      && options.activeTurnId.value === activeTurnId
  }

  function isNearBottom(viewport: HTMLElement) {
    return viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight <= BOTTOM_THRESHOLD_PX
  }

  async function waitForLayout() {
    await nextTick()
    await new Promise<void>((resolve) => {
      window.requestAnimationFrame(() => resolve())
    })
  }

  watch(
    [
      () => options.activeTurnId.value,
      () => options.enabled.value,
      () => options.viewportRef.value,
    ],
    () => {
      bindScrollListener()
      void alignActiveTurn()
    },
    { flush: 'post', immediate: true },
  )

  watch(
    () => options.activeTurnSignature.value,
    () => void followActiveTurn(),
    { flush: 'post' },
  )

  onUnmounted(() => {
    removeScrollListener?.()
    observedViewport = undefined
    alignmentRunId += 1
  })
}
