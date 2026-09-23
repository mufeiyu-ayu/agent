import type { ChatCompletionChunk } from 'openai/resources/chat/completions'
import type { ModelRawResponseCapture, ModelStreamEvent } from '../types.js'
import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test
import { describe, it } from 'node:test'

import { teeRawResponseCapture } from './openai-completions-raw-capture.js'
import { adaptOpenAICompatibleStream } from './openai-completions-stream.js'

describe('teeRawResponseCapture', () => {
  it('原样透传 chunk，并在流结束后组装完整原始响应', async () => {
    const chunks = [
      createChunk({
        delta: { role: 'assistant', content: '你' },
      }),
      createChunk({
        delta: { content: '好' },
        finish_reason: 'stop',
      }),
      createUsageChunk({
        prompt_tokens: 10,
        completion_tokens: 2,
        total_tokens: 12,
      }),
    ]
    let captured: unknown
    let captureCount = 0

    const forwarded: ChatCompletionChunk[] = []

    for await (const chunk of teeRawResponseCapture(
      toAsyncIterable(chunks),
      (rawResponse) => {
        captured = rawResponse
        captureCount += 1
      },
    )) {
      forwarded.push(chunk)
    }

    assert.deepEqual(forwarded, chunks)
    assert.equal(captureCount, 1)
    assert.deepEqual(captured, {
      state: 'complete',
      lastEvent: 'usage',
      textChars: 2,
      toolCallCount: 0,
      rawResponse: {
        id: 'chunk-1',
        object: 'chat.completion',
        created: 1_756_000_000,
        model: 'deepseek-v4-flash',
        choices: [
          {
            index: 0,
            finish_reason: 'stop',
            message: {
              role: 'assistant',
              content: '你好',
            },
          },
        ],
        usage: {
          prompt_tokens: 10,
          completion_tokens: 2,
          total_tokens: 12,
        },
      },
    })
  })

  it('按 index 拼接 tool_calls 分片（非 0 起始时压缩空洞），并保留 reasoning_content', async () => {
    const chunks = [
      createChunk({
        delta: {
          role: 'assistant',
          reasoning_content: '需要检索',
          tool_calls: [
            {
              index: 1,
              id: 'call_1',
              type: 'function',
              function: { name: 'search_', arguments: '{"query"' },
            },
          ],
        } as ChatCompletionChunk.Choice.Delta,
      }),
      createChunk({
        delta: {
          tool_calls: [
            {
              index: 1,
              function: { name: 'articles', arguments: ':"seo"}' },
            },
          ],
        },
        finish_reason: 'tool_calls',
      }),
    ]
    let captured: unknown

    for await (const _ of teeRawResponseCapture(
      toAsyncIterable(chunks),
      (rawResponse) => {
        captured = rawResponse
      },
    )) {
      // 只消费流
    }

    assert.deepEqual(captured, {
      state: 'complete',
      lastEvent: 'finish_reason',
      textChars: 0,
      toolCallCount: 1,
      rawResponse: {
        id: 'chunk-1',
        object: 'chat.completion',
        created: 1_756_000_000,
        model: 'deepseek-v4-flash',
        choices: [
          {
            index: 0,
            finish_reason: 'tool_calls',
            message: {
              role: 'assistant',
              content: null,
              reasoning_content: '需要检索',
              tool_calls: [
                {
                  id: 'call_1',
                  type: 'function',
                  function: {
                    name: 'search_articles',
                    arguments: '{"query":"seo"}',
                  },
                },
              ],
            },
          },
        ],
      },
    })
  })

  it('每片重复带相同 id / name 时不再拼接，tee 与累加器给出同一个 call id', async () => {
    const repeated = (argumentsJson: string): ChatCompletionChunk.Choice.Delta => ({
      tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: 'search', arguments: argumentsJson } }],
    })
    const chunks = [
      createChunk({ delta: { role: 'assistant', ...repeated('{"query":') } }),
      createChunk({ delta: repeated('"seo"') }),
      createChunk({ delta: repeated('}'), finish_reason: 'tool_calls' }),
    ]
    let captured: ModelRawResponseCapture | undefined
    const events: ModelStreamEvent[] = []

    for await (const event of adaptOpenAICompatibleStream(
      teeRawResponseCapture(toAsyncIterable(chunks), (capture) => {
        captured = capture
      }),
      { requireReasoningContent: false },
    )) {
      events.push(event)
    }

    assert.deepEqual(events, [
      { type: 'tool_call_started' },
      {
        type: 'tool_call_completed',
        toolCall: { providerCallId: 'call_1', name: 'search', argumentsJson: '{"query":"seo"}', index: 0 },
        reasoningContent: '',
      },
      { type: 'response_completed', finishReason: 'tool_calls' },
    ])
    assert.deepEqual(
      (captured?.rawResponse as { choices: Array<{ message: { tool_calls: unknown } }> }).choices[0]?.message.tool_calls,
      [{ id: 'call_1', type: 'function', function: { name: 'search', arguments: '{"query":"seo"}' } }],
    )
  })

  it('流中途抛错时提交 partial 并透传原错误', async () => {
    let captured: unknown
    const failing = async function* (): AsyncGenerator<ChatCompletionChunk> {
      yield createChunk({ delta: { content: '部分' } })
      throw new Error('stream broken')
    }

    await assert.rejects(async () => {
      for await (const _ of teeRawResponseCapture(failing(), (rawResponse) => {
        captured = rawResponse
      })) {
        // 只消费流
      }
    }, /stream broken/)

    assert.deepEqual(captured, {
      state: 'partial',
      lastEvent: 'text_delta',
      textChars: 2,
      toolCallCount: 0,
      rawResponse: {
        id: 'chunk-1',
        object: 'chat.completion',
        created: 1_756_000_000,
        model: 'deepseek-v4-flash',
        choices: [{
          index: 0,
          finish_reason: null,
          message: {
            role: 'assistant',
            content: '部分',
          },
        }],
      },
    })
  })

  it('源流正常结束但没见到 finish_reason 时提交 partial', async () => {
    let captured: ModelRawResponseCapture | undefined

    // SDK 读响应体遇到 abort 时静默结束迭代，源流看起来是正常结束的。
    for await (const _ of teeRawResponseCapture(
      toAsyncIterable([createChunk({ delta: { content: '部分' } })]),
      (capture) => {
        captured = capture
      },
    )) {
      // 只消费流
    }

    assert.equal(captured?.state, 'partial')
    assert.equal(captured?.lastEvent, 'text_delta')
  })

  it('signal 已 aborted 时即使见过 finish_reason 也提交 partial', async () => {
    const abortController = new AbortController()
    let captured: ModelRawResponseCapture | undefined

    for await (const _ of teeRawResponseCapture(
      toAsyncIterable([
        createChunk({ delta: { content: '完' }, finish_reason: 'stop' }),
      ]),
      (capture) => {
        captured = capture
      },
      undefined,
      abortController.signal,
    )) {
      // 模拟 finish_reason 之后、usage 之前被停止：之后的 usage chunk 再也收不到。
      abortController.abort()
    }

    assert.equal(captured?.state, 'partial')
  })

  it('finish_reason 与 usage 都已收到后才 aborted 时仍为 complete', async () => {
    const abortController = new AbortController()
    let captured: ModelRawResponseCapture | undefined

    for await (const chunk of teeRawResponseCapture(
      toAsyncIterable([
        createChunk({ delta: { content: '完' }, finish_reason: 'stop' }),
        createUsageChunk({ prompt_tokens: 3, completion_tokens: 1, total_tokens: 4 }),
      ]),
      (capture) => {
        captured = capture
      },
      undefined,
      abortController.signal,
    )) {
      // 最后的 usage chunk 已交给下游，这之后的停止不影响响应本身的完整性。
      if (chunk.usage)
        abortController.abort()
    }

    assert.equal(captured?.state, 'complete')
  })

  it('下游提前 return 时提交 partial，保留不完整 Tool Call 分片', async () => {
    let captured: unknown
    const stream = teeRawResponseCapture(toAsyncIterable([
      createChunk({
        delta: {
          tool_calls: [{
            index: 0,
            id: 'call_1',
            type: 'function',
            function: { name: 'search_', arguments: '{"query"' },
          }],
        },
      }),
      createChunk({
        delta: {
          tool_calls: [{
            index: 0,
            function: { name: 'articles', arguments: ':"seo"}' },
          }],
        },
      }),
    ]), (capture) => {
      captured = capture
    })

    assert.equal((await stream.next()).done, false)
    await stream.return(undefined)

    assert.deepEqual(captured, {
      state: 'partial',
      lastEvent: 'tool_call_delta',
      textChars: 0,
      toolCallCount: 1,
      rawResponse: {
        id: 'chunk-1',
        object: 'chat.completion',
        created: 1_756_000_000,
        model: 'deepseek-v4-flash',
        choices: [{
          index: 0,
          finish_reason: null,
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [{
              id: 'call_1',
              type: 'function',
              function: {
                name: 'search_',
                arguments: '{"query"',
              },
            }],
          },
        }],
      },
    })
  })

  it('Tool Call 分片后上游抛错时仍提交 partial', async () => {
    let captured: ModelRawResponseCapture | undefined
    const failing = async function* (): AsyncGenerator<ChatCompletionChunk> {
      yield createChunk({
        delta: {
          tool_calls: [{
            index: 0,
            id: 'call_1',
            type: 'function',
            function: { name: 'search_', arguments: '{"query"' },
          }],
        },
      })
      throw new Error('tool stream broken')
    }

    await assert.rejects(async () => {
      for await (const _ of teeRawResponseCapture(failing(), (capture) => {
        captured = capture
      })) {
        // 只消费流
      }
    }, /tool stream broken/)

    assert.equal(captured?.state, 'partial')
    assert.equal(captured?.lastEvent, 'tool_call_delta')
    assert.equal(captured?.toolCallCount, 1)
    assert.match(JSON.stringify(captured?.rawResponse), /search_|call_1/)
  })

  it('首个 chunk 前失败时提交 empty，且不伪造响应字段', async () => {
    let captured: unknown
    const failing = async function* (): AsyncGenerator<ChatCompletionChunk> {
      throw new Error('no response')
    }

    await assert.rejects(async () => {
      for await (const _ of teeRawResponseCapture(failing(), (capture) => {
        captured = capture
      })) {
        // 只消费流
      }
    }, /no response/)

    assert.deepEqual(captured, {
      state: 'empty',
      lastEvent: null,
      textChars: 0,
      toolCallCount: 0,
    })
  })

  it('捕获回调失败不覆盖正常流或原始流错误', async () => {
    let captureFailures = 0

    const collect = async (source: AsyncIterable<ChatCompletionChunk>) => {
      for await (const _ of teeRawResponseCapture(
        source,
        () => {
          throw new Error('capture callback failed')
        },
        () => {
          captureFailures += 1
        },
      )) {
        // 只消费流
      }
    }

    await collect(toAsyncIterable([
      createChunk({ delta: {}, finish_reason: 'stop' }),
    ]))
    await assert.rejects(collect((async function* () {
      throw new Error('provider failed')
    })()), /provider failed/)
    assert.equal(captureFailures, 2)
  })
})

function createChunk(choice: {
  delta: ChatCompletionChunk.Choice.Delta
  finish_reason?: ChatCompletionChunk.Choice['finish_reason']
}): ChatCompletionChunk {
  return {
    id: 'chunk-1',
    object: 'chat.completion.chunk',
    created: 1_756_000_000,
    model: 'deepseek-v4-flash',
    choices: [
      {
        index: 0,
        delta: choice.delta,
        finish_reason: choice.finish_reason ?? null,
        logprobs: null,
      },
    ],
  }
}

function createUsageChunk(
  usage: NonNullable<ChatCompletionChunk['usage']>,
): ChatCompletionChunk {
  return {
    id: 'chunk-1',
    object: 'chat.completion.chunk',
    created: 1_756_000_000,
    model: 'deepseek-v4-flash',
    choices: [],
    usage,
  }
}

async function* toAsyncIterable(
  chunks: ChatCompletionChunk[],
): AsyncGenerator<ChatCompletionChunk> {
  yield* chunks
}
