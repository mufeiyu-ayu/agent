import type { ComputedRef, Ref } from 'vue'

import { onUnmounted, ref, watch } from 'vue'

interface UseAgentConversationScrollOptions {
  viewportRef: Ref<HTMLElement | null>
  activeTurnId: ComputedRef<string | undefined>
  anchorLatestTurn: ComputedRef<boolean>
  conversationId: ComputedRef<string | null>
  isRestoringScroll: Ref<boolean>
}

const BOTTOM_THRESHOLD_PX = 48

/** 新轮定点阅读；用户主动到底后才跟随。以实际布局而非 token 到达驱动滚动。 */
export function useAgentConversationScroll(options: UseAgentConversationScrollOptions) {
  const isNearBottom = ref(true)
  let shouldFollowLatest = false
  let alignPending = false
  let lastScrollTop = 0
  let lastClientHeight = 0
  let frame: number | undefined
  let unbind: (() => void) | undefined

  function nearBottom(viewport: HTMLElement) {
    return viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight <= BOTTOM_THRESHOLD_PX
  }

  function scheduleLayout() {
    if (frame !== undefined)
      return
    frame = requestAnimationFrame(() => {
      frame = undefined
      const viewport = options.viewportRef.value
      if (!viewport)
        return

      // 底部输入框长高会压扁视口：原本停在底部的，保持贴底，不让最后几行被挡住。
      const shrunkAtBottom = viewport.clientHeight < lastClientHeight
        && viewport.scrollHeight - viewport.scrollTop - lastClientHeight <= BOTTOM_THRESHOLD_PX
      lastClientHeight = viewport.clientHeight

      if (alignPending && options.anchorLatestTurn.value) {
        const anchor = [...viewport.querySelectorAll<HTMLElement>('[data-agent-user-turn-id]')]
          .find(element => element.dataset.agentUserTurnId === options.activeTurnId.value)
        if (anchor) {
          const top = viewport.scrollTop + anchor.getBoundingClientRect().top
            - viewport.getBoundingClientRect().top - Math.max(20, Math.round(viewport.clientHeight * 0.24))
          viewport.scrollTo({ top: Math.max(0, top), behavior: 'instant' })
        }
        alignPending = false
      }
      else if ((shouldFollowLatest || shrunkAtBottom) && !options.isRestoringScroll.value) {
        viewport.scrollTo({ top: viewport.scrollHeight, behavior: 'instant' })
      }
      lastScrollTop = viewport.scrollTop
      isNearBottom.value = nearBottom(viewport)
    })
  }

  function bindViewport(viewport: HTMLElement | null) {
    unbind?.()
    if (!viewport)
      return
    lastScrollTop = viewport.scrollTop
    lastClientHeight = viewport.clientHeight
    let lastTouchY: number | undefined

    const isNestedScroll = (event: Event) => event.target instanceof Element
      && Boolean(event.target.closest('[data-agent-code-scroll]'))
    const handleScroll = () => {
      const top = viewport.scrollTop
      isNearBottom.value = nearBottom(viewport)
      // 输入框变矮让视口变高时，浏览器夹小 scrollTop 也会派发 scroll，不是用户在往上翻。
      const resizedByLayout = viewport.clientHeight !== lastClientHeight
      if (!options.isRestoringScroll.value && !resizedByLayout) {
        if (top < lastScrollTop)
          shouldFollowLatest = false
        else if (top > lastScrollTop && isNearBottom.value)
          shouldFollowLatest = true
      }
      lastScrollTop = top
    }
    const handleDirection = (delta: number) => {
      if (delta < 0) {
        shouldFollowLatest = false
        alignPending = false
      }
      else if (delta > 0 && nearBottom(viewport)) {
        shouldFollowLatest = true
      }
    }
    const handleWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !isNestedScroll(event))
        handleDirection(event.deltaY)
    }
    const handleTouchStart = (event: TouchEvent) => {
      lastTouchY = !isNestedScroll(event) && event.touches.length === 1 ? event.touches[0]?.clientY : undefined
    }
    const handleTouchMove = (event: TouchEvent) => {
      const y = event.touches.length === 1 ? event.touches[0]?.clientY : undefined
      if (lastTouchY !== undefined && y !== undefined)
        handleDirection(lastTouchY - y)
      lastTouchY = isNestedScroll(event) ? undefined : y
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

    // 包括 Markdown 节流后提交、图片加载、输入框/窗口尺寸变化。
    const observer = new ResizeObserver(scheduleLayout)
    observer.observe(viewport)
    if (viewport.firstElementChild)
      observer.observe(viewport.firstElementChild)
    unbind = () => {
      observer.disconnect()
      viewport.removeEventListener('scroll', handleScroll)
      viewport.removeEventListener('wheel', handleWheel)
      viewport.removeEventListener('touchstart', handleTouchStart)
      viewport.removeEventListener('touchmove', handleTouchMove)
      viewport.removeEventListener('touchend', handleTouchEnd)
      viewport.removeEventListener('touchcancel', handleTouchEnd)
    }
  }

  function scrollToBottom(behavior: ScrollBehavior = 'smooth') {
    const viewport = options.viewportRef.value
    if (!viewport)
      return
    alignPending = false
    shouldFollowLatest = true
    viewport.scrollTo({
      top: viewport.scrollHeight,
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : behavior,
    })
    lastScrollTop = viewport.scrollTop
    isNearBottom.value = nearBottom(viewport)
  }

  watch([options.activeTurnId, options.anchorLatestTurn, options.conversationId, options.viewportRef], () => {
    shouldFollowLatest = false
    alignPending = options.anchorLatestTurn.value && Boolean(options.activeTurnId.value)
    bindViewport(options.viewportRef.value)
    scheduleLayout()
  }, { flush: 'post', immediate: true })

  onUnmounted(() => {
    unbind?.()
    if (frame !== undefined)
      cancelAnimationFrame(frame)
  })

  return { isNearBottom, scrollToBottom }
}
