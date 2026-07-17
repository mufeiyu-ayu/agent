import type { ModelStreamEvent } from '../llm/model-stream.types.js'
import assert from 'node:assert/strict'
// 项目使用 Node 原生测试运行器，不引入新测试框架。
// eslint-disable-next-line test/no-import-node-test
import { describe, it } from 'node:test'

import { ModelSamplingIncompleteError } from './agent-runtime.errors.js'
import { streamModelSampling } from './model-sampling-decision.js'

describe('streamModelSampling', () => {
  it('实时 yield 最终回答，并返回 stop sampling 安全汇总', async () => {
    const completionGate = createDeferred()
    const sampling = streamModelSampling(
      delayedCompletionStream(completionGate.promise),
      'run-1:sampling-1',
    )

    const firstDeltaPromise = sampling.next()
    const yieldedBeforeCompletion = await Promise.race([
      firstDeltaPromise.then(() => true),
      new Promise<false>(resolve => setImmediate(() => resolve(false))),
    ])

    assert.equal(yieldedBeforeCompletion, true)
    assert.deepEqual(await firstDeltaPromise, {
      done: false,
      value: '实时',
    })

    completionGate.resolve()
    const result = await sampling.next()

    assert.equal(result.done, true)
    assert.deepEqual(result.value, {
      type: 'final_answer',
      summary: {
        samplingAttemptId: 'run-1:sampling-1',
        finishReason: 'stop',
        usage: {
          inputTokens: 3,
          outputTokens: 2,
          totalTokens: 5,
        },
        toolCallCount: 0,
        textChars: 2,
        intermediateTextChars: 0,
      },
    })
  })

  it('按 usage snapshot 合并已定义字段，不累加 token', async () => {
    const { decision } = await collectSampling([
      { type: 'usage', usage: { inputTokens: 3, totalTokens: 3 } },
      { type: 'usage', usage: { outputTokens: 2, totalTokens: 5 } },
      { type: 'usage', usage: { inputTokens: 4 } },
      { type: 'response_completed', finishReason: 'stop' },
    ])

    assert.equal(decision.type, 'final_answer')
    assert.deepEqual(decision.summary.usage, {
      inputTokens: 4,
      outputTokens: 2,
      totalTokens: 5,
    })
  })

  it('usage 缺失时返回 null，不伪造 0', async () => {
    const { decision } = await collectSampling([
      { type: 'response_completed', finishReason: 'stop' },
    ])

    assert.equal(decision.type, 'final_answer')
    assert.equal(decision.summary.usage, null)
  })

  it('返回 tool_calls 汇总，并只统计不对 UI yield 的中间文本', async () => {
    const { decision, deltas } = await collectSampling([
      toolCallEvent('call-1', 'search_articles', '{"query":"seo"}'),
      { type: 'text_delta', delta: '查询中' },
      { type: 'usage', usage: { totalTokens: 8 } },
      { type: 'response_completed', finishReason: 'tool_calls' },
    ], 'run-1:sampling-2')

    assert.deepEqual(deltas, [])
    assert.deepEqual(decision, {
      type: 'tool_call',
      call: {
        callId: 'call-1',
        toolName: 'search_articles',
        rawArgumentsJson: '{"query":"seo"}',
        samplingAttemptId: 'run-1:sampling-2',
      },
      intermediateText: '查询中',
      summary: {
        samplingAttemptId: 'run-1:sampling-2',
        finishReason: 'tool_calls',
        usage: { totalTokens: 8 },
        toolCallCount: 1,
        textChars: 3,
        intermediateTextChars: 3,
      },
    })
  })

  it('缺少 response_completed 时携带不含原文的 partial summary', async () => {
    await assert.rejects(
      collectSampling([
        { type: 'text_delta', delta: '部分文本' },
      ]),
      (error) => {
        assert.ok(error instanceof ModelSamplingIncompleteError)
        assert.deepEqual(error.summary, {
          samplingAttemptId: 'run-1:sampling-1',
          finishReason: null,
          usage: null,
          toolCallCount: 0,
          textChars: 4,
          intermediateTextChars: 0,
        })
        assert.doesNotMatch(JSON.stringify(error.summary), /部分文本/)
        return true
      },
    )
  })

  it('Tool Call 与 finish reason 冲突时携带脱敏 partial summary', async () => {
    const secret = 'sk-secret-123'

    await assert.rejects(
      collectSampling([
        toolCallEvent('call-1', 'search_articles', `{"password":"${secret}"}`),
        { type: 'response_completed', finishReason: 'stop' },
      ]),
      (error) => {
        assert.ok(error instanceof ModelSamplingIncompleteError)
        assert.deepEqual(error.summary, {
          samplingAttemptId: 'run-1:sampling-1',
          finishReason: 'stop',
          usage: null,
          toolCallCount: 1,
          textChars: 0,
          intermediateTextChars: 0,
        })
        assert.doesNotMatch(JSON.stringify(error), new RegExp(secret))
        assert.doesNotMatch(error.message, new RegExp(secret))
        return true
      },
    )
  })

  it('非完整 finish reason 失败时保留 finish reason 和 usage', async () => {
    await assert.rejects(
      collectSampling([
        { type: 'text_delta', delta: '未完成' },
        { type: 'usage', usage: { inputTokens: 5 } },
        { type: 'response_completed', finishReason: 'length' },
      ]),
      (error) => {
        assert.ok(error instanceof ModelSamplingIncompleteError)
        assert.deepEqual(error.summary, {
          samplingAttemptId: 'run-1:sampling-1',
          finishReason: 'length',
          usage: { inputTokens: 5 },
          toolCallCount: 0,
          textChars: 3,
          intermediateTextChars: 0,
        })
        return true
      },
    )
  })
})

async function collectSampling(
  events: ModelStreamEvent[],
  samplingAttemptId = 'run-1:sampling-1',
) {
  const sampling = streamModelSampling(toModelStream(events), samplingAttemptId)
  const deltas: string[] = []
  let result = await sampling.next()

  while (!result.done) {
    deltas.push(result.value)
    result = await sampling.next()
  }

  return {
    decision: result.value,
    deltas,
  }
}

async function* toModelStream(
  events: ModelStreamEvent[],
): AsyncGenerator<ModelStreamEvent> {
  yield* events
}

async function* delayedCompletionStream(
  completionGate: Promise<void>,
): AsyncGenerator<ModelStreamEvent> {
  yield { type: 'text_delta', delta: '实时' }
  await completionGate
  yield {
    type: 'usage',
    usage: {
      inputTokens: 3,
      outputTokens: 2,
      totalTokens: 5,
    },
  }
  yield { type: 'response_completed', finishReason: 'stop' }
}

function toolCallEvent(
  providerCallId: string,
  name: string,
  argumentsJson: string,
): ModelStreamEvent {
  return {
    type: 'tool_call_completed',
    toolCall: {
      providerCallId,
      name,
      argumentsJson,
      index: 0,
    },
  }
}

function createDeferred(): {
  promise: Promise<void>
  resolve: () => void
} {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })

  return { promise, resolve }
}
