import type { LlmProviderFamily } from '@agent/contracts'
import type { ChatCompletionChunk } from 'openai/resources/chat/completions'
import type { ModelRawResponseCapture, ModelStreamEvent, ModelUsage } from '../types.js'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
// eslint-disable-next-line test/no-import-node-test
import { describe, it } from 'node:test'
import { familyCompatOf, LLM_FAMILY_CAPABILITIES } from '@agent/contracts'

import { adaptOpenAICompatibleStream } from './openai-completions-stream.js'
import { OpenAICompatibleClient } from './openai-completions.js'

/**
 * 各家族的真实响应回归，三类 fixture：
 * - `*.tool-call.sse`：`scripts/record-tool-call-stream-fixtures.ts` 录下的真实 Tool Call 流原文，
 *   经 fake fetch 交给真实 `OpenAICompatibleClient`，走 SDK 的 SSE 解析与生产 compat（DeepSeek 要求 reasoning_content）。
 * - `*.response.json`：`scripts/export-raw-response-fixtures.ts` 从本机 `AgentStep.debugRawResponse` 导出的非流式聚合响应。
 * - `*.chunks.json`：按同一家族真实流形状手工整理的最小 chunk 序列（含 usage chunk），不是抓包原样。
 *
 * 期望值全部写死：fixture 里任一被读取的字段名或 compat 表取值变了，这里就会红。
 * 落库时 `reasoning_content` 已被剥掉，`*.response.json` 只覆盖 usage 与 Tool Call 身份。
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
  // grok 的 completion_tokens 不含推理：total = prompt + completion + reasoning，outputTokens 归一为 10 + 150。
  'grok': {
    usage: { inputTokens: 2419, outputTokens: 160, totalTokens: 2579, reasoningTokens: 150, promptCacheHitTokens: 2304, promptCacheMissTokens: 115 },
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
    { type: 'usage', usage: { inputTokens: 2419, outputTokens: 160, totalTokens: 2579, reasoningTokens: 150, promptCacheHitTokens: 2304, promptCacheMissTokens: 115 } },
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

const DEEPSEEK_REASONING = 'The user wants me to call search_articles twice, for "青柠" and "146", in the same round.'

/**
 * 真实 Tool Call 流（2026-09-23 录制，同一提示要求并行检索两个关键词）：各家族 compat 与归一化后的完整事件。
 * 形状差异：DeepSeek 直连逐字流出 arguments、usage 与 finish_reason 同一个 chunk；gpt 先发 id + name
 * 再发整段 arguments；grok 每个调用一个 chunk 带齐 id / name / arguments，completion_tokens 不含推理。
 */
const TOOL_CALL_STREAM_EXPECTATIONS: Record<string, {
  family: LlmProviderFamily
  requiresReasoningContent: boolean
  events: ModelStreamEvent[]
}> = {
  'deepseek-direct': {
    family: 'deepseek',
    requiresReasoningContent: true,
    events: [
      { type: 'reasoning_started' },
      { type: 'tool_call_started' },
      {
        type: 'tool_call_completed',
        toolCall: { providerCallId: 'call_00_NWR8Vcl3IVbpwQNxSoZF2051', name: 'search_articles', argumentsJson: '{"query": "青柠"}', index: 0 },
        reasoningContent: DEEPSEEK_REASONING,
      },
      {
        type: 'tool_call_completed',
        toolCall: { providerCallId: 'call_01_dQfu6FQlv1qieDYAADim2893', name: 'search_articles', argumentsJson: '{"query": "146"}', index: 1 },
        reasoningContent: DEEPSEEK_REASONING,
      },
      { type: 'usage', usage: { inputTokens: 370, outputTokens: 94, totalTokens: 464, reasoningTokens: 25, promptCacheHitTokens: 0, promptCacheMissTokens: 370 } },
      { type: 'response_completed', finishReason: 'tool_calls' },
    ],
  },
  'openai': {
    family: 'openai',
    requiresReasoningContent: false,
    events: [
      { type: 'tool_call_started' },
      {
        type: 'tool_call_completed',
        toolCall: { providerCallId: 'call_loHf2IU3gl3R9SNTH4GR2pUe', name: 'search_articles', argumentsJson: '{"query":"青柠"}', index: 0 },
        reasoningContent: '',
      },
      {
        type: 'tool_call_completed',
        toolCall: { providerCallId: 'call_DkLHzXgeyzJhTq0vP2aV7yR4', name: 'search_articles', argumentsJson: '{"query":"146"}', index: 1 },
        reasoningContent: '',
      },
      { type: 'usage', usage: { inputTokens: 121, outputTokens: 63, totalTokens: 184, reasoningTokens: 11 } },
      { type: 'response_completed', finishReason: 'tool_calls' },
    ],
  },
  // total 1052 = prompt 365 + completion 29 + reasoning 658，outputTokens 归一为 29 + 658。
  'grok': {
    family: 'grok',
    requiresReasoningContent: false,
    events: [
      { type: 'tool_call_started' },
      {
        type: 'tool_call_completed',
        toolCall: { providerCallId: 'call-d2c68a40-b90f-4406-8384-071952df9caf-0', name: 'search_articles', argumentsJson: '{"query":"青柠","limit":5}', index: 0 },
        reasoningContent: '',
      },
      {
        type: 'tool_call_completed',
        toolCall: { providerCallId: 'call-d2c68a40-b90f-4406-8384-071952df9caf-1', name: 'search_articles', argumentsJson: '{"query":"146","limit":5}', index: 1 },
        reasoningContent: '',
      },
      { type: 'usage', usage: { inputTokens: 365, outputTokens: 687, totalTokens: 1052, reasoningTokens: 658, promptCacheHitTokens: 192, promptCacheMissTokens: 173 } },
      { type: 'response_completed', finishReason: 'tool_calls' },
    ],
  },
  // Google 官方 OpenAI 兼容端点（中转站 gemini 上游当时全线 400）：分片不带 index、带 Tool Call 却报 stop，
  // 靠 gemini compat 放宽；每个 chunk 都带累计 usage，runtime 的 mergeModelUsage 取最后一次。
  'gemini-direct': {
    family: 'gemini',
    requiresReasoningContent: false,
    events: [
      { type: 'tool_call_started' },
      { type: 'usage', usage: { inputTokens: 123, outputTokens: 17, totalTokens: 242 } },
      { type: 'usage', usage: { inputTokens: 123, outputTokens: 35, totalTokens: 260 } },
      {
        type: 'tool_call_completed',
        toolCall: { providerCallId: 'call_600059', name: 'search_articles', argumentsJson: '{"query":"青柠"}', index: 0 },
        reasoningContent: '',
      },
      {
        type: 'tool_call_completed',
        toolCall: { providerCallId: 'call_600060', name: 'search_articles', argumentsJson: '{"query":"146"}', index: 1 },
        reasoningContent: '',
      },
      { type: 'usage', usage: { inputTokens: 123, outputTokens: 35, totalTokens: 260 } },
      { type: 'response_completed', finishReason: 'tool_calls' },
    ],
  },
}

