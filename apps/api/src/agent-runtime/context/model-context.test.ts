import type { ModelToolSpec } from '@agent/ai'
import type { ConversationHistory, HistoryGroup } from './conversation-history.js'
import assert from 'node:assert/strict'
import { describe, it } from 'vitest'

import { historySummaryMessage, turnSummaryMessage } from './conversation-history.js'
import { ModelContext, toFeedbackArgumentsJson } from './model-context.js'
import { estimateRequestTokens, roughTokens } from './token-estimate.js'

const TOOLS: ModelToolSpec[] = []

function group(key: string, question: string, answer: string, summarizable = true): HistoryGroup {
  return {
    key,
    messageCount: 2,
    summarizable,
    answered: true,
    question: { content: question, createdAt: new Date('2026-09-29T00:00:00.000Z') },
    answer: [{ type: 'message', role: 'assistant', content: answer }],
    answerOnly: [{ type: 'message', role: 'assistant', content: answer }],
  }
}

function createContext(history: Partial<ConversationHistory> = {}): ModelContext {
  return ModelContext.create({
    instructions: [{ type: 'message', role: 'system', content: 'SYS' }],
    history: { readAt: new Date('2026-09-30T00:00:00.000Z'), compaction: undefined, groups: [], ...history },
    currentUser: { content: 'USER', createdAt: new Date('2026-09-30T00:00:00.000Z') },
  })
}

function appendExchange(context: ModelContext, attempt: number, observation: string): void {
  context.appendToolExchange({
    samplingAttemptId: `run-1:sampling-${attempt}`,
    calls: [{ callId: `call-${attempt}`, toolName: 'web_fetch' }],
    intermediateText: '',
    reasoningContent: `思考 ${attempt}`,
    results: [{ content: observation, ok: true, feedbackArgumentsJson: '{"url":"https://example.com"}' }],
  })
}

describe('ModelContext 输入顺序', () => {
  it('系统提示词 → 历史 → 当前问题 → 工具轮；同轮多个 call 一条 assistant 消息后接按 callId 配对的结果', () => {
    const context = createContext({ groups: [group('u1', '旧问题', '旧回答')] })

    assert.deepEqual(context.plan(TOOLS).items, [
      { type: 'message', role: 'system', content: 'SYS' },
      { type: 'message', role: 'user', content: '旧问题' },
      { type: 'message', role: 'assistant', content: '旧回答' },
      { type: 'message', role: 'user', content: 'USER' },
    ])

    context.appendToolExchange({
      samplingAttemptId: 'run-1:sampling-1',
      calls: [{ callId: 'c2', toolName: 't2' }, { callId: 'c3', toolName: 't3' }],
      intermediateText: 'J',
      reasoningContent: 'S',
      results: [
        // 未校验的原始参数：续轮用官方回退形状承载，原文保留在值里。
        { content: 'P', ok: false, feedbackArgumentsJson: toFeedbackArgumentsJson('B', false) },
        { content: 'Q', ok: true, feedbackArgumentsJson: toFeedbackArgumentsJson('C', true) },
      ],
    })

    assert.deepEqual(context.plan(TOOLS).items.slice(-3), [
      {
        type: 'assistant_tool_call',
        calls: [
          { callId: 'c2', name: 't2', rawArgumentsJson: '{"arguments":"B"}' },
          { callId: 'c3', name: 't3', rawArgumentsJson: 'C' },
        ],
        reasoningContent: 'S',
        content: 'J',
      },
      { type: 'tool_result', callId: 'c2', name: 't2', content: 'P', ok: false },
      { type: 'tool_result', callId: 'c3', name: 't3', content: 'Q', ok: true },
    ])
    assert.throws(
      () => context.appendToolExchange({ samplingAttemptId: 'run-1:sampling-2', calls: [], intermediateText: '', reasoningContent: '', results: [] }),
      RangeError,
    )
  })

  it('换入历史压缩记录：摘要消息在历史最前，被覆盖的组去掉，边界组用退回形式；未覆盖部分按条数记', () => {
    const boundary = { ...group('u2', '边界问题', '完整回答'), answer: [{ type: 'message' as const, role: 'assistant' as const, content: '还原形态' }] }
    const context = createContext({ groups: [group('u1', '旧问题', '旧回答'), boundary, group('u3', '新问题', '新回答')] })

    context.applyHistoryCompaction({ id: 'compaction-1', summary: '摘要', coveredGroupIds: ['u1'], answerOnlyGroupId: 'u2' })

    const plan = context.plan(TOOLS)

    assert.deepEqual(plan.items.slice(1, -1), [
      historySummaryMessage('摘要'),
      { type: 'message', role: 'user', content: '边界问题' },
      { type: 'message', role: 'assistant', content: '完整回答' },
      { type: 'message', role: 'user', content: '新问题' },
      { type: 'message', role: 'assistant', content: '新回答' },
    ])
    assert.equal(plan.compactionId, 'compaction-1')
    assert.equal(plan.historyIncludedCount, 4)
  })

  it('本轮压缩后：当前问题原样、其后是前缀摘要与保留起点起的工具轮，保留轮的 reasoning 是原文', () => {
    const context = createContext()

    appendExchange(context, 1, '第一页')
    appendExchange(context, 2, '第二页')
    appendExchange(context, 3, '第三页')
    context.applyTurnCompaction({ stepId: 'step-9', summary: '前缀摘要', keptFrom: 2 })

    const plan = context.plan(TOOLS)

    assert.deepEqual(plan.items.slice(1), [
      { type: 'message', role: 'user', content: 'USER' },
      turnSummaryMessage('前缀摘要'),
      {
        type: 'assistant_tool_call',
        calls: [{ callId: 'call-3', name: 'web_fetch', rawArgumentsJson: '{"url":"https://example.com"}' }],
        reasoningContent: '思考 3',
      },
      { type: 'tool_result', callId: 'call-3', name: 'web_fetch', content: '第三页', ok: true },
    ])
    assert.equal(plan.turnCompactionStepId, 'step-9')
  })
})

