import type { McpPluginInput } from '@agent/contracts'
import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import process from 'node:process'
import { Module } from '@nestjs/common'
import { APP_GUARD, NestFactory } from '@nestjs/core'
import { afterAll, beforeAll, describe, it, vi } from 'vitest'
import { createRuntimeHost } from '../agent-runtime/agent-runtime-host.js'
import { loadConversationHistory } from '../agent-runtime/context/conversation-history.js'
import { AuthGuard } from '../auth/auth.guard.js'
import { AuthService } from '../auth/auth.service.js'
import { registerAppGlobals } from '../common/bootstrap/register-app-globals.js'
import { ConversationsService } from '../conversations/conversations.service.js'
import { MessagesService } from '../conversations/messages.service.js'
import { PrismaService } from '../prisma/prisma.service.js'
import { ToolInvocationService } from '../tools/core/tool-invocation.service.js'
import { ToolRegistryService } from '../tools/core/tool-registry.service.js'
import { AdminMcpController, McpController } from './mcp.controller.js'
import { McpService } from './mcp.service.js'

const url = process.env.TEST_DATABASE_URL?.trim()
if (!url || url === process.env.DATABASE_URL?.trim())
  throw new Error('MCP 测试只允许独立 TEST_DATABASE_URL')
const { Pool } = createRequire(import.meta.url)('pg') as {
  Pool: new (options: { connectionString: string, max: number }) => {
    query: (sql: string) => Promise<unknown>
    end: () => Promise<void>
  }
}
function config(extra: Partial<McpPluginInput> = {}): McpPluginInput {
  return {
    name: '测试插件',
    description: '受控的 MCP HTTP 服务',
    url: 'https://mcp.example/mcp',
    authType: 'none',
    headerNames: [],
    ...extra,
  }
}
function deadline() {
  return {
    deadlineAt: Date.now() + 30_000,
    createTimeoutError: () => new Error('timeout'),
    signal: new AbortController().signal,
  }
}

