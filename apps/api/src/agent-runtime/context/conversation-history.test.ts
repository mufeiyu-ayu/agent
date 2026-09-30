import type { ModelInputItem } from '@agent/ai'
import type { Message } from '../../generated/prisma/client.js'
import type { HistoryStepRow } from './conversation-history.js'
import assert from 'node:assert/strict'
import { describe, it } from 'vitest'

import { MessageRole, MessageStatus } from '../../generated/prisma/client.js'
import { separateFromPreviousText, toHistoryGroups } from './conversation-history.js'

describe('toHistoryGroups 历史还原结构（#218 AC-01）', () => {
  it('一步多个工具、多步、带中间文本：还原为 user → tool_calls → 结果… → 最终回答，中间文本不重复', () => {
    // 与 runtime 相同的拼法：每轮文字与上一段隔一个空行。
    const content = joinRounds(['先搜一下。', '再打开网页看看。', '结论：React 19 新增了 Actions。'])
    const steps = [
      sampling(2, 'run-1:sampling-1', { toolCallCount: 2, intermediateText: '先搜一下。' }),
      tool(3, 'run-1:sampling-1', { callId: 'call-a', toolName: 'web_search', arguments: '{"query":"react 19"}', observation: '搜索结果 A' }),
      tool(4, 'run-1:sampling-1', { callId: 'call-b', toolName: 'web_search', arguments: '{"query":"react 19 actions"}', observation: '搜索结果 B' }),
      sampling(5, 'run-1:sampling-2', { toolCallCount: 1, intermediateText: '再打开网页看看。' }),
      tool(6, 'run-1:sampling-2', { callId: 'call-c', toolName: 'web_fetch', arguments: '{"url":"https://react.dev/blog"}', observation: '网页正文' }),
      sampling(8, 'run-1:sampling-3', { toolCallCount: 0 }),
    ]
    const [group] = toHistoryGroups(
      [userMessage('u1', 'react19 有哪些新特性'), answerMessage('a1', content)],
      shuffle(steps).map(step => ({ ...step, userMessageId: 'u1', assistantMessageId: 'a1' })),
    )

    assert.equal(group?.messageCount, 2)
    assert.deepEqual(group?.items, [
      { type: 'message', role: 'user', content: 'react19 有哪些新特性' },
      {
        type: 'assistant_tool_call',
        calls: [
          { callId: 'call-a', name: 'web_search', rawArgumentsJson: '{"query":"react 19"}' },
          { callId: 'call-b', name: 'web_search', rawArgumentsJson: '{"query":"react 19 actions"}' },
        ],
        reasoningContent: '',
        content: '先搜一下。',
      },
      { type: 'tool_result', callId: 'call-a', name: 'web_search', content: '搜索结果 A', ok: true },
      { type: 'tool_result', callId: 'call-b', name: 'web_search', content: '搜索结果 B', ok: true },
      {
        type: 'assistant_tool_call',
        calls: [{ callId: 'call-c', name: 'web_fetch', rawArgumentsJson: '{"url":"https://react.dev/blog"}' }],
        reasoningContent: '',
        content: '再打开网页看看。',
      },
      { type: 'tool_result', callId: 'call-c', name: 'web_fetch', content: '网页正文', ok: true },
      { type: 'message', role: 'assistant', content: '结论：React 19 新增了 Actions。' },
    ])
    // 中间文本只在 tool_calls 消息里出现一次，拼回去就是原回答。
    assert.equal(visibleText(group!.items), content)
  })

  it('ok=false 的调用、finishReason=length 的轮次与 {"arguments": raw} 包装的参数原样还原，不解包', () => {
    const wrapped = JSON.stringify({ arguments: '{"query": "react' })
    const steps = [
      // length 截断的一轮：整批没执行，每个 call 记失败并回喂。
      sampling(2, 'run-1:sampling-1', { toolCallCount: 1 }),
      tool(3, 'run-1:sampling-1', { callId: 'call-cut', toolName: 'web_search', arguments: wrapped, observation: '参数被截断', ok: false }),
      sampling(4, 'run-1:sampling-2', { toolCallCount: 1 }),
      tool(5, 'run-1:sampling-2', { callId: 'call-bad', toolName: 'web_fetch', arguments: '{"url":"https://a.example/"}', observation: '工具执行失败', ok: false }),
      sampling(6, 'run-1:sampling-3', { toolCallCount: 0 }),
    ]
    const [group] = toHistoryGroups(
      [userMessage('u1', '问题'), answerMessage('a1', '没查到。')],
      steps.map(step => ({ ...step, userMessageId: 'u1', assistantMessageId: 'a1' })),
    )

    assert.deepEqual(group?.items.slice(1), [
      { type: 'assistant_tool_call', calls: [{ callId: 'call-cut', name: 'web_search', rawArgumentsJson: wrapped }], reasoningContent: '' },
      { type: 'tool_result', callId: 'call-cut', name: 'web_search', content: '参数被截断', ok: false },
      { type: 'assistant_tool_call', calls: [{ callId: 'call-bad', name: 'web_fetch', rawArgumentsJson: '{"url":"https://a.example/"}' }], reasoningContent: '' },
      { type: 'tool_result', callId: 'call-bad', name: 'web_fetch', content: '工具执行失败', ok: false },
      { type: 'message', role: 'assistant', content: '没查到。' },
    ])
  })

  it('问题与回答按 Run 对应而不是按相邻位置：同一会话并发的两次问答各自配对', () => {
    const groups = toHistoryGroups(
      [userMessage('u1', '问题 1'), userMessage('u2', '问题 2'), answerMessage('a2', '回答 2'), answerMessage('a1', '回答 1')],
      [
        { ...emptyRow(), userMessageId: 'u1', assistantMessageId: 'a1' },
        { ...emptyRow(), userMessageId: 'u2', assistantMessageId: 'a2' },
      ],
    )

    assert.deepEqual(groups.map(group => group.items.map(item => item.type === 'message' ? item.content : item.type)), [
      ['问题 1', '回答 1'],
      ['问题 2', '回答 2'],
    ])
  })
})

