import type { LLMRuntimeConfigService } from './llm-runtime-config.service.js'
import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test
import { afterEach, describe, it } from 'node:test'
import { LLMApiError } from '@agent/ai'

import { LLMService } from './llm.service.js'

const originalFetch = globalThis.fetch
const SNAPSHOT = {
  providerId: 'provider-1',
  baseUrl: 'https://relay.example/v1',
  apiKey: 'sk-old',
}

function createService(): LLMService {
  return new LLMService({
    value: { secretKey: 'x'.repeat(32), captureModelIO: false },
  } as LLMRuntimeConfigService)
}

function stubFetch(body: unknown): { urls: string[], authorizations: string[] } {
  const calls = { urls: [] as string[], authorizations: [] as string[] }

  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.urls.push(String(input))
    calls.authorizations.push(new Headers(init?.headers).get('authorization') ?? '')

    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }) as typeof fetch

  return calls
}

describe('LLMService', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('每次调用都按传入的凭据快照打请求：Run 内旧快照用旧 key，下一个 Run 的新快照用新 key', async () => {
    const calls = stubFetch({ object: 'list', data: [{ id: 'gpt-5.6-sol' }, { object: 'model' }] })
    const service = createService()

    assert.deepEqual(await service.listProviderModelNames(SNAPSHOT), ['gpt-5.6-sol'])
    await service.listProviderModelNames({ ...SNAPSHOT, apiKey: 'sk-new' })

    assert.deepEqual(calls.authorizations, ['Bearer sk-old', 'Bearer sk-new'])
    assert.deepEqual(calls.urls, ['https://relay.example/v1/models', 'https://relay.example/v1/models'])
  })

  it('/models 返回的不是模型列表时抛 LLMApiError 而不是 TypeError', async () => {
    stubFetch({ models: ['gpt-5.6-sol'] })

    await assert.rejects(createService().listProviderModelNames(SNAPSHOT), LLMApiError)
  })

  it('余额打 origin 下的 /user/balance（不带 /v1），404 等 LLMError 归一为 null', async () => {
    const calls = stubFetch({ is_available: true, balance_infos: [] })
    const service = createService()

    assert.deepEqual(await service.getProviderBalance(SNAPSHOT), { is_available: true, balance_infos: [] })
    assert.deepEqual(calls.urls, ['https://relay.example/user/balance'])

    globalThis.fetch = (async () => new Response('404 page not found', { status: 404 })) as typeof fetch
    assert.equal(await service.getProviderBalance(SNAPSHOT), null)
  })
})
