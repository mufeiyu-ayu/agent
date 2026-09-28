import type Token from 'markdown-it/lib/token.mjs'
import type { InjectionKey } from 'vue'
import type { MarkdownBlockCache, ParsedContentBlock } from '@/utils/markdown-blocks'
import type { FadeBatch } from '@/utils/markdown-fade'

import { onUnmounted, shallowRef, watch } from 'vue'

import { renderMarkdownBlocks } from '@/utils/markdown-blocks'
import { canFade, FADE_MS, fadeText } from '@/utils/markdown-fade'
import { alignRevealBoundary } from '@/utils/streaming-markdown'

/** 积压字符按时间常数指数放出：流式中滞后网络约 280ms；流结束后下一次提交放完剩余积压，作为最后一批淡入。 */
const REVEAL_LAG_MS = 280
/** 流结束后必须在这之内放完（#155 决策）：解析慢、提交间隔被拉长时，到期前一帧不等提交间隔、一次放完。 */
const SETTLE_WITHIN_MS = 150
const FRAME_MS = 17
/** 下限也是渐显的批次间隔（#214）：每帧一批的片段太碎，看起来和逐字差不多。 */
const MIN_COMMIT_INTERVAL_MS = 64
/** 上限必须低于 REVEAL_LAG_MS，否则每次提交的放出比例都到 1，平滑退化成整段跳出。 */
const MAX_COMMIT_INTERVAL_MS = 120
/** 一次解析耗时的 4 倍作为下次最小间隔，长文档也不让解析占用主线程超过 1/4。 */
const COMMIT_BUDGET_RATIO = 4
/** 多留几帧再摘掉片段：动画在下一帧才开始，晚于放出时刻。 */
const FADE_SETTLED_MS = FADE_MS + 60

/** 带 fade 的块由 VNode 渲染、新字按批淡入；其余只留 HTML 走 v-html。 */
export type StreamingContentBlock
  = | Extract<ParsedContentBlock, { type: 'code' }>
    | { type: 'markdown', html: string, fade?: { tokens: Token[], batches: readonly FadeBatch[] } }

/**
 * 外层（AgentRunStatus）挂载时还在等待、正文尚未出现时为 true：正文组件挂载时带进来的第一段是实时流刚放出的字，
 * 也要渐显；切回正在输出的会话、刷新还原时为 false，挂载时已有的正文直接显示。
 */
export const FADE_INITIAL_TEXT: InjectionKey<boolean> = Symbol('fade-initial-text')

interface BlockFade {
  /** 上次提交时块的纯文本长度，超出的部分是这次新放出的。 */
  length: number
  batches: FadeBatch[]
}

/**
 * 对照 AI SDK `smoothStream` 与 Streamdown：网络 delta 由 useChatWorkspace 按帧合并后写入消息状态，
 * 这一层再平滑放出并按顶层块记忆化。已挂载时存在的正文直接显示，只有之后追加的内容做动画。
 * 每次提交新放出的文字作为一批淡入（#214），批次间隔就是提交间隔。
 */
