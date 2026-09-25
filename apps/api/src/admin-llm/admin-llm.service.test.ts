import type { AddressInfo } from 'node:net'
import type { LlmModel, LlmProvider } from '../generated/prisma/client.js'
import type { LLMRuntimeConfigService } from '../llm/llm-runtime-config.service.js'
import type { PrismaService } from '../prisma/prisma.service.js'
import type { UpdateAdminLlmModelDto } from './dto/admin-llm.dto.js'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { createServer } from 'node:http'
import { connect } from 'node:net'
// eslint-disable-next-line test/no-import-node-test
import { after, afterEach, before, describe, it } from 'node:test'
import { LLMNetworkError } from '@agent/ai'
import { familyCompatOf } from '@agent/contracts'
import { BadRequestException } from '@nestjs/common'
import { getGlobalDispatcher, setGlobalDispatcher } from 'undici'

import { LlmModelConfigService } from '../llm/llm-model-config.service.js'
import { LlmProxyError } from '../llm/llm.errors.js'
import { LLMService } from '../llm/llm.service.js'
import { resolveOutboundProxyConfig } from '../llm/outbound-proxy.js'
import { AdminLlmService } from './admin-llm.service.js'

const RUNTIME_CONFIG = {
  value: { secretKey: 'x'.repeat(32), captureModelIO: false, outboundProxy: null },
} as LLMRuntimeConfigService
const STORED_API_KEY = 'sk-test-stored-not-real'
const NEW_API_KEY = 'sk-test-new-not-real'
const BASE_URL_CHANGE_MESSAGE = '更换地址需要重新填写 API Key'

/** 本地假上游：`/stored/v1` 是库里的地址，`/evil/v1` 是请求里换上的外部地址；按前缀记下收到的 Authorization。 */
interface FakeUpstream {
  origin: string
  requests: Array<{ path: string, authorization: string }>
  /** 每个请求的对端端口：经代理隧道来的请求，对端是代理连上游的那条 socket。 */
  remotePorts: number[]
  close: () => Promise<void>
}

