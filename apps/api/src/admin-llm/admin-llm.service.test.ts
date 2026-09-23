import type { AddressInfo } from 'node:net'
import type { LlmModel, LlmProvider } from '../generated/prisma/client.js'
import type { LLMRuntimeConfigService } from '../llm/llm-runtime-config.service.js'
import type { PrismaService } from '../prisma/prisma.service.js'
import type { UpdateAdminLlmModelDto } from './dto/admin-llm.dto.js'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { createServer } from 'node:http'
// eslint-disable-next-line test/no-import-node-test
import { after, before, describe, it } from 'node:test'
import { BadRequestException } from '@nestjs/common'

import { LlmModelConfigService } from '../llm/llm-model-config.service.js'
import { LLMService } from '../llm/llm.service.js'
import { AdminLlmService } from './admin-llm.service.js'

const RUNTIME_CONFIG = {
  value: { secretKey: 'x'.repeat(32), captureModelIO: false },
} as LLMRuntimeConfigService
const STORED_API_KEY = 'sk-test-stored-not-real'
const NEW_API_KEY = 'sk-test-new-not-real'
const BASE_URL_CHANGE_MESSAGE = '更换地址需要重新填写 API Key'

/** 本地假上游：`/stored/v1` 是库里的地址，`/evil/v1` 是请求里换上的外部地址；按前缀记下收到的 Authorization。 */
interface FakeUpstream {
  origin: string
  requests: Array<{ path: string, authorization: string }>
  close: () => Promise<void>
}

async function startFakeUpstream(): Promise<FakeUpstream> {
  const requests: FakeUpstream['requests'] = []
  const server = createServer((request, response) => {
    requests.push({ path: request.url ?? '', authorization: request.headers.authorization ?? '' })

    if (request.method === 'GET' && request.url?.endsWith('/v1/models')) {
      response.writeHead(200, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify({ object: 'list', data: [{ id: 'fake-model' }] }))
      return
    }

    // POST /v1/chat/completions：最短一条流，带 finish_reason 正常结束。
    request.resume()
    request.once('end', () => {
      response.writeHead(200, { 'Content-Type': 'text/event-stream' })
      response.end(`data: ${JSON.stringify({
        id: 'fake-1',
        object: 'chat.completion.chunk',
        created: 0,
        model: 'fake-model',
        choices: [{ index: 0, delta: { content: 'ok' }, finish_reason: 'stop' }],
      })}\n\ndata: [DONE]\n\n`)
    })
  })

  server.listen(0, '127.0.0.1')
  await once(server, 'listening')

  return {
    origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    requests,
    close: () => new Promise(resolve => server.close(() => resolve())),
  }
}

/** 只实现 service 用到的 Prisma 方法；写操作记下来供断言。 */
function createFakePrisma(provider: LlmProvider) {
  const writes: Array<{ op: string, args: unknown }> = []
  const tx = {
    llmModel: {
      updateMany: async (args: unknown) => {
        writes.push({ op: 'llmModel.updateMany', args })
        return { count: 0 }
      },
    },
    llmProvider: {
      update: async (args: { data: Partial<LlmProvider> }) => {
        writes.push({ op: 'llmProvider.update', args })
        return { ...provider, ...args.data, _count: { models: 0 } }
      },
    },
  }
  const prisma = {
    llmProvider: {
      findUnique: async ({ where }: { where: { id: string } }) => where.id === provider.id ? provider : null,
    },
    $transaction: async <T>(operation: (client: typeof tx) => Promise<T>) => operation(tx),
  }

  return { prisma: prisma as unknown as PrismaService, writes }
}

function createService(baseUrl: string) {
  const configPrisma = createFakePrisma({} as LlmProvider).prisma
  const llmModelConfigService = new LlmModelConfigService(configPrisma, RUNTIME_CONFIG)
  const provider: LlmProvider = {
    id: 'provider-1',
    family: 'openai',
    note: '#156 测试',
    baseUrl,
    ...llmModelConfigService.encryptApiKey(STORED_API_KEY),
    enabled: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  }
  const { prisma, writes } = createFakePrisma(provider)

  return {
    provider,
    writes,
    service: new AdminLlmService(prisma, new LLMService(RUNTIME_CONFIG), llmModelConfigService),
  }
}