export function useStreamingMarkdown(source: () => string, isStreaming: () => boolean, fadeInitialText = false) {
  const blocks = shallowRef<StreamingContentBlock[]>([])
  /** 按块下标：正在淡入的块，以及流式中的尾块（没有片段时也走 VNode，免得每批都在 v-html 与 VNode 之间切换）。 */
  const fades = new Map<number, BlockFade>()
  /** 在淡入的块的 token；其余块只留 HTML，已结束的消息不保留 token 树。 */
  const fadeTokens = new Map<number, Token[]>()
  /** 上次提交的尾块：新成为尾块、新出现的块以它为界判断哪些字已显示过。 */
  let previousTail = { index: -1, length: 0 }
  /** 最近一次提交的块，不含渐显状态。 */
  let shown: StreamingContentBlock[] = []
  let nextBatchId = 0
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
  let sweepTimer: ReturnType<typeof setTimeout> | undefined
  let cache: MarkdownBlockCache | undefined
  let revealedText = ''
  let committedStreaming = false
  let revealAnchor = 0
  /** 流结束的时刻；流式中为 undefined。 */
  let settleStartedAt: number | undefined
  let lastCommitAt = -Infinity
  let commitInterval = MIN_COMMIT_INTERVAL_MS
  let frame: number | undefined
  let hiddenTimer: ReturnType<typeof setTimeout> | undefined
  let unmounted = false

  /** `animate` 为 false 时这次放出的字直接显示（挂载时已有的正文、非追加式改写）。 */
  function commit(text: string, streaming: boolean, animate = true) {
    const startedAt = performance.now()
    revealedText = text
    committedStreaming = streaming
    revealAnchor = startedAt
    lastCommitAt = startedAt
    const result = renderMarkdownBlocks(text, { streaming, cache })
    trackFades(result.blocks, streaming, startedAt, animate)
    // 只量本 hook 可控的同步解析成本；Vue flush 里还混着同一帧的其他更新，不能归到这里。
    const cost = performance.now() - startedAt
    commitInterval = Math.min(MAX_COMMIT_INTERVAL_MS, Math.max(MIN_COMMIT_INTERVAL_MS, cost * COMMIT_BUDGET_RATIO))
    cache = result.cache
    // 没变的块沿用上次的对象，Vue 只比较在变的块。
    const previous = blocks.value
    shown = result.blocks.map((block, index) => {
      if (block.type !== 'markdown')
        return block
      const before = previous[index]
      return before?.type === 'markdown' && !before.fade && before.html === block.html ? before : { type: 'markdown', html: block.html }
    })
    publish()
  }

  /**
   * 按块的纯文本偏移记下这次新放出的一段。文字被改写（setext、列表重解析、linkify 截断）时，
   * 原偏移上的字沿用原批次，不重播；只有超出上次长度的部分算新字。
   * 一次提交可能带出好几个新块，都要记；挂载时已有的正文、后台标签页不记批次；减少动画偏好下全部走 v-html。
   */
  function trackFades(list: ParsedContentBlock[], streaming: boolean, now: number, animate: boolean) {
    const tail = list.length - 1
    // 只算尾块附近与在淡入的块，不为整篇回答逐块取纯文本。
    const lengthOf = (index: number) => {
      const block = list[index]
      return block?.type === 'markdown' ? fadeText(block.tokens).length : 0
    }
    const since = previousTail
    previousTail = { index: tail, length: lengthOf(tail) }
    fadeTokens.clear()
    if (reducedMotion.matches) {
      fades.clear()
      return
    }

    const record = animate && document.visibilityState !== 'hidden'
    // 上次的尾块之后都是新块；上次的尾块只有超出上次长度的部分是新字；更前面的块（合并、改写后）视为已显示。
    const firstNew = Math.max(0, record ? since.index : streaming ? tail : list.length)
    for (let index = firstNew; index < list.length; index++) {
      if (list[index]!.type === 'markdown' && !fades.has(index)) {
        const shownLength = index > since.index ? 0 : index === since.index ? since.length : lengthOf(index)
        fades.set(index, { length: record ? shownLength : lengthOf(index), batches: [] })
      }
    }

    for (const [index, fade] of fades) {
      const block = list[index]
      // 不再是 VNode 能渲染的块：整块回退 v-html。
      if (block?.type !== 'markdown' || !canFade(block.tokens)) {
        fades.delete(index)
        continue
      }
      const length = lengthOf(index)
      fade.batches = fade.batches
        .filter(batch => batch.start < length)
        .map(batch => batch.end > length ? { ...batch, end: length } : batch)
      if (record && length > fade.length)
        fade.batches.push({ id: nextBatchId++, start: fade.length, end: length, bornAt: now })
      fade.length = length
      fadeTokens.set(index, block.tokens)
    }
    dropSettled(now, streaming ? tail : -1)
  }

  /** 摘掉淡入完的片段；不是流式尾块、也没有片段在淡入的块切回 v-html。 */
  function dropSettled(now: number, liveTail: number) {
    for (const [index, fade] of fades) {
      fade.batches = fade.batches.filter(batch => now - batch.bornAt < FADE_SETTLED_MS)
      if (!fade.batches.length && index !== liveTail) {
        fades.delete(index)
        fadeTokens.delete(index)
      }
    }
  }

  function publish() {
    blocks.value = shown.map((block, index) => {
      const fade = fades.get(index)
      return fade && block.type === 'markdown' ? { type: 'markdown', html: block.html, fade: { tokens: fadeTokens.get(index)!, batches: fade.batches } } : block
    })
    clearTimeout(sweepTimer)
    sweepTimer = undefined
    const due = Math.min(...[...fades.values()].flatMap(fade => fade.batches.map(batch => batch.bornAt + FADE_SETTLED_MS)))
    // 提交停了（流结束、网络停顿）也要按时摘掉片段、切回 v-html。
    if (due < Infinity && !unmounted) {
      sweepTimer = setTimeout(() => {
        dropSettled(performance.now(), committedStreaming ? shown.length - 1 : -1)
        publish()
      }, due - performance.now())
    }
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
    if (!isStreaming() && settleStartedAt !== undefined && now - settleStartedAt >= SETTLE_WITHIN_MS - FRAME_MS) {
      const text = source()
      if (text !== revealedText || committedStreaming)
        commit(text, false)
      return
    }
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

    // 非追加式改写（aborted 以服务端正文为准、消息被替换）直接对齐，不重新打字，也不渐显。
    if (!isAppend || text.length === revealedText.length) {
      commit(text, streaming, false)
      return
    }

    const backlog = text.length - revealedText.length
    const ratio = streaming ? Math.min(1, (now - revealAnchor) / REVEAL_LAG_MS) : 1
    const end = alignRevealBoundary(text, revealedText.length + Math.max(1, Math.ceil(backlog * ratio)))
    // 只要还没放完，尾块就仍是未完成状态，收尾阶段也要补齐标记。
    commit(text.slice(0, end), streaming || end < text.length)
    if (end < text.length)
      schedule()
  }

  commit(source(), isStreaming(), fadeInitialText && isStreaming())
  document.addEventListener('visibilitychange', handleVisibilityChange)

  watch([source, isStreaming], ([, streaming]) => {
    const now = performance.now()
    if (!isPending())
      revealAnchor = now
    settleStartedAt = streaming ? undefined : (settleStartedAt ?? now)
    schedule()
  })

  onUnmounted(() => {
    unmounted = true
    document.removeEventListener('visibilitychange', handleVisibilityChange)
    if (frame !== undefined)
      cancelAnimationFrame(frame)
    if (hiddenTimer !== undefined)
      clearTimeout(hiddenTimer)
    clearTimeout(sweepTimer)
  })

  return blocks
}
