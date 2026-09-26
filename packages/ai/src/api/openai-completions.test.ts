import type { LLMClientConfig, ResolvedChatRequestConfig } from '../config.js'
import type { ModelRawResponseCapture } from '../types.js'
import assert from 'node:assert/strict'
import { getEventListeners } from 'node:events'
import { familyCompatOf } from '@agent/contracts'

import OpenAI from 'openai'
import { describe, it, vi } from 'vitest'
import {
  LLMApiError,
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
  compat: familyCompatOf('deepseek'),
  reasoningEffort: 'high',
}

/** 中转站后面的非 reasoning 模型且没配 reasoning_effort：两个参数都不发，Tool Call 不要求 reasoning_content。 */
const RELAY_REQUEST: ResolvedChatRequestConfig = {
  model: 'gpt-5.6-sol',
  contextWindowTokens: 128_000,
  maxOutputTokens: 8_192,
  compat: familyCompatOf('openai'),
}

describe('OpenAICompatibleClient runtime config', () => {
  it('metadata 与 Stream 分别使用 10s 和 10min', async () => {
    const harness = createHarness()

    await harness.client.listModels()
    await harness.client.getUserBalance()
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
        { kind: 'stream', timeout: 600_000 },
      ],
    )
    assert.equal(harness.calls[2]?.params?.max_tokens, 65_536)
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

  it('带 tools 的多轮请求：DeepSeek 家族的历史 assistant 回复在实际 wire body 里带空 reasoning_content，其他家族不带', async () => {
    const cases = [
      [DEEPSEEK_REQUEST, { role: 'assistant', content: '上一轮回答', reasoning_content: '' }],
      [RELAY_REQUEST, { role: 'assistant', content: '上一轮回答' }],
    ] as const

    for (const [request, expected] of cases) {
      const { fetchCalls, client } = createFetchHarness([() => okStreamResponse('ok')])

      await collectEvents(client.chatStream([
        { type: 'message', role: 'user', content: '上一轮问题' },
        { type: 'message', role: 'assistant', content: '上一轮回答' },
        { type: 'message', role: 'user', content: '这一轮问题' },
      ], {
        request,
        tools: [{
          name: 'search_articles',
          description: '按关键词查询文章',
          inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'], additionalProperties: false },
        }],
      }))

      assert.equal(fetchCalls.length, 1)
      const wireBody = JSON.parse(String(fetchCalls[0]!.body)) as { messages: unknown[], tools: unknown[] }

      assert.equal(wireBody.tools.length, 1)
      assert.deepEqual(wireBody.messages[1], expected)
    }
  })

  it('非 reasoning 模型不发 thinking 参数，Tool Call 无 reasoning_content 也能完成', async () => {
    const harness = createHarness()

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
    await collectEvents(effortHarness.client.chatStream(
      [{ type: 'message', role: 'user', content: 'hello' }],
      { request: { ...RELAY_REQUEST, reasoningEffort: 'low' } },
    ))
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

  it('400 / 401 / 402 / 403 不重试，直接抛对应 LLMError', async () => {
    const cases = [
      { status: 400, error: LLMInvalidRequestError },
      { status: 401, error: LLMAuthError },
      { status: 402, error: LLMBalanceError },
      { status: 403, error: LLMAuthError },
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
        (thrown) => {
          assert.ok(thrown instanceof error, 'thrown instanceof error')
          // 认证类文案带实际状态码，403 不能写成 401。
          if (thrown instanceof LLMAuthError)
            assert.match(thrown.message, new RegExp(`（${status}）`))
          return true
        },
      )
      assert.equal(harness.fetchCalls.length, 1)
    }
  })

  it('重试耗尽后仍抛对应 LLMError', async () => {
    const cases = [
      { status: 429, error: LLMRateLimitError },
      { status: 503, error: LLMServerError },
      // 中转站网关故障与 500 / 503 同归服务端错误，不落成协议异常。
      { status: 502, error: LLMServerError },
      { status: 504, error: LLMServerError },
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

  it('流正文阶段 abort 时按 abort 抛出，不报成缺 finish reason，capture 标 partial', async () => {
    const abortController = new AbortController()
    const harness = createFetchHarness([
      () => {
        const signal = harness.fetchCalls[0]?.signal ?? undefined

        return new Response(new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode(`${sseChunk({ content: 'partial' })}\n\n`))
            // 与真实 fetch 一致：请求 signal abort 后响应体以 AbortError 出错，SDK 会静默结束迭代。
            signal?.addEventListener('abort', () => {
              controller.error(new DOMException('This operation was aborted', 'AbortError'))
            }, { once: true })
          },
        }), {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        })
      },
    ], { captureModelIO: true })
    const events: unknown[] = []
    let captured: ModelRawResponseCapture | undefined

    await assert.rejects(async () => {
      for await (const event of harness.client.chatStream(
        [{ type: 'message', role: 'user', content: 'hello' }],
        {
          request: DEEPSEEK_REQUEST,
          signal: abortController.signal,
          debugCapture: {
            onRequest: () => {},
            onResponse: (capture) => {
              captured = capture
            },
          },
        },
      )) {
        events.push(event)
        abortController.abort()
      }
    }, (error) => {
      assert.ok(error instanceof LLMNetworkError, 'error instanceof LLMNetworkError')
      assert.doesNotMatch(error.message, /finish reason/)
      return true
    })
    assert.deepEqual(events, [{ type: 'text_delta', delta: 'partial' }])
    assert.equal(captured?.state, 'partial')
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

  it('元数据请求的调用方 signal 落在 retry-after 退避期间时立即抛出', async () => {
    for (const request of ['listModels', 'getUserBalance'] as const) {
      const abortController = new AbortController()
      const harness = createFetchHarness([
        () => {
          setTimeout(() => abortController.abort(), 20)

          return new Response('{"error":{"message":"busy"}}', {
            status: 503,
            headers: { 'retry-after-ms': '1000' },
          })
        },
        () => new Response('{"object":"list","data":[]}', { status: 200 }),
      ])
      const startedAt = Date.now()

      await assert.rejects(
        harness.client[request]({ signal: abortController.signal }),
        LLMNetworkError,
      )
      assert.ok(Date.now() - startedAt < 500, `${request} 被 SDK 退避 sleep 拖住了`)
      assert.equal(harness.fetchCalls.length, 1)
    }
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

describe('OpenAICompatibleClient 未映射状态码的错误文案', () => {
  async function rejectWith(response: () => Response): Promise<LLMApiError> {
    const harness = createFetchHarness([response])
    let failure: unknown

    try {
      await collectEvents(harness.client.chatStream(
        [{ type: 'message', role: 'user', content: 'hello' }],
        { request: RELAY_REQUEST },
      ))
    }
    catch (error) {
      failure = error
    }

    assert.ok(failure instanceof LLMApiError, 'failure instanceof LLMApiError')
    return failure
  }

  it('非 JSON body（HTML 页面 / 纯文本）不进文案，只报状态码；detail 仍是完整 APIError', async () => {
    for (const status of [404, 405]) {
      const error = await rejectWith(() => new Response('<html><body>SECRET_UPSTREAM_PAGE</body></html>', {
        status,
        headers: { 'Content-Type': 'text/html' },
      }))

      assert.equal(error.message, `LLM API HTTP ${status} 错误`)
      assert.ok(error.detail instanceof OpenAI.APIError, 'error.detail instanceof OpenAI.APIError')
      assert.match(error.detail.message, /SECRET_UPSTREAM_PAGE/)
    }
  })

  it('JSON body 的 error 对象只取字符串 code / type 与截断、去控制字符后的 message', async () => {
    const error = await rejectWith(() => new Response(JSON.stringify({
      error: {
        code: 'model_not_found',
        type: 404,
        message: `line1\nline2\u0007\u202E${'x'.repeat(500)}`,
        param: 'SHOULD_NOT_APPEAR',
      },
    }), { status: 404, headers: { 'Content-Type': 'application/json' } }))
    const upstream = error.message.replace('LLM API HTTP 404 错误: [model_not_found] ', '')

    assert.match(error.message, /^LLM API HTTP 404 错误: \[model_not_found\] line1 line2 x+…$/)
    assert.ok(upstream.length <= 200, `message 截断后仍有 ${upstream.length} 字符`)
    assert.doesNotMatch(error.message, /SHOULD_NOT_APPEAR|\p{Cc}|\p{Cf}/u)
  })

  it('502 纯文本（重试耗尽后）归 LLMServerError，文案不带上游 body', async () => {
    const failure = () => new Response('SECRET_UPSTREAM_BAD_GATEWAY_TEXT', {
      status: 502,
      headers: { 'Content-Type': 'text/plain', 'retry-after': '0' },
    })
    const harness = createFetchHarness([failure, failure, failure])

    await assert.rejects(
      collectEvents(harness.client.chatStream(
        [{ type: 'message', role: 'user', content: 'hello' }],
        { request: RELAY_REQUEST },
      )),
      (error: unknown) => {
        assert.ok(error instanceof LLMServerError, 'error instanceof LLMServerError')
        assert.match(error.message, /（502）/)
        assert.doesNotMatch(error.message, /SECRET_UPSTREAM/)
        return true
      },
    )
  })

  it('截断不在代理对中间切开', async () => {
    const error = await rejectWith(() => new Response(JSON.stringify({
      error: { message: `${'a'.repeat(198)}😀${'b'.repeat(10)}` },
    }), { status: 404, headers: { 'Content-Type': 'application/json' } }))

    assert.equal(error.message, `LLM API HTTP 404 错误: ${'a'.repeat(198)}…`)
  })

  it('JSON body 的 error 不是对象（字符串 / 缺失）时同样只报状态码', async () => {
    for (const body of [{ error: 'plain upstream text' }, { message: 'no error wrapper' }]) {
      const error = await rejectWith(() => new Response(JSON.stringify(body), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      }))

      assert.equal(error.message, 'LLM API HTTP 404 错误')
    }
  })
})

/** 取一次 chatStream 的失败；默认只备一份响应（多发一次请求就会断言失败），5xx 用例传 3 份给 SDK 重试。 */
async function failureOf(response: () => Response, attempts = 1): Promise<unknown> {
  const harness = createFetchHarness(Array.from<() => Response>({ length: attempts }).fill(response))

  try {
    await collectEvents(harness.client.chatStream(
      [{ type: 'message', role: 'user', content: 'hello' }],
      { request: RELAY_REQUEST },
    ))
  }
  catch (error) {
    return error
  }
  assert.fail('chatStream 应当失败')
}

describe('OpenAICompatibleClient 模型调用边界（#168）', () => {
  const sse = (...lines: string[]) => () => new Response(
    lines.map(line => `${line}\n\n`).join(''),
    { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
  )

  it('AC-01 上游报错回显本次 key：code / type / message 里的 key 换成 ***，截断也不留半截', async () => {
    const key = createRuntimeConfig().apiKey
    const echoed = await failureOf(() => new Response(JSON.stringify({
      error: { code: `bad_${key}`, type: 'auth', message: `Incorrect API key provided: ${key}.` },
    }), { status: 404, headers: { 'Content-Type': 'application/json' } }))
    const atBoundary = await failureOf(() => new Response(JSON.stringify({
      error: { message: `${'x'.repeat(190)}${key}${'y'.repeat(50)}` },
    }), { status: 404, headers: { 'Content-Type': 'application/json' } }))
    const inStream = await failureOf(sse(`data: ${JSON.stringify({ error: { code: 'invalid_api_key', message: `bad key ${key}` } })}`))

    for (const error of [echoed, atBoundary, inStream]) {
      assert.ok(error instanceof LLMApiError, 'error instanceof LLMApiError')
      assert.doesNotMatch(error.message, /test-api/)
      assert.match(error.message, /\*\*\*/)
    }
    assert.equal((echoed as LLMApiError).message, 'LLM API HTTP 404 错误: [bad_*** / auth] Incorrect API key provided: ***.')
  })

  it('少于 8 个字符的占位 key 不做替换，正文不被打乱', async () => {
    const harness = createFetchHarness([() => new Response(JSON.stringify({
      error: { message: 'model none not found' },
    }), { status: 404, headers: { 'Content-Type': 'application/json' } })], { apiKey: 'none' })

    await assert.rejects(
      collectEvents(harness.client.chatStream(
        [{ type: 'message', role: 'user', content: 'hello' }],
        { request: RELAY_REQUEST },
      )),
      (error: unknown) => error instanceof LLMApiError && error.message === 'LLM API HTTP 404 错误: model none not found',
    )
  })

  it('AC-02 SSE 行不是合法 JSON：SDK 不往 stderr 打上游原文，归为协议错误且文案不带片段', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    try {
      const error = await failureOf(sse('data: {"choices": SECRET_UPSTREAM_LINE'))

      assert.ok(error instanceof LLMApiError, 'error instanceof LLMApiError')
      assert.equal(error.message, '模型服务返回了无法解析的数据')
      assert.equal(consoleError.mock.calls.length, 0)
      assert.equal(consoleWarn.mock.calls.length, 0)
    }
    finally {
      consoleError.mockRestore()
      consoleWarn.mockRestore()
    }
  })

  it('AC-03 数据块没有 choices：报协议错误，不再变成 TypeError / 网络错误', async () => {
    const error = await failureOf(sse('data: {"message":"upstream oops"}', 'data: [DONE]'))

    assert.ok(error instanceof LLMApiError, 'error instanceof LLMApiError')
    assert.match(error.message, /没有 choices/)
  })

  it('AC-04 流内 error 对象带 HTTP 状态码时与响应状态码同表归类，非数值 code 仍是协议错误', async () => {
    const cases: Array<[unknown, (error: unknown) => boolean]> = [
      [429, error => error instanceof LLMRateLimitError],
      [503, error => error instanceof LLMServerError && /（503）/.test(error.message)],
      ['502', error => error instanceof LLMServerError && /（502）/.test(error.message)],
      [401, error => error instanceof LLMAuthError],
      ['server_busy', error => error instanceof LLMApiError && /未知 HTTP 状态/.test(error.message)],
      [42, error => error instanceof LLMApiError && /未知 HTTP 状态/.test(error.message)],
      // 200 / 300 不是错误状态，多半是中转站自己的业务码，不当 HTTP 状态归类。
      [200, error => error instanceof LLMApiError && /未知 HTTP 状态/.test(error.message)],
      ['300', error => error instanceof LLMApiError && /未知 HTTP 状态/.test(error.message)],
    ]

    for (const [code, matches] of cases) {
      const error = await failureOf(sse(`data: ${JSON.stringify({ error: { code, message: 'upstream said no' } })}`))

      assert.ok(matches(error), `code ${String(code)} 归类不对：${String(error)}`)
    }
  })
})

describe('OpenAICompatibleClient 映射状态码保留上游原因（#175）', () => {
  // 502 会被 SDK 重试：retry-after 0 免得等退避。
  const json = (status: number, error: unknown) => () => new Response(
    JSON.stringify({ error }),
    { status, headers: { 'Content-Type': 'application/json', 'retry-after': '0' } },
  )

  it('AC-01 400 / 422 带上游摘要，其中的本次 key 换成 ***', async () => {
    const key = createRuntimeConfig().apiKey

    for (const status of [400, 422]) {
      const error = await failureOf(json(status, { type: 'invalid_request_error', message: `max_tokens too large for ${key}` }))

      assert.ok(error instanceof LLMInvalidRequestError, 'error instanceof LLMInvalidRequestError')
      assert.match(error.message, /\[invalid_request_error\] max_tokens too large for \*\*\*$/)
      assert.doesNotMatch(error.message, /test-api/)
    }
  })

  it('AC-02 中转站 400 upstream_error 归 LLMServerError，文案带上游摘要', async () => {
    const error = await failureOf(json(400, { code: null, type: 'upstream_error', message: 'Upstream request failed' }))

    assert.ok(error instanceof LLMServerError, 'error instanceof LLMServerError')
    assert.match(error.message, /（400）.*: \[upstream_error\] Upstream request failed$/)
  })

  it('AC-03 流内 error 对象 upstream_error（code 为 400 或 null）同样归 LLMServerError；5xx 的摘要进文案', async () => {
    for (const code of [400, null]) {
      const inStream = await failureOf(() => new Response(
        `data: ${JSON.stringify({ error: { code, type: 'upstream_error', message: 'Upstream request failed' } })}\n\n`,
        { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
      ))

      assert.ok(inStream instanceof LLMServerError, `code ${String(code)}：${String(inStream)}`)
      assert.match(inStream.message, code === null ? /（502）/ : /（400）/)
      assert.match(inStream.message, /\[upstream_error\] Upstream request failed$/)
    }
    const server = await failureOf(json(502, { type: 'bad_gateway', message: 'upstream timeout' }), 3)
    // 沿用上游状态码的 upstream_error 照常按状态码归类。
    const rateLimited = await failureOf(json(429, { type: 'upstream_error', message: 'Upstream rate limited' }), 3)
    const inStreamAuth = await failureOf(() => new Response(
      `data: ${JSON.stringify({ error: { code: 401, type: 'upstream_error', message: 'bad key' } })}\n\n`,
      { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
    ))

    assert.ok(rateLimited instanceof LLMRateLimitError, 'rateLimited instanceof LLMRateLimitError')
    assert.ok(inStreamAuth instanceof LLMAuthError, 'inStreamAuth instanceof LLMAuthError')

    assert.ok(server instanceof LLMServerError, 'server instanceof LLMServerError')
    assert.match(server.message, /（502）.*: \[bad_gateway\] upstream timeout$/)
  })
})

interface ProviderCall {
  kind: string
  options: { timeout: number }
  params?: Record<string, unknown>
}

function createRuntimeConfig(options: { captureModelIO?: boolean, apiKey?: string } = {}): LLMClientConfig {
  return {
    apiKey: options.apiKey ?? 'test-api-key',
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
  options: { captureModelIO?: boolean, apiKey?: string } = {},
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
