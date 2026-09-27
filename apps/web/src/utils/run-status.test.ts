import type { ChatStreamEvent } from '@agent/contracts'
import type { TurnRunStep } from '../types/chat'

import assert from 'node:assert/strict'
import { describe, it } from 'vitest'
import { createI18n } from 'vue-i18n'

import { messages } from '../i18n/messages'
import { applyRunEvent, endRun, runStepText, safeHref, siteName, startRun } from './run-status'

const ids = { conversationId: 'c', assistantMessageId: 'a' }

describe('#208 等待过程的数据', () => {
  it('事件按顺序归并：工具起止、正文开始、结束时把没收尾的步骤记为已停止；结束后的事件忽略', () => {
    const events: ChatStreamEvent[] = [
      { ...ids, type: 'tool_started', callId: 's', toolName: 'web_search', query: 'seo' },
      { ...ids, type: 'tool_finished', callId: 's', ok: true, results: [{ title: 'T', url: 'https://a.example/' }] },
      { ...ids, type: 'delta', contentDelta: '正' },
      { ...ids, type: 'tool_started', callId: 'f', toolName: 'web_fetch', url: 'https://b.example/' },
    ]
    let run = startRun(0)

    for (const [index, event] of events.entries())
      run = applyRunEvent(run, event, (index + 1) * 100)

    assert.deepEqual(run, {
      startedAt: 0,
      answerAt: 300,
      phase: 'tool',
      toolBeforeAnswer: true,
      steps: [
        { callId: 's', toolName: 'web_search', query: 'seo', status: 'ok', results: [{ title: 'T', url: 'https://a.example/' }] },
        { callId: 'f', toolName: 'web_fetch', url: 'https://b.example/', status: 'running' },
      ],
    })

    const answering = applyRunEvent(run, { ...ids, type: 'delta', contentDelta: '文' }, 500)

    // 同一段正文里的后续 delta 不产生新对象。
    assert.equal(applyRunEvent(answering, { ...ids, type: 'delta', contentDelta: '字' }, 600), answering)

    const ended = endRun(answering, 700, 'error')

    assert.equal(ended.phase, 'ended')
    assert.equal(ended.endedAt, 700)
    assert.equal(ended.outcome, 'error')
    assert.deepEqual(ended.steps.map(step => step.status), ['ok', 'stopped'])
    assert.equal(applyRunEvent(ended, { ...ids, type: 'tool_finished', callId: 'f', ok: true }, 800), ended)
    assert.equal(endRun(ended, 900, 'done'), ended)
  })

  it('tool_finished 只收尾最后一步：前一轮同 callId 的步骤不被改写', () => {
    let run = startRun(0)

    for (const event of [
      { ...ids, type: 'tool_started', callId: 'call_0', toolName: 'web_search', query: 'a' },
      { ...ids, type: 'tool_finished', callId: 'call_0', ok: true, results: [{ title: 'T', url: 'https://a.example/' }] },
      { ...ids, type: 'tool_started', callId: 'call_0', toolName: 'web_fetch', url: 'https://b.example/' },
      { ...ids, type: 'tool_finished', callId: 'call_0', ok: false, failure: 'timeout' },
    ] satisfies ChatStreamEvent[])
      run = applyRunEvent(run, event, 1)

    assert.deepEqual(run.steps.map(step => `${step.toolName}:${step.status}:${step.results?.length ?? '-'}:${step.failure ?? '-'}`), [
      'web_search:ok:1:-',
      'web_fetch:failed:-:timeout',
    ])
  })

  it('正文开始后才调工具不算「正文前调过工具」', () => {
    const run = applyRunEvent(
      applyRunEvent(startRun(0), { ...ids, type: 'delta', contentDelta: '先' }, 100),
      { ...ids, type: 'tool_started', callId: 's', toolName: 'web_search' },
      200,
    )

    assert.equal(run.toolBeforeAnswer, false)
  })

  it('时间线文案：搜索 / 阅读 / 失败 / 已停止，中英文', () => {
    const steps: TurnRunStep[] = [
      { callId: '1', toolName: 'web_search', query: 'React 19.2', status: 'ok', results: [{ title: 'a', url: 'https://a.example/' }, { title: 'b', url: 'https://b.example/' }] },
      { callId: '2', toolName: 'web_fetch', url: 'https://x.example/', status: 'ok', finalUrl: 'https://www.react.dev/blog', title: 'React Blog', chars: 6800 },
      { callId: '3', toolName: 'web_fetch', url: 'http://127.0.0.1:3000/api/health', status: 'failed', failure: 'failed' },
      { callId: '4', toolName: 'web_search', query: 'slow', status: 'failed', failure: 'timeout' },
      { callId: '5', toolName: 'web_fetch', url: 'https://slow.example/', status: 'stopped' },
      { callId: '6', toolName: 'web_fetch', url: 'https://c.example/', status: 'ok', finalUrl: 'https://c.example/' },
    ]
    const expected = {
      'zh-CN': [
        '搜索 | React 19.2 | 2 条结果',
        '阅读 | React Blog | react.dev · 约 6,800 字',
        '阅读 | http://127.0.0.1:3000/api/health | 未能完成',
        '搜索 | slow | 超时',
        '阅读 | https://slow.example/ | 已停止',
        '阅读 | c.example | ',
      ],
      'en-US': [
        'Searched | React 19.2 | 2 results',
        'Read | React Blog | react.dev · ~6,800 chars',
        'Read | http://127.0.0.1:3000/api/health | Could not finish',
        'Searched | slow | Timed out',
        'Read | https://slow.example/ | Stopped',
        'Read | c.example | ',
      ],
    }

    for (const locale of ['zh-CN', 'en-US'] as const) {
      const { t } = createI18n({ legacy: false, locale, messages }).global

      assert.deepEqual(steps.map((step) => {
        const text = runStepText(step, t, locale)

        return [text.verb, text.object, text.meta].join(' | ')
      }), expected[locale])
    }
  })

  it('只放行 http(s) 链接；域名去掉 www.', () => {
    assert.equal(safeHref('https://a.example/x?y=1'), 'https://a.example/x?y=1')
    assert.equal(safeHref('http://a.example'), 'http://a.example/')
    for (const url of ['javascript:alert(1)', 'data:text/html,x', 'file:///etc/passwd', 'not a url', undefined])
      assert.equal(safeHref(url), undefined, String(url))
    assert.equal(siteName('https://www.react.dev/blog'), 'react.dev')
    assert.equal(siteName('不是网址'), '不是网址')
  })
})
