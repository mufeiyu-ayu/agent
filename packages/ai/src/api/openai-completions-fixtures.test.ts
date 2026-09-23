import type { ChatCompletionChunk } from 'openai/resources/chat/completions'
import type { ModelStreamEvent, ModelUsage } from '../types.js'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
// eslint-disable-next-line test/no-import-node-test
import { describe, it } from 'node:test'
import { LLM_FAMILY_CAPABILITIES } from '@agent/contracts'

import { adaptOpenAICompatibleStream } from './openai-completions-stream.js'

/**
 * 各家族的真实响应回归：`*.response.json` 是 `scripts/export-raw-response-fixtures.ts` 从本机
 * `AgentStep.debugRawResponse` 导出的非流式聚合响应，`*.chunks.json` 是按同一家族真实流形状
 * 手工整理的最小 chunk 序列（含 usage chunk）。期望值全部写死：fixture 里任一 usage 字段名
 * 或 compat 表取值变了，这里就会红。
 *
 * 落库时 `reasoning_content` 已被剥掉，真实响应 fixture 只能覆盖 usage 与 Tool Call 身份，
 * 不能用来证明某家族是否回 reasoning_content；那条不变量由手工 chunks fixture 按 compat 表覆盖，
 * chunks 的字段形状取自真实 usage 行与流适配测试，不是抓包原样。
 */

type FixtureKey = keyof typeof RESPONSE_EXPECTATIONS

/** 只声明用例会读的字段；文件里另有 family / stepId / capturedAt 作为来源记录。 */
interface ResponseFixture {
  key: string
  wireName: string
  response: {
    choices: Array<{
      finish_reason: string
      message: {
        role: 'assistant'
        content: string | null
        tool_calls?: Array<{ id: string, type: 'function', function: { name: string, arguments: string } }>
      }
    }>
    usage: NonNullable<ChatCompletionChunk['usage']>
  }
}

interface ChunksFixture {
  family: keyof typeof LLM_FAMILY_CAPABILITIES
  note: string
  chunks: ChatCompletionChunk[]
}

/** 真实响应：归一化后的 usage、结束原因与 Tool Call 身份。 */
const RESPONSE_EXPECTATIONS = {
  'deepseek-direct': {
    usage: { inputTokens: 1304, outputTokens: 5, totalTokens: 1309, reasoningTokens: 0, promptCacheHitTokens: 1152, promptCacheMissTokens: 152 },
    finishReason: 'stop',
    toolCallIds: [],
  },
  'deepseek-relay': {
    usage: { inputTokens: 1362, outputTokens: 111, totalTokens: 1473, promptCacheHitTokens: 1280, promptCacheMissTokens: 82 },
    finishReason: 'tool_calls',
    toolCallIds: ['call_f39d80cf29be45f2a7fe7600'],
  },
  'grok': {
    usage: { inputTokens: 2419, outputTokens: 10, totalTokens: 2579, reasoningTokens: 150, promptCacheHitTokens: 2304, promptCacheMissTokens: 115 },
    finishReason: 'stop',
    toolCallIds: [],
  },
  'openai': {
    usage: { inputTokens: 7930, outputTokens: 50, totalTokens: 7980 },
    finishReason: 'tool_calls',
    toolCallIds: ['call_tYj5Cu6HpTPG8P0adxE0YttT'],
  },
  'gemini': {
    usage: { inputTokens: 1347, outputTokens: 150, totalTokens: 1497 },
    finishReason: 'stop',
    toolCallIds: [],
  },
} satisfies Record<string, { usage: ModelUsage, finishReason: string, toolCallIds: string[] }>

