import type { Ref } from 'vue'

import { onBeforeUnmount, onMounted, ref, watch } from 'vue'

/** 呼吸点的格子边长（与 AgentRunStatus 的样式一致）。 */
export const RUN_DOT_PX = 16
/** 尾点距最后一个字、代码卡片下方的距离。 */
const TRAIL_GAP_PX = 1
const TRAIL_BELOW_BLOCK_PX = 6
/** 尾点淡出（0.3s）加正文收尾放字（约 0.15s）都结束后才停止观察，淡出途中仍跟着字走。 */
const STOP_DELAY_MS = 500

/**
 * 尾点（#208）：没有状态行时，呼吸点跟在正文最后一个字后面，浮层定位，不进 Markdown 的 DOM。
 * MutationObserver 的回调在绘制前执行，正文更新的同一帧就挪到新位置，不会先盖住新字；
 * 宽度变化（窗口缩放、侧栏开合）带来的重新换行由 ResizeObserver 补量。
 *
 * @param root 定位基准（尾点所在的定位上下文）
 * @param content 正文容器，里面有 `.agent-markdown-content`
 * @param tracking 需要跟随时为 true
 * @returns 尾点中心相对 root 的位置；还没有正文时为 undefined
 */
export function useTrailingDot(
  root: Ref<HTMLElement | undefined>,
  content: Ref<HTMLElement | undefined>,
  tracking: () => boolean,
) {
  const trail = ref<{ x: number, y: number }>()
  let mutationObserver: MutationObserver | undefined
  let resizeObserver: ResizeObserver | undefined
  let observedWidth = 0
  let stopTimer: ReturnType<typeof setTimeout> | undefined

  /** 取正文末尾文字的矩形；最后一块是代码卡片时放在卡片下方行首。 */
  function measure() {
    const last = content.value?.querySelector('.agent-markdown-content')?.lastElementChild

    if (!root.value || !last)
      return

    const origin = root.value.getBoundingClientRect()

    if (!last.classList.contains('agent-markdown-prose')) {
      const block = last.getBoundingClientRect()

      trail.value = { x: block.left - origin.left + RUN_DOT_PX / 2, y: block.bottom - origin.top + TRAIL_BELOW_BLOCK_PX + RUN_DOT_PX / 2 }
      return
    }

    const rect = lastCharRect(last)

    if (rect)
      trail.value = { x: rect.right - origin.left + TRAIL_GAP_PX + RUN_DOT_PX / 2, y: rect.top + rect.height / 2 - origin.top }
  }

  function start() {
    clearTimeout(stopTimer)
    if (mutationObserver || !root.value || !content.value)
      return

    mutationObserver = new MutationObserver(measure)
    mutationObserver.observe(content.value, { childList: true, subtree: true, characterData: true })
    // 正文变高已由 MutationObserver 量过；这里只管宽度变化。
    observedWidth = root.value.clientWidth
    resizeObserver = new ResizeObserver(([entry]) => {
      if (entry && entry.contentRect.width !== observedWidth) {
        observedWidth = entry.contentRect.width
        measure()
      }
    })
    resizeObserver.observe(root.value)
    measure()
  }

  function stop() {
    clearTimeout(stopTimer)
    mutationObserver?.disconnect()
    resizeObserver?.disconnect()
    mutationObserver = undefined
    resizeObserver = undefined
  }

  // 挂载前 ref 还是空的：挂载时已经要跟随（如切走再切回正在输出的会话）在 onMounted 里开始。
  onMounted(() => {
    if (tracking())
      start()
  })
  watch(tracking, (on) => {
    if (on) {
      start()
      return
    }
    clearTimeout(stopTimer)
    stopTimer = setTimeout(stop, STOP_DELAY_MS)
  }, { flush: 'post' })
  onBeforeUnmount(stop)

  return trail
}

/** 从末尾往前找最后一个有字的文本节点：长列表、表格也只看结尾几个节点。 */
function lastCharRect(element: Element): DOMRect | undefined {
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
  let node = walker.lastChild()

  while (node && !node.nodeValue?.trim())
    node = walker.previousNode()

  if (!node)
    return undefined

  const text = (node as Text).data
  const end = text.trimEnd().length
  // 末尾是代理对时取整个字符。
  const start = end - (/[\uDC00-\uDFFF]/.test(text[end - 1] ?? '') ? 2 : 1)
  const range = document.createRange()

  range.setStart(node, Math.max(0, start))
  range.setEnd(node, end)
  const rects = range.getClientRects()

  return rects[rects.length - 1]
}