describe('各家族真实 Tool Call 流 fixture（原始 SSE 经 SDK 解析）', () => {
  for (const [key, expected] of Object.entries(TOOL_CALL_STREAM_EXPECTATIONS)) {
    it(`${key}：按家族 compat 产出完整事件，debug 捕获的 call id 与运行时一致`, async () => {
      const compat = familyCompatOf(expected.family)
      const harness = createSseHarness(readFileSync(new URL(`./__fixtures__/${key}.tool-call.sse`, import.meta.url), 'utf8'))
      let captured: ModelRawResponseCapture | undefined
      const events = await collectEvents(harness.client.chatStream(
        [{ type: 'message', role: 'user', content: '检索' }],
        {
          request: { model: 'fixture-model', contextWindowTokens: 128_000, maxOutputTokens: 8_192, compat },
          debugCapture: { onRequest: () => {}, onResponse: (capture) => {
            captured = capture
          } },
        },
      ))
      const capturedToolCalls = (captured?.rawResponse as {
        choices: Array<{ message: { tool_calls?: Array<{ id: string, function: { name: string } }> } }>
      } | undefined)?.choices[0]?.message.tool_calls ?? []

      assert.equal(harness.fetchCalls, 1)
      assert.equal(compat.requiresReasoningContent, expected.requiresReasoningContent)
      assert.deepEqual(events, expected.events)
      assert.equal(captured?.state, 'complete')
      assert.deepEqual(
        capturedToolCalls.map(toolCall => [toolCall.id, toolCall.function.name]),
        events.flatMap(event => event.type === 'tool_call_completed' ? [[event.toolCall.providerCallId, event.toolCall.name]] : []),
      )
    })
  }

  it('gemini-direct 的真实流在严格 compat 下因缺 index 报错（放宽只给 gemini）', async () => {
    const harness = createSseHarness(readFileSync(new URL('./__fixtures__/gemini-direct.tool-call.sse', import.meta.url), 'utf8'))

    await assert.rejects(
      collectEvents(harness.client.chatStream(
        [{ type: 'message', role: 'user', content: '检索' }],
        { request: { model: 'fixture-model', contextWindowTokens: 128_000, maxOutputTokens: 8_192, compat: familyCompatOf('openai') } },
      )),
      /无效的 Tool Call index：undefined/,
    )
    assert.equal(harness.fetchCalls, 1)
  })
})

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
        {
          requireReasoningContent: compat.requiresReasoningContent,
          toolCallIndexOptional: compat.toolCallIndexOptional,
          toolCallsMayFinishWithStop: compat.toolCallsMayFinishWithStop,
        },
      ))

      assert.deepEqual(events, CHUNK_EXPECTATIONS[key])
    })
  }
})

/** 真实 SDK client（沿用生产 createClient 的配置）+ 只回放一份 SSE 原文的 fake fetch。 */
function createSseHarness(sse: string) {
  const harness = { fetchCalls: 0, client: new OpenAICompatibleClient({ apiKey: 'test-api-key', baseUrl: 'https://relay.test/v1', captureModelIO: true }) }
  // eslint-disable-next-line dot-notation
  const providerClient = harness.client['createClient']().withOptions({
    fetch: async () => {
      harness.fetchCalls += 1

      return new Response(sse, { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
    },
  })

  Object.defineProperty(harness.client, 'createClient', { value: () => providerClient })

  return harness
}

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
