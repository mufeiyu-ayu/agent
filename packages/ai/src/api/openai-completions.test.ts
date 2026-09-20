import type { LLMClientConfig, ResolvedChatRequestConfig } from '../config.js'
import assert from 'node:assert/strict'
import { getEventListeners } from 'node:events'
// eslint-disable-next-line test/no-import-node-test
import { describe, it } from 'node:test'

import OpenAI from 'openai'
import {
  LLMAuthError,
  LLMBalanceError,
  LLMInvalidRequestError,
  LLMNetworkError,
  LLMRateLimitError,
  LLMServerError,
} from '../errors.js'
import { OpenAICompatibleClient } from './openai-completions.js'

/** DeepSeek thinking 模型的 resolved 请求：带 thinking 参数，Tool Call 要求 reasoning_content。 */
const DEEPSEEK_REQUEST: ResolvedChatRequestConfig = {
  model: 'deepseek-v4-flash',
  contextWindowTokens: 1_000_000,
  maxOutputTokens: 65_536,
  reasoning: true,
  reasoningEffort: 'high',
}

/** 中转站后面的非 reasoning 模型且没配 reasoning_effort：两个参数都不发，Tool Call 不要求 reasoning_content。 */
const RELAY_REQUEST: ResolvedChatRequestConfig = {
  model: 'gpt-5.6-sol',
  contextWindowTokens: 128_000,
  maxOutputTokens: 8_192,
  reasoning: false,
}

