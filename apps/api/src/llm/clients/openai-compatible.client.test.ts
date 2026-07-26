import type { LLMRuntimeConfigService } from '../llm-runtime-config.js'
import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test
import { describe, it } from 'node:test'

import {
  resolveLLMRuntimeConfig,
} from '../llm-runtime-config.js'
import { LLMConfigError } from '../llm.errors.js'
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
})

interface ProviderCall {
  kind: string
  options: { timeout: number }
  params?: Record<string, unknown>
}

function createHarness() {
  const calls: ProviderCall[] = []
  const runtimeConfig = {
    value: resolveLLMRuntimeConfig({
      LLM_API_KEY: 'test-api-key',
      LLM_BASE_URL: 'https://api.deepseek.com/v1',
      LLM_MODEL: 'deepseek-v4-flash',
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
