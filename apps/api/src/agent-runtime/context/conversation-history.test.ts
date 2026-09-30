import type { ModelInputItem } from '@agent/ai'
import type { Message } from '../../generated/prisma/client.js'
import type { ConversationHistory, HistoryGroup, HistoryRunRow, HistoryStepRow } from './conversation-history.js'
import assert from 'node:assert/strict'
import { describe, it } from 'vitest'

import { MessageRole, MessageStatus } from '../../generated/prisma/client.js'
import {
  groupItems,
  historyItems,
  historySummaryMessage,
  pairHistory,
  restoreGroups,
  separateFromPreviousText,
  turnSummaryMessage,
} from './conversation-history.js'

describe('历史还原结构（#218 AC-01）', () => {
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
    const [group] = restore([userMessage('u1', 'react19 有哪些新特性'), answerMessage('a1', content)], [run('run-1', 'u1', 'a1')], shuffle(steps))

    assert.equal(group?.messageCount, 2)
    assert.deepEqual(groupItems(group!, false), [
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
    assert.equal(visibleText(group!.answer), content)
    // 退回形式是回答消息全文（含中间文本）。
    assert.deepEqual(group?.answerOnly, [{ type: 'message', role: 'assistant', content }])
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
    const [group] = restore([userMessage('u1', '问题'), answerMessage('a1', '没查到。')], [run('run-1', 'u1', 'a1')], steps)

    assert.deepEqual(group?.answer, [
      { type: 'assistant_tool_call', calls: [{ callId: 'call-cut', name: 'web_search', rawArgumentsJson: wrapped }], reasoningContent: '' },
      { type: 'tool_result', callId: 'call-cut', name: 'web_search', content: '参数被截断', ok: false },
      { type: 'assistant_tool_call', calls: [{ callId: 'call-bad', name: 'web_fetch', rawArgumentsJson: '{"url":"https://a.example/"}' }], reasoningContent: '' },
      { type: 'tool_result', callId: 'call-bad', name: 'web_fetch', content: '工具执行失败', ok: false },
      { type: 'message', role: 'assistant', content: '没查到。' },
    ])
  })

  it('问题与回答按 Run 对应而不是按相邻位置：同一会话并发的两次问答各自配对', () => {
    const groups = restore(
      [userMessage('u1', '问题 1'), userMessage('u2', '问题 2'), answerMessage('a2', '回答 2'), answerMessage('a1', '回答 1')],
      [run('r1', 'u1', 'a1'), run('r2', 'u2', 'a2')],
      [],
    )

    assert.deepEqual(groups.map(group => groupItems(group, false).map(item => item.type === 'message' ? item.content : item.type)), [
      ['问题 1', '回答 1'],
      ['问题 2', '回答 2'],
    ])
    assert.deepEqual(groups.map(group => group.key), ['u1', 'u2'])
  })
})