describe('OpenAICompatibleClient runtime config', () => {
  it('metadata、普通 Chat 和 Stream 分别使用 10s、60s 和 10min', async () => {
    const harness = createHarness()

    await harness.client.listModels()
    await harness.client.getUserBalance()
    await harness.client.chat([{ type: 'message', role: 'user', content: 'hello' }], { request: DEEPSEEK_REQUEST })
    await collectEvents(harness.client.chatStream([
      { type: 'message', role: 'user', content: 'hello' },
    ], { request: DEEPSEEK_REQUEST }))

    assert.deepEqual(
      harness.calls.map(call => ({
        kind: call.kind,
        timeout: call.options.timeout,
      })),
      [
        { kind: 'metadata:/models', timeout: 10_000 },
        { kind: 'metadata:https://api.deepseek.com/user/balance', timeout: 10_000 },
        { kind: 'chat', timeout: 60_000 },
        { kind: 'stream', timeout: 600_000 },
      ],
    )
    assert.equal(harness.calls[2]?.params?.max_tokens, 65_536)
    assert.equal(harness.calls[3]?.params?.max_tokens, 65_536)
    for (const call of harness.calls.slice(2)) {
      assert.deepEqual(call.params?.thinking, { type: 'enabled' })
      assert.equal(call.params?.reasoning_effort, 'high')
      assert.equal(Object.hasOwn(call.params ?? {}, 'temperature'), false)
    }
  })

  it('把调用级 Low / High / Max 原样映射到实际 DeepSeek wire body', async () => {
    const harness = createHarness()

    for (const reasoningEffort of ['low', 'high', 'max'] as const) {
      await collectEvents(harness.client.chatStream(
        [{ type: 'message', role: 'user', content: 'hello' }],
        { request: { ...DEEPSEEK_REQUEST, reasoningEffort } },
      ))
    }

    assert.deepEqual(
      harness.calls.map(call => call.params?.reasoning_effort),
      ['low', 'high', 'max'],
    )
  })

  it('OpenAI SDK 实际序列化后的 wire body 保留 DeepSeek 参数', async () => {
    const harness = createHarness()
    let wireBody: Record<string, unknown> | undefined
    const providerClient = new OpenAI({
      apiKey: 'test-api-key',
      baseURL: 'https://api.deepseek.com/v1',
      maxRetries: 0,
      fetch: async (_input, init) => {
        wireBody = JSON.parse(String(init?.body)) as Record<string, unknown>

        return new Response([
          'data: {"id":"response-1","choices":[{"index":0,"delta":{"content":"ok"},"finish_reason":"stop"}],"created":0,"model":"deepseek-v4-flash","object":"chat.completion.chunk"}',
          '',
          'data: [DONE]',
          '',
        ].join('\n'), {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        })
      },
    })

    Object.defineProperty(harness.client, 'createClient', {
      value: () => providerClient,
    })

    await collectEvents(harness.client.chatStream(
      [{ type: 'message', role: 'user', content: 'hello' }],
      { request: { ...DEEPSEEK_REQUEST, reasoningEffort: 'max' } },
    ))

    assert.deepEqual(wireBody?.thinking, { type: 'enabled' })
    assert.equal(wireBody?.reasoning_effort, 'max')
    assert.equal(Object.hasOwn(wireBody ?? {}, 'temperature'), false)
  })

  it('assistant_tool_call 的 rawArgumentsJson 原样进入实际 wire body 的 function.arguments', async () => {
    const harness = createHarness()
    let wireBody: Record<string, unknown> | undefined
    const providerClient = new OpenAI({
      apiKey: 'test-api-key',
      baseURL: 'https://api.deepseek.com/v1',
      maxRetries: 0,
      fetch: async (_input, init) => {
        wireBody = JSON.parse(String(init?.body)) as Record<string, unknown>

        return okStreamResponse('ok')
      },
    })

    Object.defineProperty(harness.client, 'createClient', {
      value: () => providerClient,
    })

    // Runtime 对未校验参数产出的续轮表示（官方回退形状）与已校验参数各一条。
    await collectEvents(harness.client.chatStream([
      { type: 'message', role: 'user', content: 'hello' },
      {
        type: 'assistant_tool_call',
        calls: [
          { callId: 'call-1', name: 'get_article_detail', rawArgumentsJson: '{"arguments":"[]"}' },
          { callId: 'call-2', name: 'search_articles', rawArgumentsJson: '{"query":"seo"}' },
        ],
        reasoningContent: 'r',
      },
      { type: 'tool_result', callId: 'call-1', name: 'get_article_detail', content: 'x', ok: false },
      { type: 'tool_result', callId: 'call-2', name: 'search_articles', content: 'y', ok: true },
    ], { request: DEEPSEEK_REQUEST }))

    const messages = wireBody?.messages as Array<Record<string, unknown>>

    assert.deepEqual(messages[1], {
      role: 'assistant',
      content: '',
      reasoning_content: 'r',
      tool_calls: [
        { id: 'call-1', type: 'function', function: { name: 'get_article_detail', arguments: '{"arguments":"[]"}' } },
        { id: 'call-2', type: 'function', function: { name: 'search_articles', arguments: '{"query":"seo"}' } },
      ],
    })
    assert.deepEqual(messages.slice(2).map(message => message.tool_call_id), ['call-1', 'call-2'])
  })

  it('非 reasoning 模型不发 thinking 参数，Tool Call 无 reasoning_content 也能完成', async () => {
    const harness = createHarness()

    await harness.client.chat([{ type: 'message', role: 'user', content: 'hello' }], { request: RELAY_REQUEST })
    await collectEvents(harness.client.chatStream(
      [{ type: 'message', role: 'user', content: 'hello' }],
      { request: RELAY_REQUEST },
    ))

    for (const call of harness.calls) {
      assert.equal(call.params?.model, 'gpt-5.6-sol')
      assert.equal(call.params?.max_tokens, 8_192)
      assert.equal(Object.hasOwn(call.params ?? {}, 'thinking'), false)
      assert.equal(Object.hasOwn(call.params ?? {}, 'reasoning_effort'), false)
    }

    // 非 reasoning 模型配了 reasoning_effort：只发 reasoning_effort，不发 thinking。
    const effortHarness = createHarness()
    await effortHarness.client.chat(
      [{ type: 'message', role: 'user', content: 'hello' }],
      { request: { ...RELAY_REQUEST, reasoningEffort: 'low' } },
    )
    assert.equal(effortHarness.calls[0]?.params?.reasoning_effort, 'low')
    assert.equal(Object.hasOwn(effortHarness.calls[0]?.params ?? {}, 'thinking'), false)

    // 中转站 gpt / gemini / claude 的 Tool Call 不带 reasoning_content：不再抛 LLMApiError。
    const toolCallHarness = createFetchHarness([() => new Response([
      sseChunk({ tool_calls: [{ index: 0, id: 'call-1', type: 'function', function: { name: 'search_articles', arguments: '{"query":"x"}' } }] }),
      '',
      sseChunk({}, 'tool_calls'),
      '',
      'data: [DONE]',
      '',
    ].join('\n'), { status: 200, headers: { 'Content-Type': 'text/event-stream' } })])
    const events = await collectEvents(toolCallHarness.client.chatStream(
      [{ type: 'message', role: 'user', content: 'hello' }],
      { request: RELAY_REQUEST },
    ))

    assert.deepEqual(events, [
      { type: 'tool_call_started' },
      {
        type: 'tool_call_completed',
        toolCall: { providerCallId: 'call-1', name: 'search_articles', argumentsJson: '{"query":"x"}', index: 0 },
        reasoningContent: '',
      },
      { type: 'response_completed', finishReason: 'tool_calls' },
    ])
  })

  it('请求已发起但 SDK 在首个 chunk 前失败时提交 empty capture', async () => {
    const harness = createHarness({ captureModelIO: true })
    let captured: unknown

    Object.defineProperty(harness.client, 'createClient', {
      configurable: true,
      value: () => ({
        chat: {
          completions: {
            create: async () => {
              throw new Error('connection failed')
            },
          },
        },
      }),
    })

    await assert.rejects(
      collectEvents(harness.client.chatStream(
        [{ type: 'message', role: 'user', content: 'hello' }],
        { request: DEEPSEEK_REQUEST, debugCapture: {
          onRequest: () => {},
          onResponse: (capture) => {
            captured = capture
          },
        } },
      )),
      LLMNetworkError,
    )
    assert.deepEqual(captured, {
      state: 'empty',
      lastEvent: null,
      textChars: 0,
      toolCallCount: 0,
    })
  })

  it('debug 回调失败只通知安全失败侧，不影响正常模型事件', async () => {
    const harness = createHarness({ captureModelIO: true })
    const failedSides: string[] = []

    const events = await collectEvents(harness.client.chatStream(
      [{ type: 'message', role: 'user', content: 'hello' }],
      { request: DEEPSEEK_REQUEST, debugCapture: {
        onRequest: () => {
          throw new Error('request capture failed')
        },
        onResponse: () => {
          throw new Error('response capture failed')
        },
        onCaptureError: side => failedSides.push(side),
      } },
    ))

    assert.deepEqual(events, [
      { type: 'text_delta', delta: 'ok' },
      { type: 'response_completed', finishReason: 'stop' },
    ])
    assert.deepEqual(failedSides, ['request', 'response'])
  })
})

