import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { once } from 'node:events'
import { createServer } from 'node:http'
import { Readable } from 'node:stream'
import { AuthenticationError, RateLimitError, Sandbox, TemplateError } from 'e2b'
import { afterEach, beforeEach, it, vi } from 'vitest'
import { WorkspaceCloudService, WorkspaceCreatedError } from './workspace-cloud.service.js'
import { fileHash, WorkspaceOperationError } from './workspace-files.js'

const storage = vi.hoisted(() => ({ options: {} as Record<string, unknown>, query: vi.fn(), put: vi.fn(), getStream: vi.fn() }))
vi.mock('ali-oss', () => ({ default: class {
  constructor(options: Record<string, unknown>) { storage.options = options }
  getBucketStat() { return storage.query() }
  put(...args: unknown[]) { return storage.put(...args) }
  getStream(...args: unknown[]) { return storage.getStream(...args) }
} }))

beforeEach(() => {
  for (const name of ['E2B_API_KEY', 'E2B_TEMPLATE', 'OSS_ACCESS_KEY_ID', 'OSS_ACCESS_KEY_SECRET', 'OSS_BUCKET'])
    vi.stubEnv(name, 'test-only')
  vi.stubEnv('E2B_API_URL', 'https://api.test.invalid')
  vi.stubEnv('E2B_DOMAIN', 'test.invalid')
  vi.stubEnv('OSS_REGION', 'oss-cn-hongkong')
  vi.stubEnv('OUTBOUND_PROXY_URL', 'http://proxy.invalid:7890')
  storage.query.mockReset()
  storage.put.mockReset()
  storage.getStream.mockReset()
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  vi.useRealTimers()
})

it('OSS 查询不继承代理，并发请求复用缓存；失败保留最后有效快照，不泄露错误中的凭据', async () => {
  vi.useFakeTimers()
  const cloud = new WorkspaceCloudService()
  storage.query.mockResolvedValueOnce({ res: { status: 200 }, stat: { Storage: '345148', ObjectCount: '24', LastModifiedTime: '1790959200' } })
  const [first, same] = await Promise.all([cloud.inspectStorage(), cloud.inspectStorage()])
  assert.equal(storage.options.enableProxy, false)
  assert.equal(storage.options.proxy, undefined)
  assert.equal(storage.query.mock.calls.length, 1)
  assert.deepEqual(first, same)
  assert.equal(first.objectCount, 24)
  vi.advanceTimersByTime(3_600_001)
  storage.query.mockRejectedValueOnce(new Error('secret=SHOULD_NOT_LEAK'))
  const failed = await cloud.inspectStorage()
  assert.equal(failed.objectCount, 24)
  assert.equal(failed.measuredAt, first.measuredAt)
  assert.ok(failed.error)
  assert.equal(JSON.stringify(failed).includes('SHOULD_NOT_LEAK'), false)
})

it('OSS 首次失败与有效零用量区分；云端较旧的快照不覆盖新值', async () => {
  vi.useFakeTimers()
  const cloud = new WorkspaceCloudService()
  storage.query.mockRejectedValueOnce(new Error('unavailable'))
  assert.equal((await cloud.inspectStorage()).storageBytes, null)
  vi.advanceTimersByTime(30_001)
  storage.query.mockResolvedValueOnce({ stat: { Storage: '0', ObjectCount: '0', LastModifiedTime: '1790959200' } })
  assert.equal((await cloud.inspectStorage()).storageBytes, 0)
  vi.advanceTimersByTime(3_600_001)
  storage.query.mockResolvedValueOnce({ stat: { Storage: '100', ObjectCount: '5', LastModifiedTime: '1790950000' } })
  assert.equal((await cloud.inspectStorage()).storageBytes, 0)
})

it('OSS 空统计字段不能通过 Number 转成假零用量', async () => {
  for (const value of [null, '', false]) {
    storage.query.mockResolvedValueOnce({ stat: { Storage: value, ObjectCount: '0', LastModifiedTime: '1790959200' } })
    const result = await new WorkspaceCloudService().inspectStorage()
    assert.equal(result.storageBytes, null)
    assert.ok(result.error)
  }
})

it('停用沙箱后仍可读取已保存文件，缺少 OSS 配置也不阻断实例核查', async () => {
  vi.stubEnv('E2B_API_KEY', '')
  const content = Buffer.from('saved')
  storage.getStream.mockResolvedValueOnce({ stream: Readable.from([content]) })
  const cloud = new WorkspaceCloudService()
  assert.equal(cloud.configured, false)
  assert.deepEqual(await cloud.readFile({ path: 'a', key: '_checks/a', bytes: content.length, sha256: fileHash(content) }), content)
  vi.stubEnv('E2B_API_KEY', 'test-only')
  vi.stubEnv('OSS_ACCESS_KEY_SECRET', '')
  vi.spyOn(Sandbox, 'list').mockReturnValue({ hasNext: false } as ReturnType<typeof Sandbox.list>)
  assert.deepEqual((await cloud.inspectSandboxes()).instances, [])
  await assert.rejects(cloud.create('run', 60000), /尚未配置/)
})