/** 手工 chunk 序列：完整事件列表。 */
const CHUNK_EXPECTATIONS: Record<FixtureKey, ModelStreamEvent[]> = {
  'deepseek-direct': [
    { type: 'reasoning_started' },
    { type: 'tool_call_started' },
    {
      type: 'tool_call_completed',
      toolCall: { providerCallId: 'call_0_9b0c1a2d', name: 'retrieve_article_context', argumentsJson: '{"query":"青柠 146"}', index: 0 },
      reasoningContent: '用户要查文章，先检索。',
    },
    { type: 'usage', usage: { inputTokens: 1304, outputTokens: 21, totalTokens: 1325, reasoningTokens: 16, promptCacheHitTokens: 1152, promptCacheMissTokens: 152 } },
    { type: 'response_completed', finishReason: 'tool_calls' },
  ],
  'deepseek-relay': [
    { type: 'text_delta', delta: '刚才的暗号是' },
    { type: 'text_delta', delta: '「青柠 146」。' },
    { type: 'usage', usage: { inputTokens: 1386, outputTokens: 42, totalTokens: 1428, promptCacheHitTokens: 1280, promptCacheMissTokens: 106 } },
    { type: 'response_completed', finishReason: 'stop' },
  ],
  'grok': [
    { type: 'text_delta', delta: '刚才的暗号是' },
    { type: 'text_delta', delta: '「青柠 146」。' },
    { type: 'usage', usage: { inputTokens: 2419, outputTokens: 10, totalTokens: 2579, reasoningTokens: 150, promptCacheHitTokens: 2304, promptCacheMissTokens: 115 } },
    { type: 'response_completed', finishReason: 'stop' },
  ],
  'openai': [
    { type: 'tool_call_started' },
    {
      type: 'tool_call_completed',
      toolCall: { providerCallId: 'call_tYj5Cu6HpTPG8P0adxE0YttT', name: 'retrieve_article_context', argumentsJson: '{"query":"Genshin Impact 7.1"}', index: 0 },
      reasoningContent: '',
    },
    { type: 'usage', usage: { inputTokens: 8061, outputTokens: 767, totalTokens: 8828, promptCacheHitTokens: 7680, promptCacheMissTokens: 381 } },
    { type: 'response_completed', finishReason: 'tool_calls' },
  ],
  'gemini': [
    { type: 'text_delta', delta: '刚才的暗号是' },
    { type: 'text_delta', delta: '「青柠 146」。' },
    { type: 'usage', usage: { inputTokens: 1347, outputTokens: 150, totalTokens: 1497 } },
    { type: 'response_completed', finishReason: 'stop' },
  ],
}

const FIXTURE_KEYS = Object.keys(RESPONSE_EXPECTATIONS) as FixtureKey[]

describe('各家族真实响应 fixture', () => {
  for (const key of FIXTURE_KEYS) {
    it(`${key}：真实聚合响应的 usage 与 Tool Call 身份归一化`, async () => {
      const fixture = loadFixture<ResponseFixture>(`${key}.response.json`)
      const expected = RESPONSE_EXPECTATIONS[key]
      // 捕获已剥掉 reasoning_content，这里不能按 compat 要求它，否则 DeepSeek 带 Tool Call 的样本必红。
      const events = await collectEvents(adaptOpenAICompatibleStream(
        toStream(responseToChunks(fixture)),
        { requireReasoningContent: false },
      ))

      assert.deepEqual(events.filter(event => event.type === 'usage'), [{ type: 'usage', usage: expected.usage }])
      assert.deepEqual(events.at(-1), { type: 'response_completed', finishReason: expected.finishReason })
      assert.deepEqual(
        events.flatMap(event => (event.type === 'tool_call_completed' ? [event.toolCall.providerCallId] : [])),
        expected.toolCallIds,
      )
    })

    it(`${key}：手工 chunk 序列按家族 compat 产出完整事件`, async () => {
      const fixture = loadFixture<ChunksFixture>(`${key}.chunks.json`)
      const compat = LLM_FAMILY_CAPABILITIES[fixture.family]
      const events = await collectEvents(adaptOpenAICompatibleStream(
        toStream(fixture.chunks),
        { requireReasoningContent: compat.requiresReasoningContent },
      ))

      assert.deepEqual(events, CHUNK_EXPECTATIONS[key])
    })
  }
})

function loadFixture<T>(name: string): T {
  return JSON.parse(readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url), 'utf8')) as T
}

/** 把 `teeRawResponseCapture` 聚合出的非流式响应还原成「一个内容 chunk + 一个 usage chunk」。 */
function responseToChunks(fixture: ResponseFixture): ChatCompletionChunk[] {
  const choice = fixture.response.choices[0]!
  const { message } = choice
  const base = { id: fixture.key, created: 0, model: fixture.wireName, object: 'chat.completion.chunk' as const }

  return [
    {
      ...base,
      choices: [{
        index: 0,
        delta: {
          role: message.role,
          ...(message.content === null ? {} : { content: message.content }),
          ...(message.tool_calls
            ? { tool_calls: message.tool_calls.map((toolCall, index) => ({ index, ...toolCall })) }
            : {}),
        },
        finish_reason: choice.finish_reason as ChatCompletionChunk.Choice['finish_reason'],
      }],
    },
    { ...base, choices: [], usage: fixture.response.usage },
  ]
}

async function* toStream(chunks: ChatCompletionChunk[]): AsyncIterable<ChatCompletionChunk> {
  for (const chunk of chunks)
    yield chunk
}

async function collectEvents(events: AsyncIterable<ModelStreamEvent>): Promise<ModelStreamEvent[]> {
  const collected: ModelStreamEvent[] = []

  for await (const event of events)
    collected.push(event)

  return collected
}