describe('OpenAICompatibleClient 瞬态失败重试', () => {
  it('createClient() 交给 SDK 的 maxRetries 为 2', () => {
    const client = new OpenAICompatibleClient(createRuntimeConfig())

    assert.equal(createProviderClient(client).maxRetries, 2)
  })

  it('首次 429 / 503 / 连接错误、第二次成功时 chatStream 正常产出且只记一份请求体', async () => {
    const transientAttempts: Array<() => Response> = [
      () => new Response('{"error":{"message":"rate limited"}}', {
        status: 429,
        headers: { 'retry-after': '0' },
      }),
      () => new Response('{"error":{"message":"overloaded"}}', {
        status: 503,
        headers: { 'retry-after': '0' },
      }),
      () => {
        throw new TypeError('fetch failed')
      },
    ]

    for (const transientAttempt of transientAttempts) {
      const harness = createFetchHarness(
        [transientAttempt, () => okStreamResponse('ok')],
        { captureModelIO: true },
      )
      let requestCaptureCount = 0

      const events = await collectEvents(harness.client.chatStream(
        [{ type: 'message', role: 'user', content: 'hello' }],
        { request: DEEPSEEK_REQUEST, debugCapture: {
          onRequest: () => {
            requestCaptureCount += 1
          },
          onResponse: () => {},
        } },
      ))

      assert.deepEqual(events, [
        { type: 'text_delta', delta: 'ok' },
        { type: 'response_completed', finishReason: 'stop' },
      ])
      assert.equal(harness.fetchCalls.length, 2)
      assert.equal(requestCaptureCount, 1)
    }
  })

  it('400 / 401 / 402 不重试，直接抛对应 LLMError', async () => {
    const cases = [
      { status: 400, error: LLMInvalidRequestError },
      { status: 401, error: LLMAuthError },
      { status: 402, error: LLMBalanceError },
    ]

    for (const { status, error } of cases) {
      const harness = createFetchHarness([
        () => new Response('{"error":{"message":"nope"}}', {
          status,
          headers: { 'retry-after': '0' },
        }),
        () => okStreamResponse('ok'),
      ])

      await assert.rejects(
        collectEvents(harness.client.chatStream([
          { type: 'message', role: 'user', content: 'hello' },
        ], { request: DEEPSEEK_REQUEST })),
        error,
      )
      assert.equal(harness.fetchCalls.length, 1)
    }
  })

  it('重试耗尽后仍抛对应 LLMError', async () => {
    const cases = [
      { status: 429, error: LLMRateLimitError },
      { status: 503, error: LLMServerError },
    ]

    for (const { status, error } of cases) {
      const failure = () => new Response('{"error":{"message":"still failing"}}', {
        status,
        headers: { 'retry-after': '0' },
      })
      const harness = createFetchHarness([failure, failure, failure, () => okStreamResponse('ok')])

      await assert.rejects(
        collectEvents(harness.client.chatStream([
          { type: 'message', role: 'user', content: 'hello' },
        ], { request: DEEPSEEK_REQUEST })),
        error,
      )
      assert.equal(harness.fetchCalls.length, 3)
    }
  })

  it('流正文中途断开不重试，已产出的 delta 保留并抛 LLMNetworkError', async () => {
    const harness = createFetchHarness([
      () => {
        let pulls = 0

        return new Response(new ReadableStream<Uint8Array>({
          pull(controller) {
            if (pulls++ === 0) {
              controller.enqueue(new TextEncoder().encode(
                `${sseChunk({ content: 'partial' })}\n\n`,
              ))
              return
            }
            controller.error(new TypeError('terminated'))
          },
        }), {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        })
      },
      () => okStreamResponse('ok'),
    ])
    const events: unknown[] = []

    await assert.rejects(async () => {
      for await (const event of harness.client.chatStream([
        { type: 'message', role: 'user', content: 'hello' },
      ], { request: DEEPSEEK_REQUEST })) {
        events.push(event)
      }
    }, LLMNetworkError)
    assert.deepEqual(events, [{ type: 'text_delta', delta: 'partial' }])
    assert.equal(harness.fetchCalls.length, 1)
  })

  it('abort 信号触发后不再重试', async () => {
    const abortController = new AbortController()
    const harness = createFetchHarness([
      () => {
        abortController.abort()
        throw new TypeError('fetch failed')
      },
      () => okStreamResponse('ok'),
    ])

    await assert.rejects(
      collectEvents(harness.client.chatStream(
        [{ type: 'message', role: 'user', content: 'hello' }],
        { request: DEEPSEEK_REQUEST, signal: abortController.signal },
      )),
      LLMNetworkError,
    )
    assert.equal(harness.fetchCalls.length, 1)
  })

  it('abort 落在 SDK 退避 sleep 期间时立即抛出，不等 retry-after 睡满', async () => {
    const abortController = new AbortController()
    const harness = createFetchHarness([
      () => {
        // 20ms 后 SDK 已进入 sleep(1000)；没有 rejectOnAbort 要到 1s 后才抛。
        setTimeout(() => abortController.abort(), 20)

        return new Response('{"error":{"message":"rate limited"}}', {
          status: 429,
          headers: { 'retry-after-ms': '1000' },
        })
      },
      () => okStreamResponse('ok'),
    ])
    const startedAt = Date.now()

    await assert.rejects(
      collectEvents(harness.client.chatStream(
        [{ type: 'message', role: 'user', content: 'hello' }],
        { request: DEEPSEEK_REQUEST, signal: abortController.signal },
      )),
      LLMNetworkError,
    )
    assert.ok(Date.now() - startedAt < 500, 'abort 被 SDK 退避 sleep 拖住了')
    assert.equal(harness.fetchCalls.length, 1)
  })

  it('多轮采样共用同一个 signal 时不在它上面累积 SDK 的 abort 监听', async () => {
    const abortController = new AbortController()
    const harness = createFetchHarness(
      Array.from({ length: 12 }, () => () => okStreamResponse('ok')),
    )

    for (let round = 0; round < 12; round += 1) {
      await collectEvents(harness.client.chatStream(
        [{ type: 'message', role: 'user', content: 'hello' }],
        { request: DEEPSEEK_REQUEST, signal: abortController.signal },
      ))
    }

    assert.equal(harness.fetchCalls.length, 12)
    assert.equal(getEventListeners(abortController.signal, 'abort').length, 0)
  })
})

