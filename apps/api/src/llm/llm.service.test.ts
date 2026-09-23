import type { PrismaService } from '../prisma/prisma.service.js'
import type { LLMRuntimeConfigService } from './llm-runtime-config.service.js'
import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test
import { afterEach, describe, it } from 'node:test'
import { LLMApiError, LLMNetworkError } from '@agent/ai'
import { familyCompatOf, reasoningEffortsOf } from '@agent/contracts'

import { createApiKeyCipher } from './api-key-cipher.js'
import { LlmModelConfigService } from './llm-model-config.service.js'
import { LLMController } from './llm.controller.js'
import { LlmModelUnavailableError } from './llm.errors.js'
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

  it('#168 探活时上游 404 报错回显本次 key：写回 lastProbeError 的失败原因里只有 ***', async () => {
    const provider = { ...SNAPSHOT, apiKey: 'sk-test-echoed-by-upstream' }

    globalThis.fetch = (async () => new Response(JSON.stringify({
      error: { message: `Incorrect API key provided: ${provider.apiKey}` },
    }), { status: 404, headers: { 'Content-Type': 'application/json' } })) as typeof fetch

    const probe = await createService().probeModel(provider, 'gpt-5.6-sol')

    assert.equal(probe.ok, false)
    assert.match(probe.ok ? '' : probe.error, /Incorrect API key provided: \*\*\*/)
    assert.doesNotMatch(probe.ok ? '' : probe.error, /echoed-by-upstream/)
  })

  it('余额打 origin 下的 /user/balance（不带 /v1），404 等 LLMError 归一为 null', async () => {
    const calls = stubFetch({ is_available: true, balance_infos: [] })
    const service = createService()

    assert.deepEqual(await service.getProviderBalance(SNAPSHOT), { is_available: true, balance_infos: [] })
    assert.deepEqual(calls.urls, ['https://relay.example/user/balance'])

    globalThis.fetch = (async () => new Response('404 page not found', { status: 404 })) as typeof fetch
    assert.equal(await service.getProviderBalance(SNAPSHOT), null)
  })

  it('余额只投影声明的字段：多余字段不透传，形状不符为 null，不认识的余额项丢掉', async () => {
    const service = createService()

    stubFetch({
      is_available: true,
      upstream_debug: 'SHOULD_NOT_APPEAR',
      balance_infos: [
        { currency: 'CNY', total_balance: '1.00', granted_balance: '0.00', topped_up_balance: '1.00', account: 'SHOULD_NOT_APPEAR' },
        { currency: 'EUR', total_balance: '2.00', granted_balance: '0.00', topped_up_balance: '2.00' },
        { currency: 'USD', total_balance: 3 },
        'not-an-object',
      ],
    })
    assert.deepEqual(await service.getProviderBalance(SNAPSHOT), {
      is_available: true,
      balance_infos: [{ currency: 'CNY', total_balance: '1.00', granted_balance: '0.00', topped_up_balance: '1.00' }],
    })

    for (const body of [{ error: 'html page' }, { is_available: 'yes', balance_infos: [] }, ['not', 'object']]) {
      stubFetch(body)
      assert.equal(await service.getProviderBalance(SNAPSHOT), null)
    }
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

describe('GET /api/llm/balance：只查 https 的官方 DeepSeek 账号', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  const RUNTIME_CONFIG = { value: { secretKey: 'x'.repeat(32), captureModelIO: false } } as LLMRuntimeConfigService

  /**
   * fake prisma 只实现 findMany：返回「启用的 DeepSeek 服务商」；没有 llmModel，走到默认模型回退就会抛错。
   * 传字符串为密钥正常的行，传 `{ baseUrl, apiKeyEncrypted }` 可以造解不开的密文。
   */
  function createController(rows: Array<string | { baseUrl: string, apiKeyEncrypted: string }>): LLMController {
    const cipher = createApiKeyCipher(RUNTIME_CONFIG.value.secretKey)
    const providers = rows.map((row, index) => ({
      id: `provider-${index}`,
      ...(typeof row === 'string' ? { baseUrl: row, apiKeyEncrypted: cipher.encrypt('sk-test-not-a-real-key') } : row),
    }))
    const prisma = { llmProvider: { findMany: async () => providers } } as unknown as PrismaService

    return new LLMController(new LLMService(RUNTIME_CONFIG), new LlmModelConfigService(prisma, RUNTIME_CONFIG))
  }

  it('官方账号是 http 或只有中转站时余额为 null，且不发出任何请求', async () => {
    for (const baseUrls of [['http://api.deepseek.com'], ['http://relay.example/v1'], []]) {
      const calls = stubFetch({ is_available: true, balance_infos: [] })

      assert.equal(await createController(baseUrls).getUserBalance(), null)
      assert.deepEqual(calls.urls, [])
    }
  })

  it('https 官方账号正常查余额；密钥解不开的跳过，全都解不开时为 null 且不发请求', async () => {
    let calls = stubFetch({ is_available: true, balance_infos: [] })

    assert.deepEqual(
      await createController(['http://relay.example/v1', 'https://API.deepseek.com']).getUserBalance(),
      { is_available: true, balance_infos: [] },
    )
    assert.deepEqual(calls.urls, ['https://api.deepseek.com/user/balance'])
    assert.deepEqual(calls.authorizations, ['Bearer sk-test-not-a-real-key'])

    const broken = { baseUrl: 'https://api.deepseek.com', apiKeyEncrypted: 'v1:bad:bad:bad' }

    calls = stubFetch({ is_available: true, balance_infos: [] })
    assert.deepEqual(await createController([broken, 'https://api.deepseek.com/v1']).getUserBalance(), { is_available: true, balance_infos: [] })
    assert.deepEqual(calls.authorizations, ['Bearer sk-test-not-a-real-key'])

    calls = stubFetch({ is_available: true, balance_infos: [] })
    assert.equal(await createController([broken]).getUserBalance(), null)
    assert.deepEqual(calls.urls, [])
  })
})

describe('模型解析：库里的 family 是原型链上的名字', () => {
  const RUNTIME_CONFIG = { value: { secretKey: 'x'.repeat(32), captureModelIO: false } } as LLMRuntimeConfigService

  function createConfigService(family: string): LlmModelConfigService {
    const cipher = createApiKeyCipher(RUNTIME_CONFIG.value.secretKey)
    const model = {
      id: 'model-1',
      wireName: 'wire-model',
      contextWindowTokens: 128_000,
      maxOutputTokens: 8_192,
      reasoningEffort: null,
      visible: true,
      provider: {
        id: 'provider-1',
        family,
        enabled: true,
        baseUrl: 'https://relay.example/v1',
        apiKeyEncrypted: cipher.encrypt('sk-test-not-a-real-key'),
      },
    }
    const prisma = { llmModel: { findFirst: async () => model } } as unknown as PrismaService

    return new LlmModelConfigService(prisma, RUNTIME_CONFIG)
  }

  it('constructor / __proto__ 按不认识的家族处理：强度为空、compat 同 other，请求强度按不支持拒绝', async () => {
    for (const family of ['constructor', '__proto__', 'toString']) {
      assert.deepEqual(reasoningEffortsOf(family), [], family)
      assert.deepEqual(familyCompatOf(family), familyCompatOf('other'), family)

      const service = createConfigService(family)

      assert.deepEqual((await service.resolveModel('model-1')).profile.compat, familyCompatOf('other'), family)
      await assert.rejects(service.resolveModel('model-1', 'low'), LlmModelUnavailableError, family)
    }
  })
})
