import type { ChatCompletionChunk } from 'openai/resources/chat/completions'
import assert from 'node:assert/strict'
// 项目本轮使用 Node 原生测试运行器，不引入 Vitest。
// eslint-disable-next-line test/no-import-node-test
import { describe, it } from 'node:test'

import { LLMApiError } from '../llm.errors.js'
import { adaptOpenAICompatibleStream } from './openai-compatible-stream.adapter.js'

describe('adaptOpenAICompatibleStream', () => {
  it('保留文本、usage 和 stop 完成事件的顺序', async () => {
    const events = await collectEvents(adaptOpenAICompatibleStream(toStream([
      createChunk({ delta: { content: '你' } }),
      createChunk({ delta: { content: '好' }, finishReason: 'stop' }),
      createChunk({
        includeChoice: false,
        usage: {
          prompt_tokens: 3,
          completion_tokens: 2,
          total_tokens: 5,
        },
      }),
    ])))

    assert.deepEqual(events, [
      { type: 'text_delta', delta: '你' },
      { type: 'text_delta', delta: '好' },
      {
        type: 'usage',
        usage: {
          inputTokens: 3,
          outputTokens: 2,
          totalTokens: 5,
        },
      },
      { type: 'response_completed', finishReason: 'stop' },
    ])
  })

  it('拼装跨多个 chunk 的单个 Tool Call', async () => {
    const events = await collectEvents(adaptOpenAICompatibleStream(toStream([
      createChunk({
        delta: {
          tool_calls: [toolCallDelta(0, { id: 'call_', name: 'search_', argumentsJson: '{"query":' })],
        },
      }),
      createChunk({
        delta: {
          tool_calls: [toolCallDelta(0, { id: '1', name: 'articles', argumentsJson: '"seo"' })],
        },
      }),
      createChunk({
        delta: {
          tool_calls: [toolCallDelta(0, { argumentsJson: '}' })],
        },
        finishReason: 'tool_calls',
      }),
    ])))

    assert.deepEqual(events, [
      {
        type: 'tool_call_completed',
        toolCall: {
          providerCallId: 'call_1',
          name: 'search_articles',
          argumentsJson: '{"query":"seo"}',
          index: 0,
        },
      },
      { type: 'response_completed', finishReason: 'tool_calls' },
    ])
  })

  it('按 index 隔离交错的多个 Tool Call', async () => {
    const events = await collectEvents(adaptOpenAICompatibleStream(toStream([
      createChunk({
        delta: {
          tool_calls: [
            toolCallDelta(1, { id: 'call_b', name: 'get_', argumentsJson: '{"id":' }),
            toolCallDelta(0, { id: 'call_a', name: 'search_', argumentsJson: '{"query":' }),
          ],
        },
      }),
      createChunk({
        delta: {
          tool_calls: [
            toolCallDelta(0, { name: 'articles', argumentsJson: '"seo"}' }),
            toolCallDelta(1, { name: 'article', argumentsJson: '"1"}' }),
          ],
        },
        finishReason: 'tool_calls',
      }),
    ])))

    assert.deepEqual(events.slice(0, 2), [
      {
        type: 'tool_call_completed',
        toolCall: {
          providerCallId: 'call_a',
          name: 'search_articles',
          argumentsJson: '{"query":"seo"}',
          index: 0,
        },
      },
      {
        type: 'tool_call_completed',
        toolCall: {
          providerCallId: 'call_b',
          name: 'get_article',
          argumentsJson: '{"id":"1"}',
          index: 1,
        },
      },
    ])
  })

  it('归一化 length、content_filter 和未知 finish reason', async () => {
    const cases: Array<[ChatCompletionChunk.Choice['finish_reason'], string]> = [
      ['length', 'length'],
      ['content_filter', 'content_filter'],
      ['provider_specific' as ChatCompletionChunk.Choice['finish_reason'], 'unknown'],
    ]

    for (const [finishReason, expected] of cases) {
      const events = await collectEvents(adaptOpenAICompatibleStream(toStream([
        createChunk({ finishReason }),
      ])))

      assert.deepEqual(events, [
        { type: 'response_completed', finishReason: expected },
      ])
    }
  })

  it('拒绝没有 finish reason 的不完整流', async () => {
    await assert.rejects(
      collectEvents(adaptOpenAICompatibleStream(toStream([
        createChunk({ delta: { content: '未完成' } }),
      ]))),
      LLMApiError,
    )
  })

  it('拒绝缺少必要字段的 Tool Call', async () => {
    await assert.rejects(
      collectEvents(adaptOpenAICompatibleStream(toStream([
        createChunk({
          delta: {
            tool_calls: [toolCallDelta(0, { argumentsJson: '{}' })],
          },
          finishReason: 'tool_calls',
        }),
      ]))),
      LLMApiError,
    )
  })

  it('让 Provider iterator 错误沿 throw 通道传播', async () => {
    const providerError = new Error('provider unavailable')

    await assert.rejects(
      collectEvents(adaptOpenAICompatibleStream(failingStream(providerError))),
      error => error === providerError,
    )
  })
})

interface CreateChunkInput {
  delta?: ChatCompletionChunk.Choice.Delta
  finishReason?: ChatCompletionChunk.Choice['finish_reason']
  includeChoice?: boolean
  usage?: ChatCompletionChunk['usage']
}

interface ToolCallDeltaInput {
  argumentsJson?: string
  id?: string
  name?: string
}

function createChunk(input: CreateChunkInput = {}): ChatCompletionChunk {
  return {
    id: 'response-1',
    choices: input.includeChoice === false
      ? []
      : [{
          index: 0,
          delta: input.delta ?? {},
          finish_reason: input.finishReason ?? null,
        }],
    created: 0,
    model: 'test-model',
    object: 'chat.completion.chunk',
    ...(input.usage === undefined ? {} : { usage: input.usage }),
  }
}

function toolCallDelta(
  index: number,
  input: ToolCallDeltaInput,
): ChatCompletionChunk.Choice.Delta.ToolCall {
  return {
    index,
    type: 'function',
    ...(input.id ? { id: input.id } : {}),
    function: {
      ...(input.name ? { name: input.name } : {}),
      ...(input.argumentsJson ? { arguments: input.argumentsJson } : {}),
    },
  }
}

async function* toStream(
  chunks: ChatCompletionChunk[],
): AsyncGenerator<ChatCompletionChunk> {
  yield* chunks
}

async function* failingStream(
  error: Error,
): AsyncGenerator<ChatCompletionChunk> {
  yield createChunk({ delta: { content: '部分文本' } })
  throw error
}

async function collectEvents<T>(source: AsyncIterable<T>): Promise<T[]> {
  const events: T[] = []

  for await (const event of source)
    events.push(event)

  return events
}