describe('MCP：真实隔离 PostgreSQL + 实际 SDK / HTTP，模拟外部服务', { timeout: 60_000 }, () => {
  const schema = `mcp_test_${randomUUID().replaceAll('-', '')}`
  const pool = new Pool({ connectionString: url, max: 1 })
  let prisma: PrismaService
  let service: McpService
  let userId: string
  let other: string
  let admin: string
  let serverUrl: string
  const calls: Array<{ name: string, key?: string }> = []
  const codes = new Map<string, string>()
  let token = 'valid-token'
  let refreshes = 0
  let gate: Promise<void> | undefined
  let listStarted = false
  let businessFailure = false
  let dropResult = false
  let networkFailure = false
  let afterWrite: Promise<void> | undefined
  let writeStarted: (() => void) | undefined
  const server = createServer(async (req, res) => {
    let text = ''
    for await (const chunk of req) text += chunk
    const path = new URL(req.url!, 'http://test').pathname
    const json = (body: unknown, status = 200) => {
      res.writeHead(status, { 'content-type': 'application/json' })
      res.end(JSON.stringify(body))
    }
    if (path.startsWith('/.well-known/oauth-protected-resource') || path === '/resource') {
      json({
        resource: 'https://mcp.example/oauth',
        authorization_servers: ['https://login.example'],
        scopes_supported: ['read'],
      })
      return
    }
    if (path.startsWith('/.well-known/oauth-authorization-server')) {
      json({
        issuer: 'https://login.example',
        authorization_endpoint: 'https://login.example/authorize',
        token_endpoint: 'https://login.example/token',
        response_types_supported: ['code'],
        grant_types_supported: ['authorization_code', 'refresh_token'],
        code_challenge_methods_supported: ['S256'],
        token_endpoint_auth_methods_supported: ['none', 'client_secret_post'],
      })
      return
    }
    if (path === '/token') {
      const form = new URLSearchParams(text)
      if (form.get('grant_type') === 'refresh_token') {
        refreshes++
        if (gate)
          await gate
        token = `rotated-${refreshes}`
        json({
          access_token: token,
          token_type: 'Bearer',
          refresh_token: `refresh-${refreshes}`,
          expires_in: 3600,
          scope: 'read',
        })
        return
      }
      const code = form.get('code') ?? ''
      const expected = codes.get(code)
      codes.delete(code)
      if (
        !expected
        || createHash('sha256')
          .update(form.get('code_verifier') ?? '')
          .digest('base64url') !== expected
      ) {
        json({ error: 'invalid_grant' }, 400)
        return
      }
      json({
        access_token: token,
        token_type: 'Bearer',
        refresh_token: 'refresh-initial',
        expires_in: 3600,
        scope: 'read',
      })
      return
    }
    if (networkFailure) {
      json({ error: 'unavailable' }, 503)
      return
    }
    if (path === '/oauth' && req.headers.authorization !== `Bearer ${token}`) {
      res.writeHead(401, {
        'www-authenticate': 'Bearer resource_metadata="https://mcp.example/resource"',
        'content-type': 'application/json',
      })
      res.end('{}')
      return
    }
    if (path === '/key' && !['key-a', 'key-b'].includes(String(req.headers['x-key']))) {
      json({}, 401)
      return
    }
    if (req.method !== 'POST') {
      res.writeHead(405)
      res.end()
      return
    }
    const request = JSON.parse(text)
    const reply = (result: unknown) => json({ jsonrpc: '2.0', id: request.id, result })
    switch (request.method) {
      case 'server/discover':
        json({
          jsonrpc: '2.0',
          id: request.id,
          error: { code: -32601, message: 'legacy test service' },
        })
        return
      case 'initialize':
        reply({
          protocolVersion: '2025-11-25',
          capabilities: { tools: {} },
          serverInfo: { name: 'controlled-mcp', version: '1' },
        })
        return
      case 'notifications/initialized':
        res.writeHead(202)
        res.end()
        return
      case 'tools/list':
        listStarted = true
        if (gate)
          await gate
        reply({
          tools: [
            {
              name: 'write_record',
              description: '受控测试写工具',
              inputSchema: {
                type: 'object',
                properties: { value: { type: 'integer' } },
                required: ['value'],
                additionalProperties: false,
              },
            },
          ],
        })
        return
      case 'tools/call':
        calls.push({
          name: request.params.name,
          ...(req.headers['x-key'] ? { key: String(req.headers['x-key']) } : {}),
        })
        writeStarted?.()
        if (afterWrite)
          await afterWrite
        if (dropResult) {
          res.destroy()
          return
        }
        reply({
          content: [
            {
              type: 'text',
              text: businessFailure ? '业务拒绝' : `saved:${request.params.arguments.value}`,
            },
          ],
          ...(businessFailure ? { isError: true } : {}),
        })
        return
      default:
        res.writeHead(202)
        res.end()
    }
  })

  beforeAll(async () => {
    await pool.query(`CREATE SCHEMA "${schema}"`)
    await pool.query(`SET search_path TO "${schema}", public`)
    const directory = new URL('../../../../prisma/migrations/', import.meta.url)
    for (const entry of (await readdir(directory)).filter(name => name !== 'migration_lock.toml').sort()) {
      await pool.query(await readFile(new URL(`${entry}/migration.sql`, directory), 'utf8'))
    }
    const connection = new URL(url)
    connection.searchParams.set('schema', schema)
    connection.searchParams.set('application_name', schema)
    connection.searchParams.set('options', `-c search_path=${schema},public`)
    prisma = new PrismaService(connection.toString())
    await prisma.$connect()
    userId = (
      await prisma.user.create({
        data: { email: `${schema}@example.test`, mustChangePassword: false },
      })
    ).id
    other = (
      await prisma.user.create({
        data: {
          email: `${schema}-other@example.test`,
          mustChangePassword: false,
        },
      })
    ).id
    admin = (
      await prisma.user.create({
        data: {
          email: `${schema}-admin@example.test`,
          role: 'ADMIN',
          mustChangePassword: false,
        },
      })
    ).id
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    serverUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`
    service = new McpService(prisma)
    Object.defineProperty(service, 'fetch', {
      value: async (input: string | URL, init?: RequestInit) => {
        const u = new URL(String(input))
        assert.ok(['mcp.example', 'login.example'].includes(u.hostname))
        return fetch(`${serverUrl}${u.pathname}${u.search}`, init)
      },
    })
  })
  afterAll(async () => {
    await prisma?.$disconnect()
    await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
    await pool.end()
    server.closeAllConnections()
    await new Promise<void>(resolve => server.close(() => resolve()))
  })

  async function invoke(pluginId: string, value: unknown = 3, uid = userId) {
    const mcp = await service.snapshot(uid)
    const definition = mcp.snapshot.find(item => item.pluginId === pluginId)!
    return new ToolInvocationService(new ToolRegistryService()).invoke(
      {
        callId: randomUUID(),
        toolName: definition.name,
        rawArgumentsJson: JSON.stringify({ value }),
      },
      {
        signal: new AbortController().signal,
        databaseDeadline: deadline(),
        serperApiKey: { status: 'missing' },
        argumentsTruncated: false,
        mcpTools: mcp.tools,
      },
    )
  }

  it('常用系统插件独立上架，缺少静态 OAuth 应用时明确提示且不创建连接', async () => {
    const list = await service.list(userId)
    for (const id of ['gmail', 'github', 'cloudflare']) {
      const plugin = list.find(row => row.id === id)!
      assert.ok(plugin)
      assert.equal(plugin.connected, false)
      assert.equal(plugin.authType, 'oauth')
      assert.equal(!!plugin.setupMessage, id !== 'cloudflare')
    }
    for (const id of ['gmail', 'github']) {
      await assert.rejects(service.connect(userId, id), /需要先配置 OAuth 应用/)
      assert.equal(await prisma.mcpConnection.count({ where: { userId, pluginId: id } }), 0)
    }
    assert.equal((await service.detail(userId, 'google-developer-knowledge')).setupMessage, undefined)
  })

  it('插件选择同事务保存；首采样前失败仍回显，历史不丢身份，事务失败不留消息', async () => {
    const conversationId = (await prisma.conversation.create({ data: { userId, title: '插件选择测试' } })).id
    const selectedPlugins = [{ id: 'google-developer-knowledge', name: 'Google 开发文档' }]
    let rejectBind = false
    const host = createRuntimeHost({ userId, selectedPlugins } as Parameters<typeof createRuntimeHost>[0], {
      prisma,
      recorder: {},
      attachments: {
        bind: async () => {
          if (rejectBind)
            throw new Error('bind failed')
          return []
        },
        modelInput: async () => { throw new Error('before sampling failed') },
      },
    } as unknown as Parameters<typeof createRuntimeHost>[1])
    const question = await host.createUserMessage(conversationId, 'Firebase 如何登录？', [])
    await assert.rejects(host.loadUserMessage!(question), /before sampling failed/)
    assert.equal(await prisma.agentRun.count({ where: { userMessageId: question.id } }), 0)
    const messages = await new MessagesService(prisma, new ConversationsService(prisma)).listMessages(userId, conversationId)
    assert.deepEqual(messages[0]?.plugins, selectedPlugins)
    assert.equal(messages[0]?.content, 'Firebase 如何登录？')
    const deadline = { deadlineAt: Date.now() + 30_000, signal: new AbortController().signal, createTimeoutError: () => new Error('timeout') }
    const { history } = await loadConversationHistory(prisma, conversationId, undefined, deadline)
    assert.match(history.groups[0]!.question!.content, /Google 开发文档/)
    assert.match(history.groups[0]!.question!.content, /历史选择不代表当前授权/)
    rejectBind = true
    await assert.rejects(host.createUserMessage(conversationId, '不应落库', []), /bind failed/)
    assert.equal(await prisma.message.count({ where: { conversationId } }), 1)
  })

  it('私人创建/更新/删除隔离；系统目录可见但未自动连接', async () => {
    await assert.rejects(service.save(userId, config({ headers: { Authorization: 'test' } })), /仅密钥/)
    const personal = await service.save(userId, config())
    assert.equal(
      (await service.list(other)).some(p => p.id === personal.id),
      false,
    )
    await assert.rejects(service.detail(other, personal.id))
    await assert.rejects(service.save(other, config(), personal.id))
    await assert.rejects(service.remove(other, personal.id))
    const system = await service.save(admin, config(), undefined, true)
    assert.equal((await service.detail(userId, system.id)).connected, false)
    await assert.rejects(service.save(userId, config(), system.id))
    await service.remove(userId, personal.id)
    await service.remove(admin, system.id, true)
  })

  it('真正经工具入口执行，参数无效不执行，启停后旧快照不再授权', async () => {
    const plugin = await service.save(userId, config())
    await service.connect(userId, plugin.id)
    const count = calls.length
    assert.equal((await invoke(plugin.id, 'invalid')).result.ok, false)
    assert.equal(calls.length, count)
    assert.equal((await invoke(plugin.id)).result.ok, true)
    assert.equal(calls.length, count + 1)
    const snapshot = await service.snapshot(userId)
    const name = snapshot.snapshot.find(item => item.pluginId === plugin.id)!.name
    await service.setEnabled(userId, plugin.id, false)
    const result = await new ToolInvocationService(new ToolRegistryService()).invoke(
      { callId: 'late', toolName: name, rawArgumentsJson: '{"value":3}' },
      {
        signal: new AbortController().signal,
        databaseDeadline: deadline(),
        serperApiKey: { status: 'missing' },
        argumentsTruncated: false,
        mcpTools: snapshot.tools,
      },
    )
    assert.equal(result.result.ok, false)
    assert.equal(calls.length, count + 1)
    assert.equal((await service.detail(userId, plugin.id)).connected, true)
    await service.disconnect(userId, plugin.id)
    assert.equal((await service.detail(userId, plugin.id)).connected, false)
  })

  it('同一系统插件两个用户使用独立密钥，不回显明文', async () => {
    const plugin = await service.save(
      admin,
      config({
        authType: 'headers',
        headerNames: ['X-Key'],
        url: 'https://mcp.example/key',
      }),
      undefined,
      true,
    )
    await service.connect(userId, plugin.id, { 'X-Key': 'key-a' })
    await service.connect(other, plugin.id, { 'X-Key': 'key-b' })
    await invoke(plugin.id, 1)
    await invoke(plugin.id, 2, other)
    assert.deepEqual(
      calls.slice(-2).map(call => call.key),
      ['key-a', 'key-b'],
    )
    assert.ok(!JSON.stringify(await service.detail(userId, plugin.id)).includes('key-a'))
    const row = await prisma.mcpConnection.findUniqueOrThrow({
      where: { userId_pluginId: { userId, pluginId: plugin.id } },
    })
    assert.ok(row.credentials && !row.credentials.includes('key-a'))
    await service.toggleSystem(admin, plugin.id, false)
    assert.equal((await service.detail(userId, plugin.id)).available, false)
    assert.equal(
      (await service.snapshot(userId)).snapshot.some(item => item.pluginId === plugin.id),
      false,
    )
    await service.remove(admin, plugin.id, true)
  })

  it('修改服务身份清除旧应用密钥，普通名称修改保留凭据', async () => {
    const input = config({ authType: 'oauth', oauthClientId: 'old-client', oauthClientSecret: 'old-secret' })
    const plugin = await service.save(userId, input)
    const { oauthClientSecret: _secret, ...edit } = input
    assert.equal((await service.save(userId, { ...edit, name: '新名称' }, plugin.id)).hasClientSecret, true)
    assert.equal(
      (await service.save(userId, { ...edit, url: 'https://other.example/mcp' }, plugin.id)).hasClientSecret,
      false,
    )
    await service.remove(userId, plugin.id)
  })

  it('配置变更与连接初始化竞争时，不把旧界面的凭据发送给新服务', async () => {
    const plugin = await service.save(
      admin,
      config({ authType: 'headers', headerNames: ['X-Key'], url: 'https://mcp.example/key' }),
      undefined,
      true,
    )
    await pool.query('BEGIN')
    try {
      await pool.query(`SELECT id FROM "McpPlugin" WHERE id='${plugin.id}' FOR UPDATE`)
      await pool.query(
        `UPDATE "McpPlugin" SET url='https://mcp.example/changed', "updatedAt"="updatedAt" + interval '1 second' WHERE id='${plugin.id}'`,
      )
      const connect = service.connect(userId, plugin.id, { 'X-Key': 'key-a' }, false, plugin.configRevision)
      const rejected = assert.rejects(connect, /配置已变化/)
      await vi.waitFor(async () => {
        const [row] = await prisma.$queryRaw<
          Array<{ waiting: boolean }>
        >`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name=${schema} AND wait_event_type='Lock') AS waiting`
        assert.equal(row?.waiting, true)
      })
      await pool.query('COMMIT')
      await rejected
      assert.equal(await prisma.mcpConnection.count({ where: { pluginId: plugin.id } }), 0)
    }
    finally {
      await pool.query('ROLLBACK')
      await service.remove(admin, plugin.id, true)
    }
  })

  it('连接中断开后迟到工具目录不能重新启用', async () => {
    const plugin = await service.save(userId, config())
    let release!: () => void
    gate = new Promise<void>((resolve) => {
      release = resolve
    })
    listStarted = false
    const connect = service.connect(userId, plugin.id)
    const rejected = assert.rejects(connect)
    await vi.waitFor(() => assert.equal(listStarted, true))
    await service.disconnect(userId, plugin.id)
    release()
    gate = undefined
    await rejected
    const row = await prisma.mcpConnection.findUniqueOrThrow({
      where: { userId_pluginId: { userId, pluginId: plugin.id } },
    })
    assert.equal(row.enabled, false)
    assert.equal(row.credentials, null)
  })

  it('OAuth 实际 SDK 授权码/PKCE换令牌、回调隔离、防重放、刷新与断开', async () => {
    const plugin = await service.save(
      userId,
      config({
        authType: 'oauth',
        url: 'https://mcp.example/oauth',
        oauthClientId: 'pre-registered-client',
        oauthScopes: 'read',
      }),
    )
    const started = await service.connect(userId, plugin.id)
    assert.ok(started.authorizationUrl)
    const authorization = new URL(started.authorizationUrl)
    const code = randomUUID()
    codes.set(code, authorization.searchParams.get('code_challenge')!)
    const params = new URLSearchParams({
      state: authorization.searchParams.get('state')!,
      code,
      iss: 'https://login.example',
    })
    await assert.rejects(service.callback(other, params))
    await service.callback(userId, params)
    assert.equal((await service.detail(userId, plugin.id)).enabled, true)
    await assert.rejects(service.callback(userId, params))
    token = 'server-expired-old-token'
    const before = refreshes
    await Promise.all([service.snapshot(userId), service.snapshot(userId)])
    assert.equal(refreshes, before + 1)
    await service.disconnect(userId, plugin.id)
    assert.equal((await service.detail(userId, plugin.id)).connected, false)
    const next = await service.connect(userId, plugin.id)
    const nextUrl = new URL(next.authorizationUrl!)
    codes.set(code, nextUrl.searchParams.get('code_challenge')!)
    await service.disconnect(userId, plugin.id)
    await assert.rejects(
      service.callback(
        userId,
        new URLSearchParams({
          code,
          state: nextUrl.searchParams.get('state')!,
        }),
      ),
    )
  })

  it('刷新在途时断开，迟到的新令牌不得恢复凭据', async () => {
    const plugin = await service.save(
      userId,
      config({ authType: 'oauth', url: 'https://mcp.example/oauth', oauthClientId: 'client' }),
    )
    const started = new URL((await service.connect(userId, plugin.id)).authorizationUrl!)
    const code = randomUUID()
    codes.set(code, started.searchParams.get('code_challenge')!)
    await service.callback(userId, new URLSearchParams({ code, state: started.searchParams.get('state')! }))
    token = 'expired-for-race'
    const before = refreshes
    let release!: () => void
    gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const pending = assert.rejects(service.snapshot(userId))
    await vi.waitFor(() => assert.equal(refreshes, before + 1))
    await service.disconnect(userId, plugin.id)
    release()
    gate = undefined
    await pending
    const row = await prisma.mcpConnection.findUniqueOrThrow({
      where: { userId_pluginId: { userId, pluginId: plugin.id } },
    })
    assert.equal(row.credentials, null)
    assert.equal(row.enabled, false)
  })

  it('远端令牌已经旋转但数据库保存失败时要求重连，不继续使用旧授权', async () => {
    const plugin = await service.save(
      userId,
      config({ authType: 'oauth', url: 'https://mcp.example/oauth', oauthClientId: 'client' }),
    )
    const started = new URL((await service.connect(userId, plugin.id)).authorizationUrl!)
    const code = randomUUID()
    codes.set(code, started.searchParams.get('code_challenge')!)
    await service.callback(userId, new URLSearchParams({ code, state: started.searchParams.get('state')! }))
    token = 'expired-for-persistence'
    const before = refreshes
    const original = prisma.mcpConnection.updateMany.bind(prisma.mcpConnection)
    let failed = false
    const spy = vi.spyOn(prisma.mcpConnection, 'updateMany').mockImplementation((args) => {
      if (!failed && refreshes > before && args?.data.credentials) {
        failed = true
        throw new Error('injected database write failure')
      }
      return original(args)
    })
    try {
      await assert.rejects(service.snapshot(userId))
      assert.equal(failed, true)
      assert.equal((await service.detail(userId, plugin.id)).needsAuth, true)
    }
    finally {
      spy.mockRestore()
      await service.disconnect(userId, plugin.id)
    }
  })

  it('外层工具超时也保存远端写入结果未知的语义，不重新执行', async () => {
    const plugin = await service.save(userId, config())
    await service.connect(userId, plugin.id)
    const mcp = await service.snapshot(userId)
    const name = mcp.snapshot.find(item => item.pluginId === plugin.id)!.name
    const before = calls.length
    let release!: () => void
    afterWrite = new Promise<void>((resolve) => {
      release = resolve
    })
    const started = new Promise<void>((resolve) => {
      writeStarted = resolve
    })
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      const pending = new ToolInvocationService(new ToolRegistryService()).invoke(
        { callId: 'outer-timeout', toolName: name, rawArgumentsJson: '{"value":1}' },
        {
          signal: new AbortController().signal,
          databaseDeadline: { ...deadline(), deadlineAt: Date.now() + 60000 },
          argumentsTruncated: false,
          serperApiKey: { status: 'missing' },
          mcpTools: mcp.tools,
        },
      )
      await started
      await vi.advanceTimersByTimeAsync(30001)
      const result = await pending
      assert.equal(result.result.ok, false)
      assert.match(result.result.modelContent, /远端结果未知.*不要自动重复/)
      assert.match(result.observation.content, /远端结果未知/)
      assert.equal(calls.length, before + 1)
    }
    finally {
      vi.useRealTimers()
      release()
      afterWrite = undefined
      writeStarted = undefined
      await service.disconnect(userId, plugin.id)
    }
  })

  it('外部写入已执行但连接丢失时，不自动重新调用、不伪装回滚', async () => {
    const plugin = await service.save(userId, config())
    await service.connect(userId, plugin.id)
    const before = calls.length
    dropResult = true
    try {
      const result = await invoke(plugin.id)
      assert.equal(calls.length, before + 1)
      assert.equal(result.result.ok, false)
      assert.match(result.result.modelContent, /可能未知/)
    }
    finally {
      dropResult = false
      await service.disconnect(userId, plugin.id)
    }
  })

  it('业务错误保留语义，临时网络失败不删除认证', async () => {
    const plugin = await service.save(
      userId,
      config({
        url: 'https://mcp.example/key',
        authType: 'headers',
        headerNames: ['X-Key'],
        headers: { 'X-Key': 'key-a' },
      }),
    )
    await service.connect(userId, plugin.id)
    businessFailure = true
    try {
      const result = await invoke(plugin.id)
      assert.equal(result.result.ok, false)
      assert.match(result.result.modelContent, /业务拒绝/)
    }
    finally {
      businessFailure = false
    }
    networkFailure = true
    try {
      await assert.rejects(service.snapshot(userId))
    }
    finally {
      networkFailure = false
    }
    const detail = await service.detail(userId, plugin.id)
    assert.equal(detail.needsAuth, false)
    assert.equal(detail.connected, true)
    await service.disconnect(userId, plugin.id)
  })

  it('实际 Nest 路由鉴权、CSRF、DTO 和 JSON 上限，系统密钥不会广播', async () => {
    const tokens = [randomUUID(), randomUUID()]
    for (const [index, id] of [admin, userId].entries()) {
      await prisma.session.create({
        data: {
          userId: id,
          tokenHash: createHash('sha256').update(tokens[index]!).digest('hex'),
          expiresAt: new Date(Date.now() + 60_000),
        },
      })
    }
    @Module({
      controllers: [McpController, AdminMcpController],
      providers: [
        { provide: McpService, useValue: service },
        { provide: PrismaService, useValue: prisma },
        AuthService,
        { provide: APP_GUARD, useClass: AuthGuard },
      ],
    })
    class TestApp {}
    const app = await NestFactory.create(TestApp, { logger: false })
    registerAppGlobals(app)
    await app.listen(0, '127.0.0.1')
    const base = await app.getUrl()
    const request = (path: string, token?: string, body?: unknown, origin = 'http://localhost:5173') =>
      fetch(`${base}/api${path}`, {
        method: body ? 'POST' : 'GET',
        headers: {
          origin,
          'content-type': 'application/json',
          ...(token ? { cookie: `agent_session=${token}` } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      })
    try {
      assert.equal((await request('/mcp')).status, 401)
      assert.equal((await request('/admin/mcp', tokens[1])).status, 403)
      assert.equal((await request('/mcp', tokens[1], config(), 'https://evil.example')).status, 403)
      assert.equal(
        (
          await request('/mcp', tokens[1], {
            ...config(),
            authType: 'unsupported',
          })
        ).status,
        400,
      )
      assert.equal(
        (
          await request('/mcp', tokens[1], {
            ...config(),
            icon: 'x'.repeat(110_000),
          })
        ).status,
        413,
      )
      const personal = await service.save(userId, config())
      assert.equal((await request(`/mcp/${personal.id}/connect`, tokens[1], {})).status, 400)
      assert.equal((await request(`/mcp/${personal.id}/connect`, tokens[1], { configRevision: '' })).status, 400)
      assert.equal(
        (await request(`/mcp/${personal.id}/connect`, tokens[1], { configRevision: personal.configRevision })).status,
        201,
      )
      await service.remove(userId, personal.id)
      const response = await request(
        '/admin/mcp',
        tokens[0],
        config({
          authType: 'oauth',
          oauthClientId: 'client',
          oauthClientSecret: 'hidden-secret',
        }),
      )
      assert.equal(response.status, 201)
      const body = (await response.json()) as {
        data: { id: string, hasClientSecret: boolean }
      }
      assert.equal(body.data.hasClientSecret, true)
      assert.ok(!JSON.stringify(body).includes('hidden-secret'))
      await service.remove(admin, body.data.id, true)
    }
    finally {
      await app.close()
    }
  })
})
