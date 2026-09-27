import type { TurnRun, TurnRunStep } from '../types/chat'

import { computed, onScopeDispose, ref, watch } from 'vue'

/** 满 1 秒还没有正文才出现状态行（Nielsen 响应时间界限：1 秒内不打断用户思路，无需提示）。 */
export const RUN_ROW_DELAY_MS = 1000
/** 状态行每个状态至少停留这么久才换下一个，避免搜索秒回时一闪一闪。 */
export const RUN_MIN_DWELL_MS = 1200
const SECOND_MS = 1000

/**
 * 等待过程的显示状态（#208）：何时有状态行、呼吸点在哪、当前显示哪个步骤、计时。
 * 数据来自 `TurnRun`，这里只管时间：1 秒阈值、整秒计时、最短停留与排队（只留最新一个）。
 *
 * @param run 本轮的等待过程；start 之前为 undefined
 * @param waiting 已发出、还没收到 start
 */
export function useRunStatus(run: () => TurnRun | undefined, waiting: () => boolean) {
  // 与 TurnRun 里的时间一样用单调时钟。
  const now = ref(performance.now())

  // 数据是单调的（toolBeforeAnswer 与 answerAt 设了就不变、时钟只往前走），所以状态行出现后不会消失。
  const hasRow = computed(() => {
    const current = run()

    return !!current && (current.toolBeforeAnswer
      || (current.answerAt ?? current.endedAt ?? now.value) - current.startedAt >= RUN_ROW_DELAY_MS)
  })
  const live = computed(() => {
    const current = run()

    return current ? current.phase === 'waiting' || current.phase === 'tool' : waiting()
  })
  /** 正文开始后才调工具、之前没有状态行：进度写在尾点旁的浮层里，不插状态行。 */
  const floating = computed(() => live.value && !hasRow.value && run()?.answerAt !== undefined)
  const labelVisible = computed(() => live.value && (hasRow.value || floating.value))

  /** 最新的目标：进行中的工具步骤在 steps 里的下标（工具顺序执行，tool 阶段就是最后一步），没有就是思考中。 */
  const target = computed<number | undefined>(() => {
    const current = run()

    return current?.phase === 'tool' ? current.steps.length - 1 : undefined
  })
  /** 实际显示的步骤下标（undefined = 思考中）：受最短停留约束，落后于 target。 */
  const shownIndex = ref(target.value)
  let shownAt = performance.now()
  let dwellTimer: ReturnType<typeof setTimeout> | undefined

  /** 换成 index；appeared 表示刚出现，即使和上次一样也从现在起算停留。 */
  function show(index: number | undefined, appeared = false) {
    clearTimeout(dwellTimer)
    dwellTimer = undefined
    if (appeared || index !== shownIndex.value) {
      shownIndex.value = index
      shownAt = performance.now()
    }
  }

  // 刚出现（状态行出现、摘要变回进行中、浮层出现）立刻显示最新目标；之后换字先停够最短时间，
  // 期间再来的事件只把目标换成最新的（每次都重新排），到点显示最新的那个。
  watch([labelVisible, target], ([visible, index], [wasVisible]) => {
    clearTimeout(dwellTimer)
    dwellTimer = undefined
    if (!visible)
      return
    if (!wasVisible)
      return show(index, true)

    const wait = shownAt + RUN_MIN_DWELL_MS - performance.now()

    if (wait <= 0)
      show(index)
    else
      dwellTimer = setTimeout(show, wait, index)
  }, { flush: 'sync' })
  const shownStep = computed<TurnRunStep | undefined>(() =>
    shownIndex.value === undefined ? undefined : run()?.steps[shownIndex.value])

  // 进行中每到整秒走一次钟（计时，以及没有状态行时的 1 秒阈值）；写正文与结束后不走。
  let tickTimer: ReturnType<typeof setTimeout> | undefined

  function scheduleTick() {
    clearTimeout(tickTimer)
    tickTimer = undefined
    now.value = performance.now()

    const current = run()

    if (!current || !live.value)
      return

    tickTimer = setTimeout(scheduleTick, SECOND_MS - ((now.value - current.startedAt) % SECOND_MS))
  }

  watch([() => run()?.startedAt, live], scheduleTick, { immediate: true, flush: 'sync' })

  onScopeDispose(() => {
    clearTimeout(dwellTimer)
    clearTimeout(tickTimer)
  })

  /** 进行中的计时：从 start 起的整秒。 */
  const seconds = computed(() => {
    const current = run()

    return current ? Math.floor(Math.max(0, now.value - current.startedAt) / SECOND_MS) : 0
  })

  /** 呼吸点：发出后到正文开始（或状态行进行中）可见；在状态行图标位，或没有状态行时跟在正文末尾。 */
  const dotVisible = computed(() => {
    const current = run()

    if (!current)
      return waiting()

    return current.phase !== 'ended' && (!hasRow.value || live.value)
  })
  const dotTrailing = computed(() => !hasRow.value && run()?.answerAt !== undefined)

  return { hasRow, live, floating, shownIndex, shownStep, seconds, dotVisible, dotTrailing }
}