function isBaseUrlChangeRejected(error: unknown): boolean {
  assert.ok(error instanceof BadRequestException)
  assert.equal(error.message, BASE_URL_CHANGE_MESSAGE)
  return true
}

describe('AdminLlmService 凭据：库里的密钥只发往库里的地址', () => {
  let upstream: FakeUpstream

  before(async () => {
    upstream = await startFakeUpstream()
  })

  after(async () => {
    await upstream.close()
  })

  it('只带 providerId、地址换成外部地址时 fetch-models / test-models 都 400，假服务收不到请求', async () => {
    const { service, provider } = createService(`${upstream.origin}/stored/v1`)
    const evilBaseUrl = `${upstream.origin}/evil/v1`
    upstream.requests.length = 0

    await assert.rejects(service.fetchModelNames({ providerId: provider.id, baseUrl: evilBaseUrl }), isBaseUrlChangeRejected)
    await assert.rejects(
      service.testModelNames({ providerId: provider.id, baseUrl: evilBaseUrl, wireNames: ['fake-model'] }),
      isBaseUrlChangeRejected,
    )
    assert.deepEqual(upstream.requests, [])
  })

  it('带上新的 apiKey 时可以访问请求里的地址，发出去的是新 key', async () => {
    const { service, provider } = createService(`${upstream.origin}/stored/v1`)
    const evilBaseUrl = `${upstream.origin}/evil/v1`
    upstream.requests.length = 0

    assert.deepEqual(
      await service.fetchModelNames({ providerId: provider.id, baseUrl: evilBaseUrl, apiKey: NEW_API_KEY }),
      { models: ['fake-model'] },
    )
    assert.deepEqual(
      await service.testModelNames({ providerId: provider.id, baseUrl: evilBaseUrl, apiKey: NEW_API_KEY, wireNames: ['fake-model'] }),
      { results: [{ wireName: 'fake-model', ok: true, error: null }] },
    )
    assert.deepEqual(upstream.requests, [
      { path: '/evil/v1/models', authorization: `Bearer ${NEW_API_KEY}` },
      { path: '/evil/v1/chat/completions', authorization: `Bearer ${NEW_API_KEY}` },
    ])
  })

  it('只带 providerId、地址与库里相同（末尾斜杠不算不同）时用库里的密钥和地址', async () => {
    const { service, provider } = createService(`${upstream.origin}/stored/v1`)
    upstream.requests.length = 0

    assert.deepEqual(
      await service.fetchModelNames({ providerId: provider.id, baseUrl: `${upstream.origin}/stored/v1/` }),
      { models: ['fake-model'] },
    )
    assert.deepEqual(upstream.requests, [
      { path: '/stored/v1/models', authorization: `Bearer ${STORED_API_KEY}` },
    ])
  })
})