describe('toHistoryGroups 边界（#218 AC-02）', () => {
  const toolSteps = [
    sampling(2, 'run-1:sampling-1', { toolCallCount: 1, intermediateText: '先搜。' }),
    tool(3, 'run-1:sampling-1', { callId: 'call-a', toolName: 'web_search', arguments: '{"query":"x"}', observation: '结果' }),
    sampling(4, 'run-1:sampling-2', { toolCallCount: 0 }),
  ]
  const plain = (content: string): ModelInputItem[] => [
    { type: 'message', role: 'user', content: '问题' },
    { type: 'message', role: 'assistant', content },
  ]
  const restore = (content: string, steps: Array<Omit<HistoryStepRow, 'userMessageId' | 'assistantMessageId'>>) => toHistoryGroups(
    [userMessage('u1', '问题'), answerMessage('a1', content)],
    steps.map(step => ({ ...step, userMessageId: 'u1', assistantMessageId: 'a1' })),
  )

  it('不带工具的问答照旧是一问一答；没有 Run 的回答（旧数据）按相邻位置并入前一组，只有最旧一组可能以回答开头', () => {
    assert.deepEqual(restore('回答', [sampling(2, 'run-1:sampling-1', { toolCallCount: 0 })]), [{ messageCount: 2, items: plain('回答') }])
    assert.deepEqual(restore('回答', [emptyRow()]), [{ messageCount: 2, items: plain('回答') }])
    assert.deepEqual(toHistoryGroups([userMessage('u1', '问题'), answerMessage('a1', '回答')], []), [{ messageCount: 2, items: plain('回答') }])
    assert.deepEqual(toHistoryGroups([answerMessage('a0', '更早的回答'), userMessage('u1', '问题'), answerMessage('a1', '回答')], []), [
      { messageCount: 1, items: [{ type: 'message', role: 'assistant', content: '更早的回答' }] },
      { messageCount: 2, items: plain('回答') },
    ])
  })

  it('空的回答不带（部分服务商拒收空内容），仍计入条数', () => {
    assert.deepEqual(restore('  ', [sampling(2, 'run-1:sampling-1', { toolCallCount: 0 })]), [
      { messageCount: 2, items: [{ type: 'message', role: 'user', content: '问题' }] },
    ])
  })

  it('只有问题没有回答的问答自成一组', () => {
    const groups = toHistoryGroups(
      [userMessage('u0', '没答完的问题'), userMessage('u1', '问题'), answerMessage('a1', '回答')],
      [{ ...emptyRow(), userMessageId: 'u1', assistantMessageId: 'a1' }],
    )

    assert.deepEqual(groups, [
      { messageCount: 1, items: [{ type: 'message', role: 'user', content: '没答完的问题' }] },
      { messageCount: 2, items: plain('回答') },
    ])
  })

  it('工具记录不完整或回答前缀对不上时，这次问答退回一问一答，不带半截记录', () => {
    const content = joinRounds(['先搜。', '结论。'])
    const [samplingStep, toolStep, finalStep] = toolSteps as [HistoryStepRow, HistoryStepRow, HistoryStepRow]
    const incomplete: Array<[string, Array<Omit<HistoryStepRow, 'userMessageId' | 'assistantMessageId'>>, string?]> = [
      ['缺 observation（被停止或进程中断的 Step）', [samplingStep, { ...toolStep, observation: null }, finalStep]],
      ['缺 arguments', [samplingStep, { ...toolStep, arguments: null }, finalStep]],
      ['工具 Step 对不上采样轮', [samplingStep, { ...toolStep, samplingAttemptId: 'run-1:sampling-9' }, finalStep]],
      ['工具 Step 数少于 toolCallCount', [{ ...samplingStep, toolCallCount: 2 }, toolStep, finalStep]],
      ['中间文本类型不对', [{ ...samplingStep, intermediateText: 42 }, toolStep, finalStep]],
      ['回答不以中间文本开头', [samplingStep, toolStep, finalStep], '结论。'],
      ['中间文本之后缺分隔符', [samplingStep, toolStep, finalStep], '先搜。结论。'],
    ]

    for (const [label, steps, answer = content] of incomplete)
      assert.deepEqual(restore(answer, steps), [{ messageCount: 2, items: plain(answer) }], label)
    // 对照：完整时正常还原。
    assert.equal(restore(content, toolSteps)[0]?.items.length, 4)
  })

  it('最终回答那一轮没有文字时不带空的 assistant（部分服务商拒收空内容）；中间文本以换行结尾时只补一个换行', () => {
    const [group] = restore('先搜。', toolSteps)

    assert.deepEqual(group?.items.map(item => item.type), ['message', 'assistant_tool_call', 'tool_result'])

    const endsWithNewline = [{ ...toolSteps[0]!, intermediateText: '先搜。\n' }, ...toolSteps.slice(1)]
    const [newlineGroup] = restore('先搜。\n\n结论。', endsWithNewline)

    assert.deepEqual(newlineGroup?.items.at(-1), { type: 'message', role: 'assistant', content: '结论。' })
  })
})

