import type { LLMRuntimeConfigService } from '../llm-runtime-config.js'
import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test
import { describe, it } from 'node:test'
import OpenAI from 'openai'

import {
  resolveLLMRuntimeConfig,
} from '../llm-runtime-config.js'
import { LLMConfigError, LLMNetworkError } from '../llm.errors.js'
import { OpenAICompatibleClient } from './openai-compatible.client.js'

describe('OpenAICompatibleClient runtime config', () => {
  it('metadata、普通 Chat 和 Stream 分别使用 10s、60s 和 10min', async () => {
    const harness = createHarness()

    await harness.client.listModels()
    await harness.client.getUserBalance()
    await harness.client.chat([{ role: 'user', content: 'hello' }])
    await collectEvents(harness.client.chatStream([
      { type: 'message', role: 'user', content: 'hello' },
    ]))

    assert.deepEqual(
      harness.calls.map(call => ({
        kind: call.kind,
        timeout: call.options.timeout,
      })),
      [
        { kind: 'metadata:/models', timeout: 10_000 },
        { kind: 'metadata:/user/balance', timeout: 10_000 },
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
        { reasoningEffort },
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
      { reasoningEffort: 'max' },
    ))

    assert.deepEqual(wireBody?.thinking, { type: 'enabled' })
    assert.equal(wireBody?.reasoning_effort, 'max')
    assert.equal(Object.hasOwn(wireBody ?? {}, 'temperature'), false)
  })

  it('Provider Client 只读取已验证配置对象，不读取后续 process.env 变化', async () => {
    const harness = createHarness()
    const previousModel = process.env.LLM_MODEL

    process.env.LLM_MODEL = 'unsupported-model'
    try {
      await harness.client.chat([{ role: 'user', content: 'hello' }])
    }
    finally {
      if (previousModel === undefined)
        delete process.env.LLM_MODEL
      else
        process.env.LLM_MODEL = previousModel
    }

    assert.equal(harness.calls[0]?.params?.model, 'deepseek-v4-flash')
  })

  it('调用级模型或输出预算非法时不发起 Provider 请求', async () => {
    const harness = createHarness()

    await assert.rejects(
      harness.client.chat(
        [{ role: 'user', content: 'hello' }],
        { model: 'unsupported-model' },
      ),
      LLMConfigError,
    )
    await assert.rejects(
      harness.client.chat(
        [{ role: 'user', content: 'hello' }],
        { maxTokens: 131_073 },
      ),
      LLMConfigError,
    )
    assert.equal(harness.calls.length, 0)
  })

  it('请求已发起但 SDK 在首个 chunk 前失败时提交 empty capture', async () => {
    const harness = createHarness(true)
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
        {
          debugCapture: {
            onRequest: () => {},
            onResponse: (capture) => {
              captured = capture
            },
          },
        },
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
    const harness = createHarness(true)
    const failedSides: string[] = []

    const events = await collectEvents(harness.client.chatStream(
      [{ type: 'message', role: 'user', content: 'hello' }],
      {
        debugCapture: {
          onRequest: () => {
            throw new Error('request capture failed')
          },
          onResponse: () => {
            throw new Error('response capture failed')
          },
          onCaptureError: side => failedSides.push(side),
        },
      },
    ))

    assert.deepEqual(events, [
      { type: 'text_delta', delta: 'ok' },
      { type: 'response_completed', finishReason: 'stop' },
    ])
    assert.deepEqual(failedSides, ['request', 'response'])
  })
})

interface ProviderCall {
  kind: string
  options: { timeout: number }
  params?: Record<string, unknown>
}

function createHarness(captureModelIO = false) {
  const calls: ProviderCall[] = []
  const runtimeConfig = {
    value: resolveLLMRuntimeConfig({
      LLM_API_KEY: 'test-api-key',
      LLM_BASE_URL: 'https://api.deepseek.com/v1',
      LLM_MODEL: 'deepseek-v4-flash',
      ...(captureModelIO ? { AGENT_DEBUG_CAPTURE_MODEL_IO: 'true' } : {}),
    }),
  } as LLMRuntimeConfigService
  const client = new OpenAICompatibleClient(runtimeConfig)
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