it('云端实例查询失败不返回假空列表，已成功的列表仍保留并标记失败', async () => {
  vi.useFakeTimers()
  const cloud = new WorkspaceCloudService()
  vi.spyOn(Sandbox, 'list').mockImplementationOnce(() => {
    throw new Error('secret-token')
  })
  const failed = await cloud.inspectSandboxes()
  assert.equal(failed.instances, null)
  assert.ok(failed.error)
  vi.advanceTimersByTime(30_001)
  let hasNext = true
  vi.spyOn(Sandbox, 'list').mockReturnValueOnce({ get hasNext() {
    return hasNext
  }, nextItems: async () => {
    hasNext = false
    return [{ sandboxId: 's', state: 'running', metadata: { executionId: 'history' }, startedAt: new Date('2026-10-03T00:00:00Z'), endAt: new Date('2026-10-03T01:00:00Z') }]
  } } as unknown as ReturnType<typeof Sandbox.list>)
  const success = await cloud.inspectSandboxes()
  assert.equal(success.instances?.length, 1)
  vi.advanceTimersByTime(30_001)
  vi.spyOn(Sandbox, 'list').mockImplementationOnce(() => {
    throw new Error('unavailable')
  })
  const later = await cloud.inspectSandboxes()
  assert.equal(later.instances?.length, 1)
  assert.ok(later.error)
})

