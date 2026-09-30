import type { ChatStreamEvent } from '@agent/contracts'
import type { TurnRunStep } from '../types/chat'

import assert from 'node:assert/strict'
import { describe, it } from 'vitest'
import { createI18n } from 'vue-i18n'

import { messages } from '../i18n/messages'
import { applyRunEvent, endRun, latestThoughtSentence, liveThought, runStepText, safeHref, siteName, startRun, thoughtHasMore, thoughtTitle } from './run-status'

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
      thoughts: [],
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

describe('#209 思考原文', () => {
  const reasoning = (delta: string): ChatStreamEvent => ({ ...ids, type: 'reasoning_delta', delta })

  it('思考短句：最新一句写完的话，中英文句末、没写完的不算、小数点不算句末', () => {
    assert.equal(latestThoughtSentence('用户想知道 React 19.2 官方列了哪些新特性，'), undefined)
    assert.equal(latestThoughtSentence('用户想知道 React 19.2 官方列了哪些新特性。先找'), '用户想知道 React 19.2 官方列了哪些新特性。')
    assert.equal(latestThoughtSentence('第一句话写完了。第二句也写完了！还在写'), '第二句也写完了！')
    assert.equal(latestThoughtSentence('要不要再搜一次呢？'), '要不要再搜一次呢？')
    assert.equal(latestThoughtSentence('先列出三个要点\n然后'), '先列出三个要点')
    // 英文句末要等到后面的空白才算写完：流末尾的点可能是小数点。
    assert.equal(latestThoughtSentence('The user asks about React 19.'), undefined)
    assert.equal(latestThoughtSentence('The user asks about React 19.2 features. Let me'), 'The user asks about React 19.2 features.')
    assert.equal(latestThoughtSentence('Is this the official list? Maybe'), 'Is this the official list?')
    // 右引号、右括号归前一句；e.g. / i.e. / vs. 不算句末。
    assert.equal(latestThoughtSentence('用户问：“React 19.2 有哪些新特性？”我需要先搜'), '用户问：“React 19.2 有哪些新特性？”')
    assert.equal(latestThoughtSentence('用户问：“有哪些新特性？”我需要先搜索官方博客。'), '我需要先搜索官方博客。')
    assert.equal(latestThoughtSentence('我需要先搜索。"React 19.2"是最新版本。'), '"React 19.2"是最新版本。')
    assert.equal(latestThoughtSentence('Check the notes (see the blog.) Then'), 'Check the notes (see the blog.)')
    assert.equal(latestThoughtSentence('We should check the docs, e.g. the release notes. Then'), 'We should check the docs, e.g. the release notes.')
    assert.equal(latestThoughtSentence('Compare React vs. Vue signals. Then'), 'Compare React vs. Vue signals.')
    assert.equal(latestThoughtSentence('E.g. this is fine. Then'), 'E.g. this is fine.')
    // 词尾恰好是 vs 的单词照常断句。
    assert.equal(latestThoughtSentence('Draw it on the canvas. Then'), 'Draw it on the canvas.')
  })

  it('思考短句：去掉 Markdown 符号、合并空白，短句跳过取更早的一句，超长原样交给 CSS 省略', () => {
    assert.equal(latestThoughtSentence('## **先查官方博客**\n'), '先查官方博客')
    assert.equal(latestThoughtSentence('- 看 `useEffectEvent` 的   文档。'), '看 useEffectEvent 的 文档。')
    assert.equal(latestThoughtSentence('> 引用里的一句话。'), '引用里的一句话。')
    assert.equal(latestThoughtSentence('> - 引用里的列表项内容。'), '引用里的列表项内容。')
    // 单个 * 与 _ 不是强调标记：乘号、Python 的 __init__ 保留。
    assert.equal(latestThoughtSentence('Use __init__ and a * b here. '), 'Use __init__ and a * b here.')
    assert.equal(latestThoughtSentence('先搜官方发布说明。好的。嗯。'), '先搜官方发布说明。')
    assert.equal(latestThoughtSentence('好的。嗯。'), undefined)
    // 列表序号「1.」后跟空格会被切成一句，但太短会被跳过。
    assert.equal(latestThoughtSentence('1. 先读官方博客\n2. '), '先读官方博客')

    const long = `${'很长的一句思考'.repeat(40)}。`

    assert.equal(latestThoughtSentence(long), long)
  })

  it('时间线文字：这一轮结束后末尾没有句末标点的半句也算写完；都太短时用整段', () => {
    assert.equal(thoughtTitle('先找官方说明。然后对比社区总结'), '然后对比社区总结')
    assert.equal(thoughtTitle('The user wants the list. Search the blog'), 'Search the blog')
    assert.equal(thoughtTitle('嗯。'), '嗯。')
    // 只有 Markdown 符号的一轮没有可显示的文字，时间线不出这一行。
    assert.equal(thoughtTitle('***\n'), '')
  })

  it('时间线思考行：原文去掉 Markdown 符号后只剩标题这一句时不展开', () => {
    assert.equal(thoughtHasMore('**Designing adaptable 3-day plan with city prompt**'), false)
    assert.equal(thoughtHasMore('先找官方发布说明。'), false)
    assert.equal(thoughtHasMore('嗯。'), false)
    assert.equal(thoughtHasMore('先找官方说明。然后对比社区总结'), true)
    assert.equal(thoughtHasMore('**Planning the answer**\n\nI should list the options first.'), true)
  })

  it('按轮切分：start 与每个 tool_finished 之后开始新一轮，到 tool_started 或正文开始为止', () => {
    const events: ChatStreamEvent[] = [
      reasoning('先搜'),
      reasoning('一下。'),
      { ...ids, type: 'tool_started', callId: 's', toolName: 'web_search', query: 'seo' },
      // 工具执行中不收原文。
      reasoning('不该出现'),
      { ...ids, type: 'tool_finished', callId: 's', ok: true },
      reasoning('结果够了。'),
      { ...ids, type: 'delta', contentDelta: '答' },
      // 正文开始后不再收这一轮的原文。
      reasoning('不该出现'),
      reasoning(''),
    ]
    let run = startRun(0)

    for (const event of events)
      run = applyRunEvent(run, event, 1)

    assert.deepEqual(run.thoughts, [{ at: 0, text: '先搜一下。' }, { at: 1, text: '结果够了。' }])
    // 空分片与结束后的原文都不产生新对象。
    assert.equal(applyRunEvent(run, reasoning(''), 2), run)

    const ended = endRun(run, 3, 'done')

    assert.equal(applyRunEvent(ended, reasoning('晚到'), 4), ended)
  })

  it('状态行只取这一轮的原文：新一轮还没写完第一句时是「思考中」，不沿用上一轮', () => {
    let run = startRun(0)

    run = applyRunEvent(run, reasoning('第一轮的思考写完了。'), 1)
    assert.equal(liveThought(run), '第一轮的思考写完了。')

    run = applyRunEvent(run, { ...ids, type: 'tool_started', callId: 's', toolName: 'web_search' }, 2)
    assert.equal(liveThought(run), undefined)
    run = applyRunEvent(run, { ...ids, type: 'tool_finished', callId: 's', ok: true }, 3)
    assert.equal(liveThought(run), undefined)
    run = applyRunEvent(run, reasoning('第二轮还没写完'), 4)
    assert.equal(liveThought(run), undefined)
    run = applyRunEvent(run, reasoning('，现在写完了。'), 5)
    assert.equal(liveThought(run), '第二轮还没写完，现在写完了。')
  })
})
