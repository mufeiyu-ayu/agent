import type { ChatStreamEvent, MessageActivity } from '@agent/contracts'
import type { TurnRun } from '../types/chat'

import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, it, vi } from 'vitest'
import { effectScope, ref, shallowRef } from 'vue'
import { createI18n } from 'vue-i18n'

import { messages } from '../i18n/messages'
import { applyRunEvent, endRun, restoreRun, runStatusText, runStepText, runSummaryText, startRun, thoughtTitle } from '../utils/run-status'
import { useRunStatus } from './useRunStatus'

const ids = { conversationId: 'c', assistantMessageId: 'a' }
/** 每个用例的时间零点（假时钟下的 performance.now()）；用例建的 effectScope 在 afterEach 里统一释放。 */
let origin = 0
const scopes: Array<{ stop: () => void }> = []
const clock = () => performance.now() - origin

/**
 * 一轮对话的显示过程：按事件驱动 useRunStatus，用 snapshot() 把当下屏幕上会出现的东西写成一行字，
 * 与 AgentRunStatus.vue 用的是同一套取值（状态行 / 摘要 / 呼吸点 / 尾点 / 浮层）。
 */
function createTurn(locale: 'zh-CN' | 'en-US' = 'zh-CN') {
  const { t } = createI18n({ legacy: false, locale, messages }).global
  const run = shallowRef<TurnRun>()
  const waiting = ref(true)
  const scope = effectScope()
  const status = scope.run(() => useRunStatus(() => run.value, () => waiting.value))!

  scopes.push(scope)
  const history: string[] = []

  function snapshot(): string {
    const parts: string[] = []

    if (status.hasRow.value) {
      if (status.live.value) {
        const text = runStatusText(status.shownStep.value, t, status.shownThought.value)
        const seconds = status.seconds.value >= 1 ? ` · ${t('conversation.run.seconds', { n: status.seconds.value })}` : ''

        parts.push(`行[${text.label}${text.object ? ` ${text.object}` : ''}${seconds}]`)
      }
      else {
        const summary = runSummaryText(run.value!, t)

        parts.push(`摘要[${[summary.label, summary.meta, summary.warning].filter(Boolean).join(' · ')}]`)
      }
    }
    if (status.dotVisible.value)
      parts.push(status.dotTrailing.value ? '尾点' : '呼吸点')
    if (status.floating.value) {
      const text = runStatusText(status.shownStep.value, t, status.shownThought.value)

      parts.push(`浮层[${text.label}${text.object ? ` ${text.object}` : ''}]`)
    }

    const result = parts.join(' ') || '无'

    history.push(result)
    return result
  }

  return {
    snapshot,
    history,
    start() {
      run.value = startRun(performance.now())
      waiting.value = false
    },
    emit(event: Record<string, unknown> & { type: ChatStreamEvent['type'] }) {
      run.value = applyRunEvent(run.value!, { ...ids, ...event } as ChatStreamEvent, performance.now())
    },
    end(outcome: NonNullable<TurnRun['outcome']> = 'done') {
      run.value = endRun(run.value!, performance.now(), outcome)
    },
    /** 刷新后从接口还原（#212）：不经过流事件，一开始就是已结束。 */
    restore(activity: MessageActivity, outcome: NonNullable<TurnRun['outcome']> = 'done') {
      run.value = restoreRun(activity, outcome)
      waiting.value = false
    },
    /** 展开后的时间线：每行的文字，思考行排在它之后的第一个步骤之前（与 AgentRunTimeline 同序）。 */
    timeline(): string[] {
      const current = run.value!
      const thoughtsAt = (index: number) => current.thoughts
        .filter(thought => thought.at === index)
        .map(thought => `思考[${thoughtTitle(thought.text)}]`)

      return [
        ...current.steps.flatMap((step, index) => {
          const text = runStepText(step, t, locale)

          return [...thoughtsAt(index), `${text.verb} ${text.object}${text.meta ? ` · ${text.meta}` : ''}`]
        }),
        ...thoughtsAt(current.steps.length),
      ]
    },
  }
}