async function startFakeUpstream(): Promise<FakeUpstream> {
  const requests: FakeUpstream['requests'] = []
  const remotePorts: number[] = []
  const server = createServer((request, response) => {
    requests.push({ path: request.url ?? '', authorization: request.headers.authorization ?? '' })
    remotePorts.push(request.socket.remotePort ?? 0)

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
    remotePorts,
    close: () => new Promise((resolve) => {
      server.closeAllConnections()
      server.close(() => resolve())
    }),
  }
}

/** 会记录连接的测试代理：CONNECT 隧道记 `host:port` 与代理连上游所用的本地端口；普通转发只记 URL 并回 502。 */
interface LoggingProxy {
  origin: string
  connections: Array<{ target: string, proxyAuthorization: string }>
  tunnelPorts: Set<number>
  close: () => Promise<void>
}

async function startLoggingProxy(): Promise<LoggingProxy> {
  const connections: LoggingProxy['connections'] = []
  const tunnelPorts = new Set<number>()
  const server = createServer((request, response) => {
    connections.push({ target: request.url ?? '', proxyAuthorization: request.headers['proxy-authorization'] ?? '' })
    response.writeHead(502)
    response.end()
  })

  server.on('connect', (request, socket, head) => {
    connections.push({ target: request.url ?? '', proxyAuthorization: request.headers['proxy-authorization'] ?? '' })
    const [host, port] = (request.url ?? '').split(':')
    const upstream = connect(Number(port), host, () => {
      tunnelPorts.add(upstream.localPort ?? 0)
      socket.write('HTTP/1.1 200 Connection Established\r\n\r\n')
      upstream.write(head)
      upstream.pipe(socket)
      socket.pipe(upstream)
    })
    upstream.on('error', () => socket.destroy())
    socket.on('error', () => upstream.destroy())
  })

  server.listen(0, '127.0.0.1')
  await once(server, 'listening')

  return {
    origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    connections,
    tunnelPorts,
    close: () => new Promise((resolve) => {
      server.closeAllConnections()
      server.close(() => resolve())
    }),
  }
}

/** 取一个刚释放、没人监听的端口，模拟代理没启动。 */
async function findClosedPort(): Promise<number> {
  const server = createServer()
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const { port } = server.address() as AddressInfo
  await new Promise(resolve => server.close(resolve))

  return port
}

function createProxiedLlmService(proxyUrl: string | null): LLMService {
  return new LLMService({
    value: {
      ...RUNTIME_CONFIG.value,
      outboundProxy: resolveOutboundProxyConfig(proxyUrl ? { OUTBOUND_PROXY_URL: proxyUrl } : {}),
    },
  } as LLMRuntimeConfigService)
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

function createService(baseUrl: string, llmService = new LLMService(RUNTIME_CONFIG), useProxy = false) {
  const configPrisma = createFakePrisma({} as LlmProvider).prisma
  const llmModelConfigService = new LlmModelConfigService(configPrisma, RUNTIME_CONFIG)
  const provider: LlmProvider = {
    id: 'provider-1',
    family: 'openai',
    note: '#156 测试',
    baseUrl,
    ...llmModelConfigService.encryptApiKey(STORED_API_KEY),
    enabled: true,
    useProxy,
    createdAt: new Date(),
    updatedAt: new Date(),
  }
  const { prisma, writes } = createFakePrisma(provider)

  return {
    provider,
    writes,
    service: new AdminLlmService(prisma, llmService, llmModelConfigService),
  }
}

function isBaseUrlChangeRejected(error: unknown): boolean {
  assert.ok(error instanceof BadRequestException, 'error instanceof BadRequestException')
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

    await assert.rejects(service.fetchModelNames({ providerId: provider.id, baseUrl: evilBaseUrl, useProxy: false }), isBaseUrlChangeRejected)
    await assert.rejects(
      service.testModelNames({ providerId: provider.id, baseUrl: evilBaseUrl, wireNames: ['fake-model'], useProxy: false }),
      isBaseUrlChangeRejected,
    )
    assert.deepEqual(upstream.requests, [])
  })

  it('带上新的 apiKey 时可以访问请求里的地址，发出去的是新 key', async () => {
    const { service, provider } = createService(`${upstream.origin}/stored/v1`)
    const evilBaseUrl = `${upstream.origin}/evil/v1`
    upstream.requests.length = 0

    assert.deepEqual(
      await service.fetchModelNames({ providerId: provider.id, baseUrl: evilBaseUrl, apiKey: NEW_API_KEY, useProxy: false }),
      { models: ['fake-model'] },
    )
    assert.deepEqual(
      await service.testModelNames({ providerId: provider.id, baseUrl: evilBaseUrl, apiKey: NEW_API_KEY, wireNames: ['fake-model'], useProxy: false }),
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
      await service.fetchModelNames({ providerId: provider.id, baseUrl: `${upstream.origin}/stored/v1/`, useProxy: false }),
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
    assert.ok(writes.some(write => write.op === 'llmModel.updateMany'), 'writes.some(write => write.op === \'llmModel.updateMany\')')
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

/** #179：勾选「使用代理」的服务商经 OUTBOUND_PROXY_URL，没勾的显式直连，即使全局出口已装成代理。 */
describe('LLMService 出站代理分流', () => {
  let upstream: FakeUpstream
  let proxy: LoggingProxy
  const originalDispatcher = getGlobalDispatcher()

  before(async () => {
    upstream = await startFakeUpstream()
    proxy = await startLoggingProxy()
  })

  afterEach(() => {
    setGlobalDispatcher(originalDispatcher)
  })

  after(async () => {
    await upstream.close()
    await proxy.close()
  })

  /** 聊天、探活、拉取模型三条路径各走一次。 */
  async function exerciseAllPaths(llmService: LLMService, useProxy: boolean) {
    const credentials = { providerId: 'provider-1', baseUrl: `${upstream.origin}/v1`, apiKey: STORED_API_KEY, useProxy }
    const chatEvents = []

    for await (const event of llmService.chatStream(credentials, [{ type: 'message', role: 'user', content: 'hi' }], {
      request: { model: 'fake-model', contextWindowTokens: 0, maxOutputTokens: 16, compat: familyCompatOf('other') },
    })) {
      chatEvents.push(event.type)
    }

    return {
      chatEvents,
      probe: await llmService.probeModel(credentials, 'fake-model'),
      models: await llmService.listProviderModelNames(credentials),
    }
  }

  it('useProxy=true 的三条路径都经过代理；useProxy=false 的三条路径代理记录为零（全局出口已装成代理，启动后第一次请求即生效）', async () => {
    const llmService = createProxiedLlmService(proxy.origin)
    const upstreamHost = new URL(upstream.origin).host
    // 与 API 启动相同：全局出口装成代理；没勾选的服务商仍须直连。
    llmService.onModuleInit()
    proxy.connections.length = 0
    upstream.requests.length = 0
    upstream.remotePorts.length = 0

    const proxied = await exerciseAllPaths(llmService, true)

    assert.ok(proxied.chatEvents.includes('response_completed'), 'proxied.chatEvents.includes(\'response_completed\')')
    assert.deepEqual(proxied.probe, { ok: true })
    assert.deepEqual(proxied.models, ['fake-model'])
    assert.deepEqual(upstream.requests.map(item => item.path), ['/v1/chat/completions', '/v1/chat/completions', '/v1/models'])
    // 隧道会被 keep-alive 复用，按请求的对端端口核对：三条请求都从代理的隧道进来。
    assert.ok(proxy.connections.length > 0, 'proxy.connections.length > 0')
    assert.ok(proxy.connections.every(item => item.target === upstreamHost), 'proxy.connections.every(item => item.target === upstreamHost)')
    assert.ok(upstream.remotePorts.every(port => proxy.tunnelPorts.has(port)), 'upstream.remotePorts.every(port => proxy.tunnelPorts.has(port))')

    proxy.connections.length = 0
    upstream.requests.length = 0
    upstream.remotePorts.length = 0

    const direct = await exerciseAllPaths(llmService, false)

    assert.ok(direct.chatEvents.includes('response_completed'), 'direct.chatEvents.includes(\'response_completed\')')
    assert.deepEqual(direct.probe, { ok: true })
    assert.deepEqual(direct.models, ['fake-model'])
    assert.equal(upstream.requests.length, 3)
    assert.deepEqual(proxy.connections, [])
    assert.ok(upstream.remotePorts.every(port => !proxy.tunnelPorts.has(port)), 'upstream.remotePorts.every(port => !proxy.tunnelPorts.has(port))')
  })

  it('勾选了但本机没配代理：聊天、探活、拉取模型都按 LLMNetworkError 失败，点明缺 OUTBOUND_PROXY_URL，不静默直连', async () => {
    const llmService = createProxiedLlmService(null)
    const credentials = { providerId: 'provider-1', baseUrl: `${upstream.origin}/v1`, apiKey: STORED_API_KEY, useProxy: true }
    const isMissingProxy = (error: unknown) => {
      assert.ok(error instanceof LlmProxyError, 'error instanceof LlmProxyError')
      assert.ok(error instanceof LLMNetworkError, 'error instanceof LLMNetworkError')
      assert.match(error.message, /本机未配置 OUTBOUND_PROXY_URL/)
      return true
    }
    upstream.requests.length = 0

    await assert.rejects(async () => {
      for await (const _event of llmService.chatStream(credentials, [{ type: 'message', role: 'user', content: 'hi' }], {
        request: { model: 'fake-model', contextWindowTokens: 0, maxOutputTokens: 16, compat: familyCompatOf('other') },
      })) {
        // 应在第一次请求前失败
      }
    }, isMissingProxy)
    assert.deepEqual(await llmService.probeModel(credentials, 'fake-model'), {
      ok: false,
      error: '该服务商设置为经代理访问，但本机未配置 OUTBOUND_PROXY_URL',
    })
    await assert.rejects(llmService.listProviderModelNames(credentials), isMissingProxy)
    assert.deepEqual(upstream.requests, [])
  })

  it('代理没在监听：文案带出代理的 协议://主机:端口，不含凭据，并在超时之内结束', async () => {
    const port = await findClosedPort()
    const llmService = createProxiedLlmService(`http://user:pass@127.0.0.1:${port}`)
    const credentials = { providerId: 'provider-1', baseUrl: `${upstream.origin}/v1`, apiKey: STORED_API_KEY, useProxy: true }
    const expected = `代理 http://127.0.0.1:${port} 连接失败（ECONNREFUSED），请确认代理已启动、端口正确`
    const startedAt = Date.now()

    const probe = await llmService.probeModel(credentials, 'fake-model')

    assert.deepEqual(probe, { ok: false, error: expected })
    await assert.rejects(async () => {
      for await (const _event of llmService.chatStream(credentials, [{ type: 'message', role: 'user', content: 'hi' }], {
        request: { model: 'fake-model', contextWindowTokens: 0, maxOutputTokens: 16, compat: familyCompatOf('other') },
      })) {
        // 连接阶段就失败
      }
    }, (error: unknown) => {
      assert.ok(error instanceof LlmProxyError, 'error instanceof LlmProxyError')
      assert.equal(error.message, expected)
      assert.doesNotMatch(error.message, /user:pass/)
      return true
    })
    assert.ok(Date.now() - startedAt < 30_000, 'Date.now() - startedAt < 30_000')
  })

  it('隧道建立后的失败只说明经过哪个代理与错误码，不带底层原文；localhost 双栈的 AggregateError 也认得出是代理连不上', async () => {
    const llmService = createProxiedLlmService('http://user:pass@localhost:7890')
    const credentials = { providerId: 'provider-1', baseUrl: 'https://upstream.example/v1', apiKey: STORED_API_KEY, useProxy: true }
    const failWith = (cause: Error) => {
      globalThis.fetch = (async () => {
        throw new TypeError('fetch failed', { cause })
      }) as typeof fetch
    }
    const originalFetch = globalThis.fetch

    try {
      failWith(Object.assign(new Error('Client network socket disconnected before secure TLS connection was established http://user:pass@localhost:7890 upstream.example'), { code: 'ECONNRESET' }))
      const midway = await llmService.probeModel(credentials, 'fake-model')
      assert.deepEqual(midway, { ok: false, error: '经代理 http://localhost:7890 访问服务商失败（ECONNRESET），请检查代理与服务商是否可达' })

      failWith(new AggregateError([
        Object.assign(new Error('connect ECONNREFUSED ::1:7890'), { code: 'ECONNREFUSED', port: 7890 }),
        Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:7890'), { code: 'ECONNREFUSED', port: 7890 }),
      ], 'all attempts failed'))
      assert.deepEqual(await llmService.probeModel(credentials, 'fake-model'), {
        ok: false,
        error: '代理 http://localhost:7890 连接失败（ECONNREFUSED），请确认代理已启动、端口正确',
      })
    }
    finally {
      globalThis.fetch = originalFetch
    }
  })

  it('代理地址带凭据时，状态接口只回 协议://主机:端口', () => {
    assert.deepEqual(createProxiedLlmService(`http://user:pass@127.0.0.1:7890`).getProxyStatus(), {
      configured: true,
      address: 'http://127.0.0.1:7890',
    })
    assert.deepEqual(createProxiedLlmService(null).getProxyStatus(), { configured: false, address: null })
  })
})

describe('AdminLlmService：使用代理的勾选', () => {
  const STORED_BASE_URL = 'https://stored.example/v1'
  const isProxyRejected = (error: unknown) => {
    assert.ok(error instanceof BadRequestException, 'error instanceof BadRequestException')
    assert.match(error.message, /本机未配置 OUTBOUND_PROXY_URL/)
    return true
  }

  it('本机没配代理时，新建与编辑提交 useProxy=true 都返回 400，不写库', async () => {
    const { service, provider, writes } = createService(STORED_BASE_URL)

    await assert.rejects(service.createProvider({
      family: 'openai',
      note: '国外',
      baseUrl: STORED_BASE_URL,
      apiKey: NEW_API_KEY,
      enabled: true,
      useProxy: true,
    }), isProxyRejected)
    await assert.rejects(service.updateProvider(provider.id, { useProxy: true }), isProxyRejected)
    assert.deepEqual(writes, [])
  })

  it('切换 useProxy 清掉该服务商下各模型的探活结论；没变时不清', async () => {
    const proxied = createProxiedLlmService('http://127.0.0.1:7890')
    const { service, provider, writes } = createService(STORED_BASE_URL, proxied)

    const updated = await service.updateProvider(provider.id, { useProxy: true })

    assert.equal(updated.useProxy, true)
    assert.deepEqual(writes.find(write => write.op === 'llmModel.updateMany')?.args, {
      where: { providerId: provider.id },
      data: { lastProbeOk: null, lastProbeError: null, lastProbedAt: null },
    })

    writes.length = 0
    await service.updateProvider(provider.id, { useProxy: false, note: '只改备注' })
    assert.equal(writes.some(write => write.op === 'llmModel.updateMany'), false)
  })

  it('探活写回的条件带上探活时的 useProxy：探活期间切换了勾选，旧结论不写回', async () => {
    const provider = { id: 'provider-1', family: 'openai', baseUrl: 'https://stored.example/v1', apiKeyEncrypted: 'x', enabled: false, useProxy: true } as LlmProvider
    const model = {
      id: 'model-1',
      wireName: 'gpt-test',
      reasoningEffort: null,
      maxOutputTokens: 16,
      lastProbedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      provider,
    } as unknown as LlmModel
    const updates: unknown[] = []
    const prisma = {
      llmModel: {
        findMany: async () => [model],
        updateMany: async (args: unknown) => {
          updates.push(args)
          return { count: 0 }
        },
      },
    } as unknown as PrismaService
    const service = new AdminLlmService(prisma, new LLMService(RUNTIME_CONFIG), new LlmModelConfigService(prisma, RUNTIME_CONFIG))

    await service.probeModels({ modelIds: ['model-1'] })

    const where = (updates[0] as { where: { provider: { is: Record<string, unknown> } } }).where
    assert.equal(where.provider.is.useProxy, true)
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