describe('历史还原边界（#218 AC-02）', () => {
  const toolSteps = [
    sampling(2, 'run-1:sampling-1', { toolCallCount: 1, intermediateText: '先搜。' }),
    tool(3, 'run-1:sampling-1', { callId: 'call-a', toolName: 'web_search', arguments: '{"query":"x"}', observation: '结果' }),
    sampling(4, 'run-1:sampling-2', { toolCallCount: 0 }),
  ]
  const plain = (content: string): ModelInputItem[] => [
    { type: 'message', role: 'user', content: '问题' },
    { type: 'message', role: 'assistant', content },
  ]
  const restoreOne = (content: string, steps: HistoryStepRow[]) => shown(restore(
    [userMessage('u1', '问题'), answerMessage('a1', content)],
    [run('run-1', 'u1', 'a1')],
    steps,
  ))

  it('不带工具的问答照旧是一问一答；没有 Run 的回答（旧数据）按相邻位置并入前一组，只有最旧一组可能以回答开头', () => {
    assert.deepEqual(restoreOne('回答', [sampling(2, 'run-1:sampling-1', { toolCallCount: 0 })]), [{ messageCount: 2, items: plain('回答') }])
    assert.deepEqual(restoreOne('回答', []), [{ messageCount: 2, items: plain('回答') }])
    assert.deepEqual(shown(restore([userMessage('u1', '问题'), answerMessage('a1', '回答')], [], [])), [{ messageCount: 2, items: plain('回答') }])

    const groups = restore([answerMessage('a0', '更早的回答'), userMessage('u1', '问题'), answerMessage('a1', '回答')], [], [])

    assert.deepEqual(shown(groups), [
      { messageCount: 1, items: [{ type: 'message', role: 'assistant', content: '更早的回答' }] },
      { messageCount: 2, items: plain('回答') },
    ])
    // 没有问题的最旧一组以它的第一条回答作组键。
    assert.deepEqual(groups.map(group => group.key), ['a0', 'u1'])
  })

  it('空的回答不带（部分服务商拒收空内容），仍计入条数', () => {
    assert.deepEqual(restoreOne('  ', [sampling(2, 'run-1:sampling-1', { toolCallCount: 0 })]), [
      { messageCount: 2, items: [{ type: 'message', role: 'user', content: '问题' }] },
    ])
  })

  it('只有问题没有回答的问答自成一组', () => {
    const groups = restore(
      [userMessage('u0', '没答完的问题'), userMessage('u1', '问题'), answerMessage('a1', '回答')],
      [run('r0', 'u0', null, 'FAILED'), run('r1', 'u1', 'a1')],
      [],
    )

    assert.deepEqual(shown(groups), [
      { messageCount: 1, items: [{ type: 'message', role: 'user', content: '没答完的问题' }] },
      { messageCount: 2, items: plain('回答') },
    ])
    assert.deepEqual(groups.map(group => group.answered), [false, true])
  })

  it('工具记录不完整或回答前缀对不上时，这次问答退回一问一答，不带半截记录', () => {
    const content = joinRounds(['先搜。', '结论。'])
    const [samplingStep, toolStep, finalStep] = toolSteps as [HistoryStepRow, HistoryStepRow, HistoryStepRow]
    const incomplete: Array<[string, HistoryStepRow[], string?]> = [
      ['缺 observation（被停止或进程中断的 Step）', [samplingStep, { ...toolStep, observation: null }, finalStep]],
      ['缺 arguments', [samplingStep, { ...toolStep, arguments: null }, finalStep]],
      ['工具 Step 对不上采样轮', [samplingStep, { ...toolStep, samplingAttemptId: 'run-1:sampling-9' }, finalStep]],
      ['工具 Step 数少于 toolCallCount', [{ ...samplingStep, toolCallCount: 2 }, toolStep, finalStep]],
      ['中间文本类型不对', [{ ...samplingStep, intermediateText: 42 }, toolStep, finalStep]],
      ['回答不以中间文本开头', [samplingStep, toolStep, finalStep], '结论。'],
      ['中间文本之后缺分隔符', [samplingStep, toolStep, finalStep], '先搜。结论。'],
    ]

    for (const [label, steps, answer = content] of incomplete)
      assert.deepEqual(restoreOne(answer, steps), [{ messageCount: 2, items: plain(answer) }], label)
    // 对照：完整时正常还原。
    assert.equal(restoreOne(content, toolSteps)[0]?.items.length, 4)
  })

  it('最终回答那一轮没有文字时不带空的 assistant（部分服务商拒收空内容）；中间文本以换行结尾时只补一个换行', () => {
    const [group] = restoreOne('先搜。', toolSteps)

    assert.deepEqual(group?.items.map(item => item.type), ['message', 'assistant_tool_call', 'tool_result'])

    const endsWithNewline = [{ ...toolSteps[0]!, intermediateText: '先搜。\n' }, ...toolSteps.slice(1)]
    const [newlineGroup] = restoreOne('先搜。\n\n结论。', endsWithNewline)

    assert.deepEqual(newlineGroup?.items.at(-1), { type: 'message', role: 'assistant', content: '结论。' })
  })
})