it('创建实例同时关闭出网与公开入站，不传入后端凭据作为沙箱环境', async () => {
  let body: Record<string, unknown> | undefined
  const server = createServer(async (request, response) => {
    let text = ''
    for await (const chunk of request)
      text += chunk
    body = JSON.parse(text)
    response.writeHead(201, { 'content-type': 'application/json' }).end(JSON.stringify({ sandboxID: 'test', envdVersion: '0.6.2', envdAccessToken: 'fixture-only', domain: 'test.invalid' }))
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  assert.ok(address && typeof address !== 'string')
  vi.stubEnv('E2B_API_URL', `http://127.0.0.1:${address.port}`)
  vi.stubEnv('OUTBOUND_PROXY_URL', '')
  try {
    const sandbox = await new WorkspaceCloudService().create('run', 60000, 'execution')
    assert.ok(sandbox instanceof Sandbox)
    assert.equal(sandbox.sandboxId, 'test')
    assert.equal(body!.allow_internet_access, false)
    assert.equal(body!.secure, true)
    assert.deepEqual(body!.network, { allowPublicTraffic: false })
    assert.equal(body!.envVars, undefined)
    assert.deepEqual(body!.metadata, { app: 'kuro', runId: 'run', executionId: 'execution' })
  }
  finally {
    server.closeAllConnections()
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  }
})

it('不可变对象冲突必须校验真实内容，不能把损坏对象当成保存成功', async () => {
  const content = Buffer.from('saved')
  const file = { path: 'a.txt', bytes: content.length, sha256: fileHash(content), key: '_checks/object' }
  const signal = new AbortController().signal
  const cloud = new WorkspaceCloudService()
  storage.put.mockRejectedValue({ code: 'FileAlreadyExists' })
  storage.getStream.mockResolvedValueOnce({ stream: Readable.from([content]) })
  await cloud.putFile(file, content, signal)
  assert.equal(storage.put.mock.calls[0]![2].headers['x-oss-forbid-overwrite'], 'true')
  storage.getStream.mockResolvedValueOnce({ stream: Readable.from([Buffer.from('wrong')]) })
  await assert.rejects(cloud.putFile(file, content, signal), /校验失败/)
})

it('R2：锁定 SDK 的 HTTP 拒绝没有 statusCode，适配器仅将创建阶段的 401/429 标为确定未创建', async () => {
  let status = 401
  let created = false
  const requests: string[] = []
  const server = createServer((request, response) => {
    requests.push(`${request.method} ${request.url}`)
    if (status === 0) {
      request.socket.destroy() // 服务可能已创建，但客户端没有收到响应。
      return
    }
    response.setHeader('content-type', 'application/json')
    if (created && request.method === 'POST') {
      response.writeHead(201).end(JSON.stringify({ sandboxID: 'created-before-check', envdVersion: '0.0.1' }))
      return
    }
    response.writeHead(status).end(JSON.stringify({ code: status, message: 'fixture rejection' }))
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  assert.ok(address && typeof address !== 'string')
  const apiUrl = `http://127.0.0.1:${address.port}`
  vi.stubEnv('E2B_API_URL', apiUrl)
  vi.stubEnv('OUTBOUND_PROXY_URL', '')
  const cloud = new WorkspaceCloudService()
  try {
    for (status of [401, 429]) {
      await assert.rejects(Sandbox.create('test', { apiUrl, apiKey: 'fixture', validateApiKey: false }), (error: unknown) => {
        assert.ok(status === 401 ? error instanceof AuthenticationError : error instanceof RateLimitError)
        assert.equal('statusCode' in (error as Error), false)
        return true
      })
      await assert.rejects(cloud.create('run', 60000), (error: unknown) => {
        assert.ok(error instanceof WorkspaceOperationError, `${(error as Error).name}: ${(error as Error).message}`)
        assert.equal(error.name, 'WorkspaceCreationRejectedError')
        return true
      })
    }
    for (status of [400, 403, 404, 500]) {
      await assert.rejects(cloud.create('run', 60000), (error: unknown) => {
        assert.notEqual((error as Error).name, 'WorkspaceCreationRejectedError')
        return true
      })
    }
    status = 0
    await assert.rejects(cloud.create('run', 60000), (error: unknown) => {
      assert.notEqual((error as Error).name, 'WorkspaceCreationRejectedError')
      return true
    })
    created = true
    for (status of [401, 429, 204]) {
      await assert.rejects(Sandbox.create('test', { apiUrl, apiKey: 'fixture', validateApiKey: false }), (error: unknown) => {
        assert.ok(status === 401 ? error instanceof AuthenticationError : status === 429 ? error instanceof RateLimitError : error instanceof TemplateError)
        return true
      })
      requests.length = 0
      await assert.rejects(cloud.create('run', 60000), (error: unknown) => {
        assert.ok(error instanceof WorkspaceCreatedError)
        assert.equal(error.sandbox.sandboxId, 'created-before-check')
        return true
      })
      assert.deepEqual(requests, ['POST /sandboxes', 'DELETE /sandboxes/created-before-check'])
    }
  }
  finally {
    server.closeAllConnections()
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  }
})

it('R2：E2B_DEBUG 不能让云实例的正常释放或创建后补偿跳过 DELETE', async () => {
  let version = '0.6.2'
  let deleteStatus = 204
  const requests: string[] = []
  const server = createServer((request, response) => {
    requests.push(`${request.method} ${request.url}`)
    response.setHeader('content-type', 'application/json')
    if (request.method === 'POST')
      response.writeHead(201).end(JSON.stringify({ sandboxID: 'cloud-not-debug', envdVersion: version }))
    else
      response.writeHead(deleteStatus).end(JSON.stringify({ code: deleteStatus, message: 'fixture deletion rejected' }))
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  assert.ok(address && typeof address !== 'string')
  vi.stubEnv('E2B_API_URL', `http://127.0.0.1:${address.port}`)
  vi.stubEnv('OUTBOUND_PROXY_URL', '')
  vi.stubEnv('E2B_DEBUG', 'true')
  try {
    const cloud = new WorkspaceCloudService()
    const sandbox = await cloud.create('run', 60000)
    assert.equal(await sandbox.kill(), true)
    assert.deepEqual(requests, ['POST /sandboxes', 'DELETE /sandboxes/cloud-not-debug'])
    requests.length = 0
    version = '0.0.1'
    deleteStatus = 429
    let created: WorkspaceCreatedError | undefined
    await assert.rejects(cloud.create('run', 60000), (error: unknown) => {
      assert.ok(error instanceof WorkspaceCreatedError)
      created = error
      return true
    })
    await assert.rejects(created!.sandbox.kill(), RateLimitError)
    assert.deepEqual(requests, ['POST /sandboxes', 'DELETE /sandboxes/cloud-not-debug', 'DELETE /sandboxes/cloud-not-debug'])
  }
  finally {
    server.closeAllConnections()
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  }
})

it('普通查询复用缓存，手动刷新重新核查云端', async () => {
  const list = vi.spyOn(Sandbox, 'list').mockReturnValue({ hasNext: false } as ReturnType<typeof Sandbox.list>)
  const cloud = new WorkspaceCloudService()
  await cloud.inspectSandboxes()
  await cloud.inspectSandboxes()
  assert.equal(list.mock.calls.length, 1)
  await cloud.inspectSandboxes(true)
  assert.equal(list.mock.calls.length, 2)
})