describe('AdminLlmService.updateProvider：换地址必须同时换密钥', () => {
  const STORED_BASE_URL = 'https://stored.example/v1'

  it('只改 baseUrl（apiKey 省略或空串）返回 400，不写库', async () => {
    const { service, provider, writes } = createService(STORED_BASE_URL)

    for (const input of [{ baseUrl: 'https://evil.example/v1' }, { baseUrl: 'https://evil.example/v1', apiKey: '' }]) {
      await assert.rejects(service.updateProvider(provider.id, input), isBaseUrlChangeRejected)
    }
    assert.deepEqual(writes, [])
  })

  it('baseUrl 与 apiKey 一起改时保存成功：写入新地址与新密文，探活结论清空', async () => {
    const { service, provider, writes } = createService(STORED_BASE_URL)

    const updated = await service.updateProvider(provider.id, { baseUrl: 'https://new.example/v1/', apiKey: NEW_API_KEY })
    const providerWrite = writes.find(write => write.op === 'llmProvider.update')?.args as { data: Partial<LlmProvider> }

    assert.equal(updated.baseUrl, 'https://new.example/v1')
    assert.equal(updated.apiKeyLast4, NEW_API_KEY.slice(-4))
    assert.equal(providerWrite.data.baseUrl, 'https://new.example/v1')
    assert.notEqual(providerWrite.data.apiKeyEncrypted, provider.apiKeyEncrypted)
    assert.ok(writes.some(write => write.op === 'llmModel.updateMany'))
  })

  it('地址不变（省略或只差末尾斜杠）时不要求重填密钥，也不把地址写回（避免覆盖并发提交的新地址）', async () => {
    const { service, provider, writes } = createService(STORED_BASE_URL)

    assert.equal((await service.updateProvider(provider.id, { note: '改备注' })).note, '改备注')
    // 管理台编辑弹窗总会带上没改过的 baseUrl。
    assert.equal(
      (await service.updateProvider(provider.id, { baseUrl: `${STORED_BASE_URL}/`, note: '再改' })).baseUrl,
      STORED_BASE_URL,
    )
    for (const write of writes.filter(item => item.op === 'llmProvider.update'))
      assert.equal(Object.hasOwn((write.args as { data: object }).data, 'baseUrl'), false)

    // 库里的旧行带末尾斜杠时，只改备注也不算换地址。
    const legacy = createService(`${STORED_BASE_URL}/`)
    assert.equal((await legacy.service.updateProvider(legacy.provider.id, { note: '旧行改备注' })).note, '旧行改备注')
  })

  it('只换密钥时连同校验过的地址一起写，新 key 不会配上并发改过的地址', async () => {
    const { service, provider, writes } = createService(STORED_BASE_URL)

    await service.updateProvider(provider.id, { apiKey: NEW_API_KEY })
    const providerWrite = writes.find(write => write.op === 'llmProvider.update')?.args as { data: Partial<LlmProvider> }

    assert.equal(providerWrite.data.baseUrl, STORED_BASE_URL)
    assert.equal(providerWrite.data.apiKeyLast4, NEW_API_KEY.slice(-4))
  })
})

/** #170：只有可见行会被 Run 选中，可见行不论改了什么都按运行时公式校验输入预算。 */
describe('AdminLlmService.updateModel 输入预算', () => {
  function createModelService(row: Partial<LlmModel>) {
    const provider = { id: 'provider-1', family: 'openai' } as LlmProvider
    let model: LlmModel & { provider: LlmProvider } = {
      id: 'model-1',
      providerId: provider.id,
      wireName: 'gpt-test',
      displayName: '旧名',
      contextWindowTokens: 1_000_000,
      maxOutputTokens: 65_536,
      reasoningEffort: null,
      visible: true,
      isDefault: false,
      sortOrder: 0,
      lastProbeOk: null,
      lastProbeError: null,
      lastProbedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...row,
      provider,
    }
    const tx = {
      $executeRaw: async () => 0,
      llmModel: {
        update: async ({ data }: { data: Partial<LlmModel> }) => (model = { ...model, ...data }),
      },
    }
    const prisma = {
      llmModel: { findUnique: async () => model },
      $transaction: async <T>(operation: (client: typeof tx) => Promise<T>) => operation(tx),
    } as unknown as PrismaService

    return new AdminLlmService(prisma, new LLMService(RUNTIME_CONFIG), new LlmModelConfigService(prisma, RUNTIME_CONFIG))
  }

  // 32768 − 16384 − 安全余量 16384 = 0：能保存，但每次 Run 都会因预算失败。
  const BROKEN = { contextWindowTokens: 32_768, maxOutputTokens: 16_384 }
  const isBudgetRejected = (error: unknown) => error instanceof BadRequestException && /输入预算/.test(error.message)

  it('可见的坏行只改显示名也返回 400', async () => {
    await assert.rejects(
      createModelService(BROKEN).updateModel('model-1', { displayName: '新名' } as UpdateAdminLlmModelDto),
      isBudgetRejected,
    )
  })

  it('坏行可以先设为隐藏；隐藏的坏行改回可见返回 400', async () => {
    const hidden = await createModelService(BROKEN).updateModel('model-1', { visible: false } as UpdateAdminLlmModelDto)

    assert.equal(hidden.visible, false)
    await assert.rejects(
      createModelService({ ...BROKEN, visible: false }).updateModel('model-1', { visible: true } as UpdateAdminLlmModelDto),
      isBudgetRejected,
    )
  })

  it('预算为正的可见行改名照常保存', async () => {
    const renamed = await createModelService({}).updateModel('model-1', { displayName: '新名' } as UpdateAdminLlmModelDto)

    assert.equal(renamed.displayName, '新名')
  })
})