describe('能否进摘要（#220 AC-02）', () => {
  it('按读取时的快照：Run 全部终态或没有 Run 但有回答可以进摘要；进行中、卡住、没有 Run 也没有回答的不行', () => {
    const groups = pairHistory(
      [
        answerMessage('a0', '没有问题的旧回答'),
        userMessage('u1', '完成的问答'),
        answerMessage('a1', '回答'),
        userMessage('u2', '失败的问答'),
        userMessage('u3', '停止的问答'),
        userMessage('u4', '进行中的问答'),
        userMessage('u5', '旧数据：没有 Run 的问答'),
        answerMessage('a5', '旧回答'),
        userMessage('u6', '旧数据：没有 Run 也没有回答'),
        userMessage('u7', '重试过、仍有一次在进行'),
      ],
      [
        run('r1', 'u1', 'a1'),
        run('r2', 'u2', 'x2', 'FAILED'),
        run('r3', 'u3', 'x3', 'ABORTED'),
        run('r4', 'u4', 'x4', 'RUNNING'),
        run('r7a', 'u7', 'x7a', 'FAILED'),
        run('r7b', 'u7', 'x7b', 'RUNNING'),
      ],
    )

    assert.deepEqual(groups.map(group => [group.key, group.summarizable]), [
      ['a0', true],
      ['u1', true],
      ['u2', true],
      ['u3', true],
      ['u4', false],
      ['u5', true],
      ['u6', false],
      ['u7', false],
    ])
  })
})

describe('做过本轮压缩的问答按压缩后形态还原（#220 AC-03）', () => {
  const content = joinRounds(['先搜。', '再打开第一页。', '再打开第二页。', '结论。'])
  const steps = [
    sampling(2, 'run-1:sampling-1', { toolCallCount: 1, intermediateText: '先搜。' }),
    tool(3, 'run-1:sampling-1', { callId: 'call-a', toolName: 'web_search', arguments: '{"query":"x"}', observation: '搜索结果' }),
    sampling(4, 'run-1:sampling-2', { toolCallCount: 1, intermediateText: '再打开第一页。' }),
    tool(5, 'run-1:sampling-2', { callId: 'call-b', toolName: 'web_fetch', arguments: '{"url":"https://a.example/"}', observation: '第一页' }),
    turnCompaction(6, 'run-1:sampling-2', '前缀摘要 1'),
    sampling(7, 'run-1:sampling-3', { toolCallCount: 1, intermediateText: '再打开第二页。' }),
    tool(8, 'run-1:sampling-3', { callId: 'call-c', toolName: 'web_fetch', arguments: '{"url":"https://b.example/"}', observation: '第二页' }),
    turnCompaction(9, 'run-1:sampling-3', '前缀摘要 2'),
    sampling(10, 'run-1:sampling-4', { toolCallCount: 0 }),
  ]
  const restoreTurn = (turnSteps: HistoryStepRow[]) => restore(
    [userMessage('u1', '打开两页后总结'), answerMessage('a1', content)],
    [run('run-1', 'u1', 'a1')],
    turnSteps,
  )[0]!

  it('按最后一条成功的本轮压缩：问题 + 前缀摘要 + 从保留起点那一轮起的工具轮 + 最终回答；最终回答按全部轮的中间文本去前缀', () => {
    assert.deepEqual(groupItems(restoreTurn(shuffle(steps)), false), [
      { type: 'message', role: 'user', content: '打开两页后总结' },
      turnSummaryMessage('前缀摘要 2'),
      {
        type: 'assistant_tool_call',
        calls: [{ callId: 'call-c', name: 'web_fetch', rawArgumentsJson: '{"url":"https://b.example/"}' }],
        reasoningContent: '',
        content: '再打开第二页。',
      },
      { type: 'tool_result', callId: 'call-c', name: 'web_fetch', content: '第二页', ok: true },
      { type: 'message', role: 'assistant', content: '结论。' },
    ])
  })

  it('保留起点对不上、摘要缺失或工具记录不完整时退回一问一答，不带前缀摘要', () => {
    const cases: Array<[string, HistoryStepRow[]]> = [
      ['保留起点那一轮不存在', [...steps.slice(0, 7), turnCompaction(9, 'run-1:sampling-9', '前缀摘要 2'), steps[8]!]],
      ['摘要缺失', [...steps.slice(0, 7), { ...steps[7]!, summary: null }, steps[8]!]],
      ['更早的工具轮缺 observation', [steps[0]!, { ...steps[1]!, observation: null }, ...steps.slice(2)]],
    ]

    for (const [label, turnSteps] of cases) {
      assert.deepEqual(groupItems(restoreTurn(turnSteps), false), [
        { type: 'message', role: 'user', content: '打开两页后总结' },
        { type: 'message', role: 'assistant', content },
      ], label)
    }
  })
})

