import type { ModelStreamEvent } from '@agent/ai'
import assert from 'node:assert/strict'
// 项目使用 Node 原生测试运行器，不引入新测试框架。
// eslint-disable-next-line test/no-import-node-test
import { describe, it } from 'node:test'

import { ModelSamplingIncompleteError } from '../agent-runtime.errors.js'
import { streamModelSampling } from './model-sampling-decision.js'

/** 默认时钟：请求在 1_000 发出，之后每次读数都是 1_000 + FIRST_EVENT_DELAY_MS。 */
const FIRST_EVENT_DELAY_MS = 42

describe('streamModelSampling', () => {
  it('实时 yield 最终回答，并返回 stop sampling 安全汇总', async () => {
    const completionGate = createDeferred()
    const sampling = streamModelSampling(
      delayedCompletionStream(completionGate.promise),
      'run-1:sampling-1',
      createClock(),
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
        firstTokenMs: FIRST_EVENT_DELAY_MS,
      },
    })
  })

  it('按 usage snapshot 合并已定义字段，不累加 token', async () => {
    const { decision } = await collectSampling([
      {
        type: 'usage',
        usage: {
          inputTokens: 3,
          totalTokens: 3,
          promptCacheHitTokens: 2,
        },
      },
      {
        type: 'usage',
        usage: {
          outputTokens: 2,
          totalTokens: 5,
          reasoningTokens: 1,
          promptCacheMissTokens: 1,
        },
      },
      { type: 'usage', usage: { inputTokens: 4, promptCacheHitTokens: 3 } },
      { type: 'response_completed', finishReason: 'stop' },
    ])

    assert.equal(decision.type, 'final_answer')
    assert.deepEqual(decision.summary.usage, {
      inputTokens: 4,
      outputTokens: 2,
      totalTokens: 5,
      reasoningTokens: 1,
      promptCacheHitTokens: 3,
      promptCacheMissTokens: 1,
    })
  })

  it('usage 缺失时返回 null，不伪造 0', async () => {
    const { decision } = await collectSampling([
      { type: 'response_completed', finishReason: 'stop' },
    ])

    assert.equal(decision.type, 'final_answer')
    assert.equal(decision.summary.usage, null)
  })

  it('文本先于 Tool Call 时照常 yield 文本，并把它作为 intermediateText 随 calls 返回', async () => {
    const { decision, deltas } = await collectSampling([
      { type: 'text_delta', delta: '查询' },
      { type: 'text_delta', delta: '中' },
      { type: 'tool_call_started' },
      toolCallEvent('call-1', 'search_articles', '{"query":"seo"}', '先搜索站内文章。'),
      { type: 'usage', usage: { totalTokens: 8 } },
      { type: 'response_completed', finishReason: 'tool_calls' },
    ], 'run-1:sampling-2')

    assert.deepEqual(deltas, ['查询', '中'])
    assert.deepEqual(decision, {
      type: 'tool_call',
      calls: [{
        callId: 'call-1',
        toolName: 'search_articles',
        rawArgumentsJson: '{"query":"seo"}',
      }],
      intermediateText: '查询中',
      reasoningContent: '先搜索站内文章。',
      summary: {
        samplingAttemptId: 'run-1:sampling-2',
        finishReason: 'tool_calls',
        usage: { totalTokens: 8 },
        toolCallCount: 1,
        textChars: 3,
        firstTokenMs: FIRST_EVENT_DELAY_MS,
      },
    })
  })

  it('同轮多个 Tool Call 按事件顺序全部返回', async () => {
    const { decision } = await collectSampling([
      { type: 'tool_call_started' },
      toolCallEvent('call-1', 'search_articles', '{"query":"seo"}', '两个都查。', 0),
      toolCallEvent('call-2', 'get_article_detail', '{"sourceId":1}', '两个都查。', 1),
      { type: 'response_completed', finishReason: 'tool_calls' },
    ])

    assert.equal(decision.type, 'tool_call')
    assert.deepEqual(
      decision.type === 'tool_call' ? decision.calls.map(call => call.callId) : [],
      ['call-1', 'call-2'],
    )
    assert.equal(decision.summary.toolCallCount, 2)
    assert.equal(decision.type === 'tool_call' ? decision.intermediateText : undefined, '')
  })

  it('length 且带 Tool Call 时仍返回 tool_call 决策，由 Runtime 按截断回喂', async () => {
    const { decision } = await collectSampling([
      { type: 'tool_call_started' },
      toolCallEvent('call-1', 'search_articles', '{"query":', '想查。'),
      { type: 'response_completed', finishReason: 'length' },
    ])

    assert.equal(decision.type, 'tool_call')
    assert.equal(decision.summary.finishReason, 'length')
    assert.deepEqual(
      decision.type === 'tool_call' ? decision.calls[0]?.rawArgumentsJson : undefined,
      '{"query":',
    )
  })

  it('模型流读取失败时携带 partial summary，原错误挂在 cause 上', async () => {
    const providerError = new Error('reset')

    await assert.rejects(
      collectSampling([{ type: 'text_delta', delta: '部分' }], 'run-1:sampling-1', providerError),
      (error) => {
        assert.ok(error instanceof ModelSamplingIncompleteError)
        assert.match(error.message, /读取失败/)
        assert.equal(error.summary?.textChars, 2)
        assert.equal(error.summary?.firstTokenMs, FIRST_EVENT_DELAY_MS)
        assert.equal(error.cause, providerError)
        return true
      },
    )
  })

  it('reasoning_started 先到时首 token 时间从它算起，且不产出文本', async () => {
    const { decision, deltas } = await collectSampling([
      { type: 'reasoning_started' },
      { type: 'text_delta', delta: '答' },
      { type: 'response_completed', finishReason: 'stop' },
    ], 'run-1:sampling-1', undefined, createClock([1_000, 1_030, 1_900]))

    assert.deepEqual(deltas, ['答'])
    assert.equal(decision.summary.firstTokenMs, 30)
  })

  it('一个流事件都没收到就失败时 firstTokenMs 为 null', async () => {
    await assert.rejects(
      collectSampling([], 'run-1:sampling-1', new Error('connect refused')),
      (error) => {
        assert.ok(error instanceof ModelSamplingIncompleteError)
        assert.equal(error.summary?.firstTokenMs, null)
        return true
      },
    )
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
          firstTokenMs: FIRST_EVENT_DELAY_MS,
        })
        assert.doesNotMatch(JSON.stringify(error.summary), /部分文本/)
        return true
      },
    )
  })

  it('length 无 Tool Call、content_filter 与 unknown 失败时保留 finish reason 和 usage', async () => {
    for (const finishReason of ['length', 'content_filter', 'unknown'] as const) {
      await assert.rejects(
        collectSampling([
          { type: 'text_delta', delta: '未完成' },
          { type: 'usage', usage: { inputTokens: 5 } },
          { type: 'response_completed', finishReason },
        ]),
        (error) => {
          assert.ok(error instanceof ModelSamplingIncompleteError)
          assert.deepEqual(error.summary, {
            samplingAttemptId: 'run-1:sampling-1',
            finishReason,
            usage: { inputTokens: 5 },
            toolCallCount: 0,
            textChars: 3,
            firstTokenMs: FIRST_EVENT_DELAY_MS,
          })
          return true
        },
      )
    }
  })
})

function createClock(
  readings: number[] = [1_000, 1_000 + FIRST_EVENT_DELAY_MS],
): () => number {
  let index = 0

  return () => readings[Math.min(index++, readings.length - 1)]!
}

async function collectSampling(
  events: ModelStreamEvent[],
  samplingAttemptId = 'run-1:sampling-1',
  failWith?: Error,
  now = createClock(),
) {
  const sampling = streamModelSampling(
    toModelStream(events, failWith),
    samplingAttemptId,
    now,
  )
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
  failWith?: Error,
): AsyncGenerator<ModelStreamEvent> {
  yield* events
  if (failWith)
    throw failWith
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
  reasoningContent = `reasoning for ${providerCallId}`,
  index = 0,
): ModelStreamEvent {
  return {
    type: 'tool_call_completed',
    reasoningContent,
    toolCall: {
      providerCallId,
      name,
      argumentsJson,
      index,
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
