import type { MarkdownBlockCache, ParsedContentBlock } from '@/utils/markdown-blocks'

import { onUnmounted, shallowRef, watch } from 'vue'

import { renderMarkdownBlocks } from '@/utils/markdown-blocks'
import { alignRevealBoundary } from '@/utils/streaming-markdown'

/** 积压字符按时间常数指数放出：流式中滞后网络约 150ms，结束后 50ms 内收尾，不整段跳出。 */
const REVEAL_LAG_MS = 150
const SETTLE_LAG_MS = 50
const MIN_COMMIT_INTERVAL_MS = 32
/** 上限必须低于 REVEAL_LAG_MS，否则每次提交的放出比例都到 1，平滑退化成整段跳出。 */
const MAX_COMMIT_INTERVAL_MS = 120
/** 一次解析耗时的 4 倍作为下次最小间隔，长文档也不让解析占用主线程超过 1/4。 */
const COMMIT_BUDGET_RATIO = 4

/**
 * 对照 AI SDK `smoothStream` 与 Streamdown：网络 delta 由 useChatWorkspace 按帧合并后写入消息状态，
 * 这一层再平滑放出并按顶层块记忆化。已挂载时存在的正文直接显示，只有之后追加的内容做动画。
 */
export function useStreamingMarkdown(source: () => string, isStreaming: () => boolean) {
  const blocks = shallowRef<ParsedContentBlock[]>([])
  let cache: MarkdownBlockCache | undefined
  let revealedText = ''
  let committedStreaming = false
  let revealAnchor = 0
  let lastCommitAt = -Infinity
  let commitInterval = MIN_COMMIT_INTERVAL_MS
  let frame: number | undefined
  let hiddenTimer: ReturnType<typeof setTimeout> | undefined
  let unmounted = false

  function commit(text: string, streaming: boolean) {
    const startedAt = performance.now()
    revealedText = text
    committedStreaming = streaming
    revealAnchor = startedAt
    lastCommitAt = startedAt
    const result = renderMarkdownBlocks(text, { streaming, cache })
    // 只量本 hook 可控的同步解析成本；Vue flush 里还混着同一帧的其他更新，不能归到这里。
    const cost = performance.now() - startedAt
    commitInterval = Math.min(MAX_COMMIT_INTERVAL_MS, Math.max(MIN_COMMIT_INTERVAL_MS, cost * COMMIT_BUDGET_RATIO))
    cache = result.cache
    blocks.value = result.blocks
  }

  function isPending() {
    return frame !== undefined || hiddenTimer !== undefined
  }

  function schedule() {
    if (isPending() || unmounted)
      return
    // 后台标签页不派发 rAF；退到定时器，保证终态仍会落到 DOM。
    if (document.visibilityState === 'hidden') {
      hiddenTimer = setTimeout(() => {
        hiddenTimer = undefined
        tick()
      }, commitInterval)
      return
    }
    frame = requestAnimationFrame(tick)
  }

  /** 已排队的 rAF 在标签页切到后台后永远不会触发，改走定时器。 */
  function handleVisibilityChange() {
    if (document.visibilityState === 'hidden' && frame !== undefined) {
      cancelAnimationFrame(frame)
      frame = undefined
      schedule()
    }
  }

  function tick() {
    frame = undefined
    const now = performance.now()
    if (now - lastCommitAt < commitInterval) {
      schedule()
      return
    }

    const text = source()
    const streaming = isStreaming()
    const isAppend = text.startsWith(revealedText)

    // 已对齐且流式状态未变：没有要提交的内容。流结束时尾块不再补齐标记，要按最终正文重渲染一次。
    if (isAppend && text.length === revealedText.length && streaming === committedStreaming)
      return

    // 非追加式改写（aborted 以服务端正文为准、消息被替换）直接对齐，不重新打字。
    if (!isAppend || text.length === revealedText.length) {
      commit(text, streaming)
      return
    }

    const backlog = text.length - revealedText.length
    const ratio = Math.min(1, (now - revealAnchor) / (streaming ? REVEAL_LAG_MS : SETTLE_LAG_MS))
    const end = alignRevealBoundary(text, revealedText.length + Math.max(1, Math.ceil(backlog * ratio)))
    // 只要还没放完，尾块就仍是未完成状态，收尾阶段也要补齐标记。
    commit(text.slice(0, end), streaming || end < text.length)
    if (end < text.length)
      schedule()
  }

  commit(source(), isStreaming())
  document.addEventListener('visibilitychange', handleVisibilityChange)

  watch([source, isStreaming], () => {
    if (!isPending())
      revealAnchor = performance.now()
    schedule()
  })

  onUnmounted(() => {
    unmounted = true
    document.removeEventListener('visibilitychange', handleVisibilityChange)
    if (frame !== undefined)
      cancelAnimationFrame(frame)
    if (hiddenTimer !== undefined)
      clearTimeout(hiddenTimer)
  })

  return blocks
}
