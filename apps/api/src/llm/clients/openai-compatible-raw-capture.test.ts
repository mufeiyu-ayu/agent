import type { ChatCompletionChunk } from 'openai/resources/chat/completions'
import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test
import { describe, it } from 'node:test'

import { teeRawResponseCapture } from './openai-compatible-raw-capture.js'

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

    const forwarded: ChatCompletionChunk[] = []

    for await (const chunk of teeRawResponseCapture(
      toAsyncIterable(chunks),
      (rawResponse) => {
        captured = rawResponse
      },
    )) {
      forwarded.push(chunk)
    }

    assert.deepEqual(forwarded, chunks)
    assert.deepEqual(captured, {
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
    })
  })

  it('流中途抛错时不产生捕获结果并透传错误', async () => {
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

    assert.equal(captured, undefined)
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
