import type { Ref } from 'vue'

import { onBeforeUnmount, onMounted, ref, watch } from 'vue'

const MAX_LINES = 8
const MAX_VIEWPORT_RATIO = 0.4

/**
 * 输入框随内容长高：先把高度设回 auto 读 scrollHeight，再夹到 [CSS min-height, 上限]。
 * 上限取「8 行 + 上下内边距」与视口 40% 的较小值，超出后在框内滚动。
 * 内容变化在 DOM 更新后、绘制前同步计算，不做高度动画，光标不会落后于框体；
 * 宽度变化（窗口缩放、侧栏收起）会改变折行，用 ResizeObserver 只在宽度变时重算。
 * `isMultiline`：内容超过一行（按当前宽度折行或含换行）；外部改了内边距等排布时调 `resize` 重算。
 */
export function useAutosizeTextarea(container: Ref<HTMLElement | null>, value: Ref<string>) {
  const isMultiline = ref(false)
  let lastWidth = 0
  let lastViewportHeight = 0
  let observer: ResizeObserver | undefined

  function resize() {
    const wrapper = container.value
    const textarea = wrapper?.querySelector('textarea')
    if (!wrapper || !textarea)
      return

    const style = getComputedStyle(textarea)
    const lineHeight = Number.parseFloat(style.lineHeight)
    const paddingY = Number.parseFloat(style.paddingTop) + Number.parseFloat(style.paddingBottom)
    const maxHeight = Math.min(lineHeight * MAX_LINES + paddingY, window.innerHeight * MAX_VIEWPORT_RATIO)

    // 量高度时框体会先塌成一行：锁住外层高度，别让相邻的对话区跟着变高、被浏览器夹掉滚动位置。
    wrapper.style.height = `${wrapper.offsetHeight}px`
    textarea.style.height = 'auto'
    const contentHeight = textarea.scrollHeight
    textarea.style.height = `${Math.min(contentHeight, maxHeight)}px`
    wrapper.style.height = ''
    textarea.style.overflowY = contentHeight > maxHeight ? 'auto' : 'hidden'
    // 半行容差，避免亚像素取整误判。
    isMultiline.value = contentHeight > lineHeight * 1.5 + paddingY
  }

  watch(value, resize, { flush: 'post' })

  /** 宽度变化交给 ResizeObserver；窗口只在高度变时重算（上限取视口 40%）。 */
  function handleWindowResize() {
    if (window.innerHeight === lastViewportHeight)
      return
    lastViewportHeight = window.innerHeight
    resize()
  }

  onMounted(() => {
    const textarea = container.value?.querySelector('textarea')
    if (!textarea)
      return

    resize()
    observer = new ResizeObserver(([entry]) => {
      const width = entry?.contentRect.width ?? 0
      if (width === lastWidth)
        return
      lastWidth = width
      resize()
    })
    observer.observe(textarea)
    lastViewportHeight = window.innerHeight
    window.addEventListener('resize', handleWindowResize)
  })

  onBeforeUnmount(() => {
    observer?.disconnect()
    window.removeEventListener('resize', handleWindowResize)
  })

  return { isMultiline, resize }
}
