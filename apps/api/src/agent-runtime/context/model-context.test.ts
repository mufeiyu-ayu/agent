import assert from 'node:assert/strict'
import { describe, it } from 'vitest'

import { normalizeToolObservation } from '../../tools/core/tool-observation.js'
import { ModelContext } from './model-context.js'
import { roughTokens } from './token-estimate.js'

function createContext(): ModelContext {
  return ModelContext.fromHistory({
    instructions: [{ type: 'message', role: 'system', content: '系统提示词' }],
    initialHistory: [],
    currentUserMessage: { type: 'message', role: 'user', content: '问题' },
  })
}

function appendExchange(context: ModelContext, callId: string, observation: string): void {
  context.appendToolExchange({
    calls: [{ callId, toolName: 'web_fetch' }],
    intermediateText: '',
    reasoningContent: '思考',
    results: [{
      observation: normalizeToolObservation(observation, 20_000),
      ok: true,
      feedbackArgumentsJson: '{"url":"https://example.com"}',
    }],
  })
}

describe('ModelContext 同一问答内的用量锚点（#220 AC-01）', () => {
  it('问答第 1 次调用前没有锚点，全部粗估', () => {
    assert.equal(createContext().estimateFromUsageAnchor(), undefined)
  })

  it('有可用用量时 = 输入 + 输出 + 之后新增的工具结果粗估，那次采样的 tool_calls 消息不重复计', () => {
    const context = createContext()

    context.recordSamplingUsage({ inputTokens: 1_000, outputTokens: 50, totalTokens: 1_050 })
    appendExchange(context, 'call-1', '第一页正文')
    assert.equal(context.estimateFromUsageAnchor(), 1_050 + roughTokens('第一页正文'))

    // 下一次采样的用量已含第一轮结果：锚点前移，之前的结果不再加。
    context.recordSamplingUsage({ inputTokens: 1_200, outputTokens: 30 })
    appendExchange(context, 'call-2', '第二页')
    assert.equal(context.estimateFromUsageAnchor(), 1_230 + roughTokens('第二页'))
  })

  it('没有用量、缺输入或输出、合计为 0 时清掉锚点，下一次全部粗估；之后拿到用量再恢复', () => {
    const context = createContext()

    context.recordSamplingUsage({ inputTokens: 1_000, outputTokens: 50 })
    for (const usage of [null, { inputTokens: 1_000 }, { outputTokens: 50 }, { inputTokens: 0, outputTokens: 0 }]) {
      context.recordSamplingUsage(usage)
      assert.equal(context.estimateFromUsageAnchor(), undefined, JSON.stringify(usage))
    }

    context.recordSamplingUsage({ inputTokens: 900, outputTokens: 10 })
    assert.equal(context.estimateFromUsageAnchor(), 910)
  })

  it('已发出的内容被改动（删历史、缩短工具结果）后锚点失效', () => {
    const context = createContext()

    appendExchange(context, 'call-1', '很长的正文')
    context.recordSamplingUsage({ inputTokens: 1_000, outputTokens: 50 })
    context.commitPlan({
      excludedOldestHistoryGroups: 0,
      observations: [{ exchangeIndex: 0, resultIndex: 0, content: '很长的正文', contextBudgetPreviewChars: null }],
    })
    assert.equal(context.estimateFromUsageAnchor(), 1_050)

    context.commitPlan({
      excludedOldestHistoryGroups: 0,
      observations: [{ exchangeIndex: 0, resultIndex: 0, content: '缩短', contextBudgetPreviewChars: 2 }],
    })
    assert.equal(context.estimateFromUsageAnchor(), undefined)
  })
})