describe('historyItems：压缩记录的摘要 + 未覆盖的组（#220 AC-05）', () => {
  it('摘要消息在最前，边界组用退回形式，其余按还原形态', () => {
    const boundaryAnswer = joinRounds(['先搜。', '边界组的回答。'])
    const history: ConversationHistory = {
      readAt: new Date('2026-09-30T00:00:00.000Z'),
      // u1 已被摘要覆盖（读历史时已去掉），u2 是以退回形式保留的边界组。
      compaction: { id: 'compaction-1', summary: '## Goal\n旧摘要', coveredGroupIds: ['u1'], answerOnlyGroupId: 'u2' },
      groups: restore(
        [userMessage('u2', '边界组的问题'), answerMessage('a2', boundaryAnswer), userMessage('u3', '最近的问题'), answerMessage('a3', '最近的回答')],
        [run('r2', 'u2', 'a2'), run('r3', 'u3', 'a3')],
        [
          sampling(2, 'r2:sampling-1', { toolCallCount: 1, intermediateText: '先搜。' }, 'r2'),
          tool(3, 'r2:sampling-1', { callId: 'call-a', toolName: 'web_search', arguments: '{"query":"x"}', observation: '结果' }, 'r2'),
        ],
      ),
    }

    assert.deepEqual(historyItems(history), [
      historySummaryMessage('## Goal\n旧摘要'),
      { type: 'message', role: 'user', content: '边界组的问题' },
      { type: 'message', role: 'assistant', content: boundaryAnswer },
      { type: 'message', role: 'user', content: '最近的问题' },
      { type: 'message', role: 'assistant', content: '最近的回答' },
    ])
    assert.match(historySummaryMessage('X').content, /只回答这条摘要之后用户的最新消息/)
    assert.match(historySummaryMessage('X').content, /\n\n<summary>\nX\n<\/summary>$/)
  })
})

function restore(messages: Message[], runs: HistoryRunRow[], steps: HistoryStepRow[]): HistoryGroup[] {
  return restoreGroups(pairHistory(messages, runs), steps)
}

/** 旧用例关心的两项：条数与按还原形态发给模型的样子。 */
function shown(groups: HistoryGroup[]): Array<{ messageCount: number, items: ModelInputItem[] }> {
  return groups.map(group => ({ messageCount: group.messageCount, items: groupItems(group, false) }))
}

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

function run(id: string, userMessageId: string, assistantMessageId: string | null, status: HistoryRunRow['status'] = 'COMPLETED'): HistoryRunRow {
  return { id, userMessageId, assistantMessageId, status }
}

function emptyRow(runId: string): Omit<HistoryStepRow, 'sequence' | 'type'> {
  return {
    runId,
    samplingAttemptId: null,
    toolCallCount: null,
    intermediateText: null,
    callId: null,
    toolName: null,
    arguments: null,
    observation: null,
    ok: null,
    keptFromSamplingAttemptId: null,
    summary: null,
  }
}

function sampling(
  sequence: number,
  samplingAttemptId: string,
  output: { toolCallCount: number, intermediateText?: string },
  runId = 'run-1',
): HistoryStepRow {
  return {
    ...emptyRow(runId),
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
  runId = 'run-1',
): HistoryStepRow {
  return {
    ...emptyRow(runId),
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

/** SQL 只取成功的本轮压缩 Step。 */
function turnCompaction(sequence: number, keptFromSamplingAttemptId: string, summary: string): HistoryStepRow {
  return { ...emptyRow('run-1'), sequence, type: 'context_compaction', keptFromSamplingAttemptId, summary }
}

/** SQL 不排序：打乱顺序，还原只能靠 sequence。 */
function shuffle<T>(items: T[]): T[] {
  return [...items].reverse()
}