interface ProviderCall {
  kind: string
  options: { timeout: number }
  params?: Record<string, unknown>
}

function createRuntimeConfig(options: { captureModelIO?: boolean } = {}): LLMClientConfig {
  return {
    apiKey: 'test-api-key',
    baseUrl: 'https://api.deepseek.com/v1',
    captureModelIO: options.captureModelIO ?? false,
  }
}

function createHarness(
  options: { captureModelIO?: boolean } = {},
) {
  const calls: ProviderCall[] = []
  const client = new OpenAICompatibleClient(createRuntimeConfig(options))
  const providerClient = {
    get: async (path: string, options: { timeout: number }) => {
      calls.push({ kind: `metadata:${path}`, options })

      return path === '/models'
        ? { object: 'list', data: [] }
        : { is_available: true, balance_infos: [] }
    },
    chat: {
      completions: {
        create: async (
          params: Record<string, unknown>,
          options: { timeout: number },
        ) => {
          calls.push({
            kind: params.stream ? 'stream' : 'chat',
            params,
            options,
          })

          if (params.stream) {
            return toProviderStream([{
              id: 'response-1',
              choices: [{
                index: 0,
                delta: { content: 'ok' },
                finish_reason: 'stop',
              }],
              created: 0,
              model: 'deepseek-v4-flash',
              object: 'chat.completion.chunk',
            }])
          }

          return {
            choices: [{
              message: { content: 'ok' },
            }],
          }
        },
      },
    },
  }

  Object.defineProperty(client, 'createClient', {
    configurable: true,
    value: () => providerClient,
  })

  return { calls, client }
}