/** 推进假时钟后取一次画面。 */
function at(turn: ReturnType<typeof createTurn>, ms: number): string {
  vi.advanceTimersByTime(ms - clock())
  return turn.snapshot()
}

const search = (callId: string, query: string) => ({ type: 'tool_started', callId, toolName: 'web_search', query }) as const
const fetchPage = (callId: string, url: string) => ({ type: 'tool_started', callId, toolName: 'web_fetch', url }) as const
const finished = (callId: string, extra: Record<string, unknown> = {}) => ({ type: 'tool_finished', callId, ok: true, ...extra }) as const
const delta = { type: 'delta', contentDelta: '正文' } as const
const think = (text: string) => ({ type: 'reasoning_delta', delta: text }) as const

beforeEach(() => {
  vi.useFakeTimers()
  origin = performance.now()
})

afterEach(() => {
  for (const scope of scopes.splice(0))
    scope.stop()
  vi.useRealTimers()
})

describe('#208 等待过程的显示（假时钟）', () => {
  it('发出后立刻有呼吸点；满 1 秒还没有正文才出现「思考中」，计时只显示整秒', () => {
    const turn = createTurn()

    assert.equal(turn.snapshot(), '呼吸点')
    turn.start()
    assert.equal(at(turn, 999), '呼吸点')
    assert.equal(at(turn, 1000), '行[思考中 · 1 秒] 呼吸点')
    assert.equal(at(turn, 2999), '行[思考中 · 2 秒] 呼吸点')
    turn.emit(delta)
    assert.equal(at(turn, 3000), '摘要[已思考 2 秒]')
    turn.end()
    assert.equal(turn.snapshot(), '摘要[已思考 2 秒]')
  })

  it('1 秒内来正文且没有工具：全程没有状态行，呼吸点变成尾点，结束后淡出', () => {
    const turn = createTurn()

    turn.start()
    turn.emit(delta)
    assert.equal(at(turn, 800), '尾点')
    assert.equal(at(turn, 6000), '尾点')
    turn.end()
    assert.equal(turn.snapshot(), '无')
    assert.ok(turn.history.every(frame => !frame.includes('行') && !frame.includes('摘要')))
  })

  it('tool_started 立刻成为状态行；每个状态至少停留 1.2 秒；正文一到立刻变成摘要', () => {
    const turn = createTurn()

    turn.start()
    vi.advanceTimersByTime(300)
    turn.emit(search('call-1', 'React 19.2'))
    assert.equal(turn.snapshot(), '行[搜索 React 19.2] 呼吸点')
    vi.advanceTimersByTime(200)
    turn.emit(finished('call-1', { results: [{ title: 'T', url: 'https://react.dev/' }] }))
    // 搜索 0.2 秒就回来了：仍停在「搜索」，到 1.5 秒（出现后 1.2 秒）才换回思考中。
    assert.equal(at(turn, 1499), '行[搜索 React 19.2 · 1 秒] 呼吸点')
    assert.equal(at(turn, 1500), '行[思考中 · 1 秒] 呼吸点')
    turn.emit(fetchPage('call-2', 'https://www.react.dev/blog'))
    assert.equal(at(turn, 2699), '行[思考中 · 2 秒] 呼吸点')
    assert.equal(at(turn, 2700), '行[阅读 react.dev · 2 秒] 呼吸点')
    // 刚换成「阅读」0.1 秒正文就到了：不等停留，立刻变成摘要。
    turn.emit(finished('call-2', { finalUrl: 'https://react.dev/blog', title: 'Blog', chars: 6800 }))
    vi.advanceTimersByTime(100)
    turn.emit(delta)
    assert.equal(turn.snapshot(), '摘要[已搜索 1 次、阅读 1 个网页 · 用时 2 秒]')
  })

  it('事件来得比显示快：排队只留最新一个，过时的跳过不补播', () => {
    const turn = createTurn()

    turn.start()
    assert.equal(at(turn, 1000), '行[思考中 · 1 秒] 呼吸点')
    vi.advanceTimersByTime(100)
    turn.emit(search('call-a', 'A'))
    vi.advanceTimersByTime(200)
    turn.emit(finished('call-a'))
    vi.advanceTimersByTime(100)
    turn.emit(search('call-b', 'B'))
    assert.equal(at(turn, 2199), '行[思考中 · 2 秒] 呼吸点')
    assert.equal(at(turn, 2200), '行[搜索 B · 2 秒] 呼吸点')
    assert.ok(turn.history.every(frame => !frame.includes('搜索 A')))
  })

  it('摘要之后模型又调工具：摘要原地变回进行中，正文再来时变回摘要；状态行出现后不会被移除', () => {
    const turn = createTurn()

    turn.start()
    turn.emit(search('call-1', 'seo'))
    turn.emit(finished('call-1', { results: [] }))
    vi.advanceTimersByTime(2000)
    turn.emit(delta)
    assert.equal(turn.snapshot(), '摘要[已搜索 1 次 · 用时 2 秒]')
    vi.advanceTimersByTime(1500)
    turn.emit(fetchPage('call-2', 'https://example.com/a'))
    assert.equal(turn.snapshot(), '行[阅读 example.com · 3 秒] 呼吸点')
    vi.advanceTimersByTime(500)
    turn.emit(finished('call-2', { finalUrl: 'https://example.com/a', title: 'A', chars: 10 }))
    // 「阅读」从 3.5 秒开始显示，停够 1.2 秒才换。
    assert.equal(at(turn, 4699), '行[阅读 example.com · 4 秒] 呼吸点')
    assert.equal(at(turn, 4700), '行[思考中 · 4 秒] 呼吸点')
    turn.emit(delta)
    assert.equal(turn.snapshot(), '摘要[已搜索 1 次、阅读 1 个网页 · 用时 2 秒]')
    turn.end()
    assert.equal(turn.snapshot(), '摘要[已搜索 1 次、阅读 1 个网页 · 用时 2 秒]')

    const firstRow = turn.history.findIndex(frame => frame.startsWith('行') || frame.startsWith('摘要'))
    assert.ok(turn.history.slice(firstRow).every(frame => frame.startsWith('行') || frame.startsWith('摘要')))
  })

  it('正文开始后才调工具、之前没有状态行：不插状态行，进度写在尾点旁的浮层里，结束后随尾点淡出', () => {
    const turn = createTurn()

    turn.start()
    turn.emit(delta)
    vi.advanceTimersByTime(3000)
    turn.emit(search('call-1', 'sitemap'))
    assert.equal(turn.snapshot(), '尾点 浮层[搜索 sitemap]')
    vi.advanceTimersByTime(300)
    turn.emit(finished('call-1'))
    assert.equal(at(turn, 4199), '尾点 浮层[搜索 sitemap]')
    assert.equal(at(turn, 4200), '尾点 浮层[思考中]')
    turn.emit(delta)
    assert.equal(turn.snapshot(), '尾点')
    turn.end()
    assert.equal(turn.snapshot(), '无')
    assert.ok(turn.history.every(frame => !frame.includes('行') && !frame.includes('摘要')))
  })

  it('error / aborted 收尾：已完成的照常计入摘要，被打断的不计；全被打断时写「已停止」', () => {
    const partly = createTurn()

    partly.start()
    partly.emit(search('call-1', 'a'))
    partly.emit(finished('call-1', { results: [] }))
    partly.emit(fetchPage('call-2', 'https://slow.example/'))
    vi.advanceTimersByTime(4200)
    partly.end('error')
    assert.equal(partly.snapshot(), '摘要[已搜索 1 次 · 用时 4 秒]')

    const stopped = createTurn('en-US')

    stopped.start()
    stopped.emit(search('call-1', 'a'))
    vi.advanceTimersByTime(3100)
    stopped.end('aborted')
    assert.equal(stopped.snapshot(), '摘要[Stopped · took 3s]')
  })

  it('摘要文案：中英文、单复数、只有思考、有失败', () => {
    const run = (steps: TurnRun['steps'], answerAt = 9000): TurnRun => ({
      startedAt: 0,
      answerAt,
      endedAt: answerAt + 1000,
      phase: 'ended',
      toolBeforeAnswer: steps.length > 0,
      steps,
      thoughts: [],
    })
    const step = (toolName: string, status: 'ok' | 'failed' = 'ok') => ({ callId: `${toolName}-${Math.random()}`, toolName, status })
    const cases: Array<[TurnRun, string, string]> = [
      [run([step('web_search'), step('web_search'), step('web_fetch')]), '已搜索 2 次、阅读 1 个网页 · 用时 9 秒', 'Searched 2 times, read 1 page · took 9s'],
      [run([step('web_search')], 3000), '已搜索 1 次 · 用时 3 秒', 'Searched 1 time · took 3s'],
      [run([step('web_fetch'), step('web_fetch')], 400), '已阅读 2 个网页 · 用时 不到 1 秒', 'Read 2 pages · took under 1s'],
      [run([], 6000), '已思考 6 秒', 'Thought for 6s'],
      [run([step('web_search'), step('web_fetch', 'failed')], 5000), '已搜索 1 次、阅读 1 个网页 · 用时 5 秒 · 1 步失败', 'Searched 1 time, read 1 page · took 5s · 1 step failed'],
      [run([step('web_fetch', 'failed'), step('web_fetch', 'failed'), step('other_tool')], 5000), '已阅读 2 个网页、使用工具 1 次 · 用时 5 秒 · 2 步失败', 'Read 2 pages, used 1 tool · took 5s · 2 steps failed'],
    ]

    for (const locale of ['zh-CN', 'en-US'] as const) {
      const { t } = createI18n({ legacy: false, locale, messages }).global

      for (const [value, zh, en] of cases) {
        const summary = runSummaryText(value, t)

        assert.equal([summary.label, summary.meta, summary.warning].filter(Boolean).join(' · '), locale === 'zh-CN' ? zh : en)
      }
    }
  })

  it('不同轮次的 callId 重复（有的中转站每轮都从 call_0 编号）：各步骤互不覆盖，状态行照常换字', () => {
    const turn = createTurn()

    turn.start()
    turn.emit(search('call_0', 'first'))
    turn.emit(finished('call_0', { results: [] }))
    vi.advanceTimersByTime(1200)
    // 1.2 秒刚换回思考中，再停 1.2 秒才换成第二轮的「阅读」。
    turn.emit(fetchPage('call_0', 'https://second.example/'))
    assert.equal(at(turn, 2399), '行[思考中 · 2 秒] 呼吸点')
    assert.equal(at(turn, 2400), '行[阅读 second.example · 2 秒] 呼吸点')
    turn.emit(finished('call_0', { ok: false, failure: 'timeout' }))
    turn.emit(delta)
    assert.equal(turn.snapshot(), '摘要[已搜索 1 次、阅读 1 个网页 · 用时 2 秒 · 1 步失败]')
  })

  it('英文进行中文案与单位', () => {
    const turn = createTurn('en-US')

    turn.start()
    assert.equal(at(turn, 1000), '行[Thinking · 1s] 呼吸点')
    turn.emit(search('call-1', 'core update'))
    assert.equal(at(turn, 2200), '行[Searching core update · 2s] 呼吸点')
    turn.emit(finished('call-1'))
    turn.emit({ type: 'tool_started', callId: 'call-2', toolName: 'lookup_order' })
    assert.equal(at(turn, 3400), '行[Using tool lookup_order · 3s] 呼吸点')
  })
})