describe('ModelContext 同一问答内的用量锚点（#220 AC-01）', () => {
  const fullEstimate = (context: ModelContext) => estimateRequestTokens({ items: context.plan(TOOLS).items, tools: TOOLS })

  it('问答第 1 次调用前没有锚点，整份粗估', () => {
    const context = createContext({ groups: [group('u1', '旧问题', '旧回答')] })

    assert.equal(context.estimateInputTokens(TOOLS), fullEstimate(context))
  })

  it('有可用用量时 = 输入 + 输出 + 之后新增的工具结果粗估，那次采样的 tool_calls 消息不重复计', () => {
    const context = createContext()

    context.recordSamplingUsage({ inputTokens: 1_000, outputTokens: 50, totalTokens: 1_050 })
    appendExchange(context, 1, '第一页正文')
    assert.equal(context.estimateInputTokens(TOOLS), 1_050 + roughTokens('第一页正文'))

    // 下一次采样的用量已含第一轮结果：锚点前移，之前的结果不再加。
    context.recordSamplingUsage({ inputTokens: 1_200, outputTokens: 30 })
    appendExchange(context, 2, '第二页')
    assert.equal(context.estimateInputTokens(TOOLS), 1_230 + roughTokens('第二页'))
  })

  it('没有用量、缺输入或输出、合计为 0、采样失败时整份粗估；之后拿到用量再恢复', () => {
    const context = createContext()

    appendExchange(context, 1, '正文')
    for (const usage of [null, { inputTokens: 1_000 }, { outputTokens: 50 }, { inputTokens: 0, outputTokens: 0 }]) {
      context.recordSamplingUsage({ inputTokens: 1_000, outputTokens: 50 })
      context.recordSamplingUsage(usage)
      assert.equal(context.estimateInputTokens(TOOLS), fullEstimate(context), JSON.stringify(usage))
    }

    context.recordSamplingUsage({ inputTokens: 900, outputTokens: 10 })
    context.forgetSamplingUsage()
    assert.equal(context.estimateInputTokens(TOOLS), fullEstimate(context))

    context.recordSamplingUsage({ inputTokens: 900, outputTokens: 10 })
    assert.equal(context.estimateInputTokens(TOOLS), 910)
  })

  it('压缩（历史或本轮）之后整份粗估，压缩后的采样拿到用量再恢复', () => {
    const context = createContext({ groups: [group('u1', '旧问题', '旧回答')] })

    appendExchange(context, 1, '第一页')
    appendExchange(context, 2, '第二页')
    context.recordSamplingUsage({ inputTokens: 5_000, outputTokens: 50 })
    context.applyHistoryCompaction({ id: 'compaction-1', summary: '摘要', coveredGroupIds: ['u1'], answerOnlyGroupId: null })
    assert.equal(context.estimateInputTokens(TOOLS), fullEstimate(context))

    context.recordSamplingUsage({ inputTokens: 3_000, outputTokens: 50 })
    context.applyTurnCompaction({ stepId: 'step-1', summary: '前缀', keptFrom: 1 })
    assert.equal(context.estimateInputTokens(TOOLS), fullEstimate(context))

    context.recordSamplingUsage({ inputTokens: 2_000, outputTokens: 20 })
    assert.equal(context.estimateInputTokens(TOOLS), 2_020)
  })
})