/** 读取 private createClient()，让 fake fetch 沿用生产 client 的 maxRetries。 */
function createProviderClient(client: OpenAICompatibleClient): OpenAI {
  // eslint-disable-next-line dot-notation
  return client['createClient']()
}

/** 真实 SDK client + 按次序消费的 fake fetch；attempt 抛错即模拟连接错误。 */
function createFetchHarness(
  attempts: Array<() => Response>,
  options: { captureModelIO?: boolean } = {},
) {
  const fetchCalls: RequestInit[] = []
  const client = new OpenAICompatibleClient(createRuntimeConfig(options))
  const providerClient = createProviderClient(client).withOptions({
    fetch: async (_input, init) => {
      fetchCalls.push(init ?? {})
      const attempt = attempts[fetchCalls.length - 1]

      assert.ok(attempt, `fake fetch 第 ${fetchCalls.length} 次调用没有预设响应`)

      return attempt()
    },
  })

  Object.defineProperty(client, 'createClient', {
    configurable: true,
    value: () => providerClient,
  })

  return { fetchCalls, client }
}

function sseChunk(delta: Record<string, unknown>, finishReason?: string): string {
  return `data: ${JSON.stringify({
    id: 'response-1',
    choices: [{ index: 0, delta, finish_reason: finishReason ?? null }],
    created: 0,
    model: 'deepseek-v4-flash',
    object: 'chat.completion.chunk',
  })}`
}

function okStreamResponse(content: string): Response {
  return new Response(
    `${sseChunk({ content }, 'stop')}\n\ndata: [DONE]\n\n`,
    { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
  )
}

async function* toProviderStream(
  chunks: object[],
): AsyncGenerator<object> {
  yield* chunks
}

async function collectEvents(
  source: AsyncIterable<unknown>,
): Promise<unknown[]> {
  const events: unknown[] = []

  for await (const event of source)
    events.push(event)

  return events
}