describe('#209 状态行的思考短句（假时钟）', () => {
  it('有思考原文：换成最新一句写完的话，每句至少停 1.5 秒、只留最新一句；新一轮不沿用上一轮；工具与正文照原规则', () => {
    const turn = createTurn()

    turn.start()
    turn.emit(think('用户想知道 React 19.2 官方列了哪些新特性，'))
    // 还没写完第一句。
    assert.equal(at(turn, 1000), '行[思考中 · 1 秒] 呼吸点')
    turn.emit(think('先找到官方发布说明。'))
    // 「思考中」从 1.0s 出现，停够 1.2 秒才换。
    assert.equal(at(turn, 2199), '行[思考中 · 2 秒] 呼吸点')
    assert.equal(at(turn, 2200), '行[用户想知道 React 19.2 官方列了哪些新特性，先找到官方发布说明。 · 2 秒] 呼吸点')
    turn.emit(think('搜索关键词用英文。'))
    at(turn, 2500)
    turn.emit(think('再加上 release notes。'))
    // 1.5 秒内又写完两句：到点只显示最新一句，中间那句跳过。
    assert.equal(at(turn, 3699), '行[用户想知道 React 19.2 官方列了哪些新特性，先找到官方发布说明。 · 3 秒] 呼吸点')
    assert.equal(at(turn, 3700), '行[再加上 release notes。 · 3 秒] 呼吸点')
    assert.ok(!turn.history.some(frame => frame.includes('搜索关键词用英文')))
    turn.emit(search('call-1', 'React 19.2'))
    assert.equal(at(turn, 5199), '行[再加上 release notes。 · 5 秒] 呼吸点')
    assert.equal(at(turn, 5200), '行[搜索 React 19.2 · 5 秒] 呼吸点')
    turn.emit(finished('call-1'))
    turn.emit(think('结果'))
    // 新一轮只写了半句：回到「思考中」，不沿用上一轮的句子。
    assert.equal(at(turn, 6400), '行[思考中 · 6 秒] 呼吸点')
    turn.emit(think('足够回答了。'))
    assert.equal(at(turn, 7599), '行[思考中 · 7 秒] 呼吸点')
    assert.equal(at(turn, 7600), '行[结果足够回答了。 · 7 秒] 呼吸点')
    turn.emit(delta)
    assert.equal(at(turn, 7700), '摘要[已搜索 1 次 · 用时 7 秒]')
  })

  it('句末的右引号晚一批才到：仍是同一句，文字补全但不重新停留', () => {
    const turn = createTurn()

    turn.start()
    turn.emit(think('用户问：“React 19.2 有哪些新特性？'))
    assert.equal(at(turn, 1000), '行[用户问：“React 19.2 有哪些新特性？ · 1 秒] 呼吸点')
    turn.emit(think('”先搜'))
    assert.equal(at(turn, 1100), '行[用户问：“React 19.2 有哪些新特性？” · 1 秒] 呼吸点')
    turn.emit(think('索官方博客。'))
    // 停留从 1.0s 起算，不因补上引号重新计。
    assert.equal(at(turn, 2499), '行[用户问：“React 19.2 有哪些新特性？” · 2 秒] 呼吸点')
    assert.equal(at(turn, 2500), '行[先搜索官方博客。 · 2 秒] 呼吸点')
  })

  it('没有思考原文（GPT、Gemini）：同样的过程全程是「思考中」', () => {
    const turn = createTurn()

    turn.start()
    assert.equal(at(turn, 2200), '行[思考中 · 2 秒] 呼吸点')
    turn.emit(search('call-1', 'React 19.2'))
    assert.equal(at(turn, 3700), '行[搜索 React 19.2 · 3 秒] 呼吸点')
    turn.emit(finished('call-1'))
    assert.equal(at(turn, 6400), '行[思考中 · 6 秒] 呼吸点')
    turn.emit(delta)
    assert.equal(at(turn, 7700), '摘要[已搜索 1 次 · 用时 6 秒]')
  })

  it('正文开始后才调工具：尾点旁的浮层同样显示思考短句', () => {
    const turn = createTurn()

    turn.start()
    turn.emit(delta)
    turn.emit(search('call-1', 'a'))
    assert.equal(at(turn, 100), '尾点 浮层[搜索 a]')
    turn.emit(finished('call-1'))
    turn.emit(think('再补一句说明。'))
    assert.equal(at(turn, 1300), '尾点 浮层[再补一句说明。]')
  })
})

