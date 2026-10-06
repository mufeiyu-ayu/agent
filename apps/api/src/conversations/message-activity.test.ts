import type { MessageActivityStepRow } from './message-activity.js'
import assert from 'node:assert/strict'
import { describe, it } from 'vitest'

import { toMessageActivity } from './message-activity.js'

const STARTED_AT = new Date('2026-09-28T08:00:00.000Z')

describe('toMessageActivity（#212）', () => {
  it('AC-04 items 按 sequence 排列：思考排在同一轮的工具之前，最后一轮思考在最后；步骤输入乱序也一样', () => {
    const activity = toMessageActivity([
      toolStep(5, { callId: 'call-2', toolName: 'web_fetch', arguments: '{"url":"https://b.example/"}', ok: true, display: { finalUrl: 'https://b.example/final', title: '网页', chars: 1200 } }),
      samplingStep(6, { reasoningContent: '整理结果。', answerStartedMs: 9_400 }),
      samplingStep(2, { reasoningContent: '先搜一下。' }),
      toolStep(3, { callId: 'call-1', toolName: 'web_search', arguments: '{"query":"seo"}', ok: true, display: { results: [{ title: '来源', url: 'https://a.example/' }] } }),
      samplingStep(4, { reasoningContent: '再读网页。' }),
    ])

    assert.deepEqual(activity, {
      answerStartedMs: 9_400,
      toolBeforeAnswer: true,
      items: [
        { kind: 'thought', text: '先搜一下。' },
        { kind: 'tool', callId: 'call-1', toolName: 'web_search', query: 'seo', ok: true, durationMs: 1_500, results: [{ title: '来源', url: 'https://a.example/' }] },
        { kind: 'thought', text: '再读网页。' },
        { kind: 'tool', callId: 'call-2', toolName: 'web_fetch', url: 'https://b.example/', ok: true, durationMs: 1_500, finalUrl: 'https://b.example/final', title: '网页', chars: 1200 },
        { kind: 'thought', text: '整理结果。' },
      ],
    })
  })

  it('AC-04 没有工具、没有思考且正文不到 1 秒就开始时没有 activity；满 1 秒时只有「用时」', () => {
    assert.equal(toMessageActivity([samplingStep(2, { answerStartedMs: 999 })]), undefined)
    assert.equal(toMessageActivity([samplingStep(2, {})]), undefined)
    assert.equal(toMessageActivity([]), undefined)
    assert.deepEqual(toMessageActivity([samplingStep(2, { answerStartedMs: 1_000 })]), {
      answerStartedMs: 1_000,
      toolBeforeAnswer: false,
      items: [],
    })
  })

  it('正文在 Tool Call 轮开始时，那一轮之后的工具不算正文之前；正文前有工具时算', () => {
    const textFirst = toMessageActivity([
      samplingStep(2, { answerStartedMs: 400 }),
      toolStep(3, { ok: true }),
      samplingStep(4, { answerStartedMs: 400 }),
    ])
    const toolFirst = toMessageActivity([
      samplingStep(2, {}),
      toolStep(3, { ok: true }),
      samplingStep(4, { answerStartedMs: 400 }),
    ])

    assert.equal(textFirst?.toolBeforeAnswer, false)
    assert.equal(textFirst?.answerStartedMs, 400)
    assert.equal(toolFirst?.toolBeforeAnswer, true)
  })

  it('工具结局与 tool_finished 同一口径：自标失败、失败码、超时，以及没有收口结果的记为已停止', () => {
    const items = toMessageActivity([
      // 工具成功但自己标了失败（如内容类型不支持）。
      toolStep(2, { ok: true, display: { failure: 'failed', finalUrl: 'https://b.example/' } }),
      toolStep(3, { ok: false, code: 'timeout' }),
      toolStep(4, { ok: false, code: 'execution_failed' }),
      // 被停止 / deadline 打断：Step 没有收口结果。
      toolStep(5, { endedAt: null }),
    ])?.items

    assert.deepEqual(items?.map(item => item.kind === 'tool' && [item.ok, item.failure]), [
      [false, 'failed'],
      [false, 'timeout'],
      [false, 'failed'],
      [false, undefined],
    ])
    assert.equal(items?.[0]?.kind === 'tool' && items[0].finalUrl, 'https://b.example/')
  })

  it('指南重新规划保留未执行身份，不恢复成失败或成功', () => {
    const item = toMessageActivity([toolStep(2, { ok: false, code: 'workspace_replan' })])?.items[0]
    assert.ok(item?.kind === 'tool')
    assert.equal(item.ok, false)
    assert.equal(item.skipped, 'workspace_replan')
    assert.equal(item.failure, undefined)
  })

  it('AC-05 旧运行（没有 display / answerStartedMs / 最后一轮思考）按降级规则给出：不带来源与用时', () => {
    assert.deepEqual(toMessageActivity([
      samplingStep(2, { reasoningContent: 'Tool Call 轮的思考' }),
      toolStep(3, { callId: 'call-1', toolName: 'web_search', arguments: '{"query":"seo"}', ok: true }),
      samplingStep(4, {}),
    ]), {
      toolBeforeAnswer: true,
      items: [
        { kind: 'thought', text: 'Tool Call 轮的思考' },
        { kind: 'tool', callId: 'call-1', toolName: 'web_search', query: 'seo', ok: true, durationMs: 1_500 },
      ],
    })
  })

  it('AC-05 步骤 output 为 null 或结构不对、tool 步骤停在 RUNNING：不抛错，逐字段省略；没有工具名的不出行', () => {
    const activity = toMessageActivity([
      samplingStep(2, { reasoningContent: 42, answerStartedMs: '1000' }),
      samplingStep(3, { answerStartedMs: -5 }),
      // 进程中断遗留：RUNNING，没有结束时间、参数与结果（这里连 callId 也坏了）。
      toolStep(4, { endedAt: null, callId: null, toolName: 'web_fetch' }),
      toolStep(5, {
        arguments: '{not json',
        ok: true,
        display: { results: [{ title: 1, url: 'https://x.example/' }, 'bad', { title: '好', url: 'https://ok.example/' }], finalUrl: 3, title: null, chars: -1 },
      }),
      toolStep(6, { arguments: 7, ok: 'yes', display: 'broken' }),
      toolStep(7, { ok: true, display: { results: 'not-array' } }),
      // 工具名不是字符串或为空：只可能是损坏数据，跳过，不出一行空的「使用工具」。
      toolStep(8, { toolName: ['web_search'], ok: true }),
      toolStep(9, { toolName: '', ok: true }),
    ])

    assert.deepEqual(activity, {
      toolBeforeAnswer: true,
      items: [
        { kind: 'tool', callId: '', toolName: 'web_fetch', ok: false },
        { kind: 'tool', callId: 'call', toolName: 'web_search', ok: true, durationMs: 1_500, results: [{ title: '好', url: 'https://ok.example/' }] },
        { kind: 'tool', callId: 'call', toolName: 'web_search', ok: false, durationMs: 1_500 },
        { kind: 'tool', callId: 'call', toolName: 'web_search', ok: true, durationMs: 1_500 },
      ],
    })
  })

  it('没通过校验的参数回喂时包成 {"arguments": 原文}：拆开后照样取出查询词与网址，与 tool_started 一致', () => {
    const items = toMessageActivity([
      toolStep(2, { arguments: JSON.stringify({ arguments: '{"query":"seo","limit":5}' }), ok: false, code: 'invalid_arguments' }),
      toolStep(3, { toolName: 'web_fetch', arguments: JSON.stringify({ arguments: '{"url":"https://b.example/"' }), ok: false, code: 'truncated_arguments' }),
    ])?.items

    assert.deepEqual(items?.map(item => item.kind === 'tool' && [item.query, item.url]), [['seo', undefined], [undefined, undefined]])
  })

  it('来源最多 10 条，多带的字段不下发', () => {
    const results = Array.from({ length: 12 }, (_, index) => ({ title: `t${index}`, url: `https://s${index}.example/`, snippet: '摘要' }))
    const item = toMessageActivity([toolStep(2, { ok: true, display: { results } })])?.items[0]

    assert.equal(item?.kind === 'tool' && item.results?.length, 10)
    assert.deepEqual(item?.kind === 'tool' && item.results?.[0], { title: 't0', url: 'https://s0.example/' })
  })
})

function samplingStep(sequence: number, output: { reasoningContent?: unknown, answerStartedMs?: unknown }): MessageActivityStepRow {
  return {
    ...baseStep(sequence, 'model_sampling'),
    reasoningContent: output.reasoningContent ?? null,
    answerStartedMs: output.answerStartedMs ?? null,
  }
}

function toolStep(
  sequence: number,
  fields: Partial<Pick<MessageActivityStepRow, 'endedAt' | 'callId' | 'toolName' | 'arguments' | 'ok' | 'code' | 'display'>>,
): MessageActivityStepRow {
  return {
    ...baseStep(sequence, 'tool_execution'),
    callId: 'call',
    toolName: 'web_search',
    ...fields,
  }
}

function baseStep(sequence: number, type: string): MessageActivityStepRow {
  return {
    messageId: 'message-1',
    sequence,
    type,
    startedAt: STARTED_AT,
    endedAt: new Date(STARTED_AT.getTime() + 1_500),
    reasoningContent: null,
    answerStartedMs: null,
    callId: null,
    toolName: null,
    arguments: null,
    ok: null,
    code: null,
    display: null,
  }
}