function joinRounds(rounds: string[]): string {
  return rounds.reduce((content, text) => content + separateFromPreviousText(content, text), '')
}

/** 还原出的各段文字按原规则拼回去，应当等于回答原文。 */
function visibleText(items: ModelInputItem[]): string {
  return items.reduce((content, item) => {
    const text = item.type === 'assistant_tool_call'
      ? item.content ?? ''
      : item.type === 'message' && item.role === 'assistant' ? item.content : ''

    return content + separateFromPreviousText(content, text)
  }, '')
}

function userMessage(id: string, content: string): Message {
  return message(id, MessageRole.USER, content)
}

function answerMessage(id: string, content: string): Message {
  return message(id, MessageRole.ASSISTANT, content)
}

function message(id: string, role: Message['role'], content: string): Message {
  const createdAt = new Date('2026-09-29T00:00:00.000Z')

  return { id, conversationId: 'conversation-1', role, content, status: MessageStatus.COMPLETED, createdAt, updatedAt: createdAt }
}

/** 没有采样与工具 Step 的 Run 也有一行，Step 列都为空。 */
function emptyRow(): HistoryStepRow {
  return {
    userMessageId: 'u1',
    assistantMessageId: 'a1',
    sequence: null,
    type: null,
    samplingAttemptId: null,
    toolCallCount: null,
    intermediateText: null,
    callId: null,
    toolName: null,
    arguments: null,
    observation: null,
    ok: null,
  }
}

function sampling(
  sequence: number,
  samplingAttemptId: string,
  output: { toolCallCount: number, intermediateText?: string },
): HistoryStepRow {
  return {
    ...emptyRow(),
    sequence,
    type: 'model_sampling',
    samplingAttemptId,
    toolCallCount: output.toolCallCount,
    intermediateText: output.intermediateText ?? null,
  }
}

function tool(
  sequence: number,
  samplingAttemptId: string,
  fields: { callId: string, toolName: string, arguments: string, observation: string, ok?: boolean },
): HistoryStepRow {
  return {
    ...emptyRow(),
    sequence,
    type: 'tool_execution',
    samplingAttemptId,
    callId: fields.callId,
    toolName: fields.toolName,
    arguments: fields.arguments,
    observation: fields.observation,
    ok: fields.ok ?? true,
  }
}

/** SQL 不排序：打乱顺序，还原只能靠 sequence。 */
function shuffle<T>(items: T[]): T[] {
  return [...items].reverse()
}
