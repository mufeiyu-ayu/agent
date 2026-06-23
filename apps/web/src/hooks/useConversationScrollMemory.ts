import type { ComputedRef, Ref } from 'vue'

import { nextTick, onUnmounted, ref, watch } from 'vue'

interface UseConversationScrollMemoryOptions {
  containerRef: Ref<HTMLElement | null>
  conversationId: ComputedRef<string | null>
  canRestore: ComputedRef<boolean>
}

const conversationScrollPositions = new Map<string, number>()

export function useConversationScrollMemory(options: UseConversationScrollMemoryOptions) {
  const isRestoringScroll = ref(false)

  let restoreRunId = 0
  let observedViewport: HTMLElement | undefined
  let removeScrollListener: (() => void) | undefined

  function saveScrollPosition(conversationId: string | null | undefined) {
    const viewport = getScrollViewport()

    if (!conversationId || !viewport)
      return

    conversationScrollPositions.set(conversationId, viewport.scrollTop)
  }

  async function restoreScrollPosition() {
    const conversationId = options.conversationId.value

    if (!conversationId || !options.canRestore.value) {
      isRestoringScroll.value = false
      return
    }

    const runId = ++restoreRunId

    isRestoringScroll.value = true

    await waitForLayout()

    if (!isCurrentRestore(runId))
      return

    bindScrollListener()

    const viewport = getScrollViewport()

    if (!viewport) {
      isRestoringScroll.value = false
      return
    }

    const savedScrollTop = conversationScrollPositions.get(conversationId)
    const fallbackScrollTop = Math.max(0, viewport.scrollHeight - viewport.clientHeight)

    viewport.scrollTo({
      top: savedScrollTop ?? fallbackScrollTop,
      behavior: 'auto',
    })

    await waitForAnimationFrame()

    if (isCurrentRestore(runId))
      isRestoringScroll.value = false
  }

  function bindScrollListener() {
    const viewport = getScrollViewport()

    if (observedViewport === viewport)
      return

    removeScrollListener?.()
    observedViewport = viewport ?? undefined

    if (!viewport)
      return

    const handleScroll = () => {
      const conversationId = options.conversationId.value

      if (conversationId)
        conversationScrollPositions.set(conversationId, viewport.scrollTop)
    }

    viewport.addEventListener('scroll', handleScroll, { passive: true })
    removeScrollListener = () => {
      viewport.removeEventListener('scroll', handleScroll)
    }
  }

  function getScrollViewport() {
    return options.containerRef.value?.querySelector<HTMLElement>('[data-slot="scroll-area-viewport"]') ?? null
  }

  function isCurrentRestore(runId: number) {
    return runId === restoreRunId && Boolean(options.conversationId.value) && options.canRestore.value
  }

  async function waitForLayout() {
    await nextTick()
    await waitForAnimationFrame()
  }

  async function waitForAnimationFrame() {
    await new Promise<void>((resolve) => {
      window.requestAnimationFrame(() => resolve())
    })
  }

  watch(
    () => options.conversationId.value,
    (conversationId, previousConversationId) => {
      saveScrollPosition(previousConversationId)

      if (conversationId && options.canRestore.value)
        isRestoringScroll.value = true
    },
    {
      flush: 'sync',
    },
  )

  watch(
    () => options.canRestore.value,
    (canRestore) => {
      if (canRestore && options.conversationId.value)
        isRestoringScroll.value = true
    },
    {
      flush: 'sync',
    },
  )

  watch(
    [
      () => options.conversationId.value,
      () => options.canRestore.value,
      () => options.containerRef.value,
    ],
    () => {
      void restoreScrollPosition()
    },
    {
      flush: 'post',
      immediate: true,
    },
  )

  onUnmounted(() => {
    saveScrollPosition(options.conversationId.value)
    removeScrollListener?.()
    observedViewport = undefined
    restoreRunId += 1
  })

  return {
    isRestoringScroll,
  }
}
