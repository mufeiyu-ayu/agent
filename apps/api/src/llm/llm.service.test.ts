import type { LLMRuntimeConfigService } from './llm-runtime-config.service.js'
import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test
import { afterEach, describe, it } from 'node:test'
import { LLMApiError, LLMNetworkError } from '@agent/ai'

import { LLMService } from './llm.service.js'

const originalFetch = globalThis.fetch
const originalTimeout = AbortSignal.timeout
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
    AbortSignal.timeout = originalTimeout
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

  it('/models 返回 404 / 400 页面时给 baseUrl 提示并带状态码，文案不带上游 body', async () => {
    for (const status of [404, 400]) {
      globalThis.fetch = (async () => new Response('<html>UPSTREAM_BODY</html>', { status })) as typeof fetch

      await assert.rejects(createService().listProviderModelNames(SNAPSHOT), (error: unknown) => {
        assert.ok(error instanceof LLMApiError)
        assert.match(error.message, new RegExp(`（HTTP ${status}），请检查 baseUrl 是否填到 /v1`))
        assert.doesNotMatch(error.message, /UPSTREAM_BODY/)
        return true
      })
    }
  })

  it('余额打 origin 下的 /user/balance（不带 /v1），404 等 LLMError 归一为 null', async () => {
    const calls = stubFetch({ is_available: true, balance_infos: [] })
    const service = createService()

    assert.deepEqual(await service.getProviderBalance(SNAPSHOT), { is_available: true, balance_infos: [] })
    assert.deepEqual(calls.urls, ['https://relay.example/user/balance'])

    globalThis.fetch = (async () => new Response('404 page not found', { status: 404 })) as typeof fetch
    assert.equal(await service.getProviderBalance(SNAPSHOT), null)
  })

  it('上游在响应头前挂住时，探活 / 拉取 / 余额都在 30s 上界内结束，原因写明超时', async () => {
    const requestedTimeouts: number[] = []

    // 把 30s 缩成 20ms 跑：断言传进来的上界，再让同一个 signal 真实触发。
    AbortSignal.timeout = (ms: number) => {
      requestedTimeouts.push(ms)
      return originalTimeout.call(AbortSignal, 20)
    }
    globalThis.fetch = ((_input: string | URL | Request, init?: RequestInit) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true })
    })) as typeof fetch
    const service = createService()

    const probe = await service.probeModel(SNAPSHOT, 'gpt-5.6-sol')
    assert.equal(probe.ok, false)
    assert.match(probe.ok ? '' : probe.error, /请求超时（30s 内未完成）/)

    await assert.rejects(service.listProviderModelNames(SNAPSHOT), (error: unknown) => {
      assert.ok(error instanceof LLMNetworkError)
      assert.match(error.message, /请求超时/)
      return true
    })
    assert.equal(await service.getProviderBalance(SNAPSHOT), null)
    assert.deepEqual(requestedTimeouts, [30_000, 30_000, 30_000])
  })
})
