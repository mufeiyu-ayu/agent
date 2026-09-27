import type { ChatStreamEvent } from '@agent/contracts'
import type { TurnRun } from '../types/chat'

import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, it, vi } from 'vitest'
import { effectScope, ref, shallowRef } from 'vue'
import { createI18n } from 'vue-i18n'

import { messages } from '../i18n/messages'
import { applyRunEvent, endRun, runStatusText, runSummaryText, startRun } from '../utils/run-status'
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
        const text = runStatusText(status.shownStep.value, t)
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
      const text = runStatusText(status.shownStep.value, t)

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