describe('#212 刷新后还原：同一份数据，实时结束时与还原后的摘要、时间线完全一致', () => {
  /** 一轮实时对话结束后的画面与时间线；时刻都从 start 起算。 */
  function live(locale: 'zh-CN' | 'en-US', script: Array<[number, Record<string, unknown> & { type: ChatStreamEvent['type'] }]>, endAt: number, outcome: NonNullable<TurnRun['outcome']> = 'done') {
    const turn = createTurn(locale)

    // 同一用例里中英文各跑一遍：每轮从当前时刻重新起算。
    origin = performance.now()
    turn.start()
    for (const [ms, event] of script) {
      vi.advanceTimersByTime(ms - clock())
      turn.emit(event)
    }
    vi.advanceTimersByTime(endAt - clock())
    turn.end(outcome)

    return { summary: turn.snapshot(), timeline: turn.timeline() }
  }

  function restored(locale: 'zh-CN' | 'en-US', activity: MessageActivity, outcome: NonNullable<TurnRun['outcome']> = 'done') {
    const turn = createTurn(locale)

    turn.restore(activity, outcome)
    return { summary: turn.snapshot(), timeline: turn.timeline() }
  }

  const sources = [{ title: '来源', url: 'https://a.example/' }]
  const cases: Array<{
    name: string
    script: Array<[number, Record<string, unknown> & { type: ChatStreamEvent['type'] }]>
    endAt: number
    outcome?: NonNullable<TurnRun['outcome']>
    activity: MessageActivity
    zh: string
  }> = [
    {
      name: '先思考、搜索、读网页、再思考后回答',
      script: [
        [200, think('先搜一下。')],
        [900, search('s', 'seo')],
        [2_000, finished('s', { results: sources })],
        [2_100, fetchPage('f', 'https://b.example/')],
        [4_000, finished('f', { finalUrl: 'https://b.example/final', title: '网页标题', chars: 1234 })],
        [4_500, think('整理结果。')],
        [9_400, delta],
      ],
      endAt: 12_000,
      activity: {
        answerStartedMs: 9_400,
        toolBeforeAnswer: true,
        items: [
          { kind: 'thought', text: '先搜一下。' },
          { kind: 'tool', callId: 's', toolName: 'web_search', query: 'seo', ok: true, durationMs: 1_100, results: sources },
          { kind: 'tool', callId: 'f', toolName: 'web_fetch', url: 'https://b.example/', ok: true, durationMs: 1_900, finalUrl: 'https://b.example/final', title: '网页标题', chars: 1234 },
          { kind: 'thought', text: '整理结果。' },
        ],
      },
      zh: '摘要[已搜索 1 次、阅读 1 个网页 · 用时 9 秒]',
    },
    {
      name: '只有思考',
      script: [[300, think('想一想这个问题。')], [2_500, delta]],
      endAt: 5_000,
      activity: { answerStartedMs: 2_500, toolBeforeAnswer: false, items: [{ kind: 'thought', text: '想一想这个问题。' }] },
      zh: '摘要[已思考 2 秒]',
    },
    {
      name: '工具失败：超时与自标失败',
      script: [
        [100, search('s', 'seo')],
        [1_000, finished('s', { ok: false, failure: 'failed' })],
        [1_100, fetchPage('f', 'https://b.example/')],
        [16_000, finished('f', { ok: false, failure: 'timeout' })],
        [17_000, delta],
      ],
      endAt: 18_000,
      activity: {
        answerStartedMs: 17_000,
        toolBeforeAnswer: true,
        items: [
          { kind: 'tool', callId: 's', toolName: 'web_search', query: 'seo', ok: false, failure: 'failed' },
          { kind: 'tool', callId: 'f', toolName: 'web_fetch', url: 'https://b.example/', ok: false, failure: 'timeout' },
        ],
      },
      zh: '摘要[已搜索 1 次、阅读 1 个网页 · 用时 17 秒 · 2 步失败]',
    },
    {
      name: '正文 1 秒内开始、之后才调工具：实时没有状态行，还原也没有',
      script: [[400, delta], [600, search('s', 'seo')], [1_500, finished('s', { results: sources })]],
      endAt: 3_000,
      activity: { answerStartedMs: 400, toolBeforeAnswer: false, items: [{ kind: 'tool', callId: 's', toolName: 'web_search', query: 'seo', ok: true, results: sources }] },
      zh: '无',
    },
    {
      name: '只有思考且正文 1 秒内开始：没有状态行',
      script: [[100, think('很快。')], [800, delta]],
      endAt: 2_000,
      activity: { answerStartedMs: 800, toolBeforeAnswer: false, items: [{ kind: 'thought', text: '很快。' }] },
      zh: '无',
    },
  ]

  for (const testCase of cases) {
    it(`AC-08 ${testCase.name}（中英文）`, () => {
      for (const locale of ['zh-CN', 'en-US'] as const) {
        const liveView = live(locale, testCase.script, testCase.endAt, testCase.outcome)
        const restoredView = restored(locale, testCase.activity, testCase.outcome)

        assert.deepEqual(restoredView, liveView, `${locale}：${JSON.stringify(restoredView)}`)
        if (locale === 'zh-CN')
          assert.equal(restoredView.summary, testCase.zh)
      }
    })
  }

  it('AC-08 时间线逐行一致（中英文）：思考行在同一轮的步骤之前，最后一轮思考在最后', () => {
    const view = restored('zh-CN', cases[0]!.activity)

    assert.deepEqual(view.timeline, [
      '思考[先搜一下。]',
      '搜索 seo · 1 条结果',
      '阅读 网页标题 · b.example · 约 1,234 字',
      '思考[整理结果。]',
    ])
    assert.deepEqual(restored('en-US', cases[0]!.activity).timeline, [
      '思考[先搜一下。]',
      'Searched seo · 1 result',
      'Read 网页标题 · b.example · ~1,234 chars',
      '思考[整理结果。]',
    ])
  })

  it('AC-08 降级：没有 display 不写结果数，被停止的步骤没有参数，没有 answerStartedMs 不写用时，没有最后一轮思考就少那一行', () => {
    const old = restored('zh-CN', {
      toolBeforeAnswer: true,
      items: [
        { kind: 'thought', text: 'Tool Call 轮的思考。' },
        { kind: 'tool', callId: 's', toolName: 'web_search', query: 'seo', ok: true },
        { kind: 'tool', callId: 'f', toolName: 'web_fetch', url: 'https://b.example/page', ok: true },
      ],
    })

    assert.equal(old.summary, '摘要[已搜索 1 次、阅读 1 个网页]')
    // 搜索行没有「n 条结果」，阅读行没有标题时写域名。
    assert.deepEqual(old.timeline, ['思考[Tool Call 轮的思考。]', '搜索 seo', '阅读 b.example'])
    // 被停止的步骤在库里没有参数（Step 没收口）：摘要与实时一致，时间线这一行只有动作与「已停止」。
    const stopped = restored('zh-CN', { answerStartedMs: 1_500, toolBeforeAnswer: false, items: [{ kind: 'tool', callId: 'f', toolName: 'web_fetch', ok: false }] }, 'aborted')

    assert.equal(stopped.summary, live('zh-CN', [[1_500, delta], [1_600, fetchPage('f', 'https://b.example/')]], 4_000, 'aborted').summary)
    assert.equal(stopped.summary, '摘要[已停止 · 用时 1 秒]')
    assert.deepEqual(stopped.timeline, ['阅读  · 已停止'])
    // 停在正文前、没有用时：「已停止」「已思考」都不带时间。
    assert.equal(restored('zh-CN', { toolBeforeAnswer: true, items: [{ kind: 'tool', callId: 'f', toolName: 'web_fetch', ok: false }] }, 'aborted').summary, '摘要[已停止]')
    assert.equal(restored('zh-CN', { toolBeforeAnswer: false, items: [{ kind: 'thought', text: '想完了。' }] }).summary, '摘要[已思考]')
    assert.equal(restored('en-US', { toolBeforeAnswer: false, items: [{ kind: 'thought', text: '想完了。' }] }).summary, '摘要[Thought]')
  })
})
