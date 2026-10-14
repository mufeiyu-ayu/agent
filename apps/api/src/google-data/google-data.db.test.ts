import type { INestApplication } from '@nestjs/common'
import type { AuthContext } from '../auth/auth.decorators.js'
import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import process from 'node:process'
import { Module } from '@nestjs/common'
import { APP_GUARD, NestFactory } from '@nestjs/core'
import { afterAll, beforeAll, describe, it, vi } from 'vitest'
import { AuthGuard } from '../auth/auth.guard.js'
import { AuthService } from '../auth/auth.service.js'
import { registerAppGlobals } from '../common/bootstrap/register-app-globals.js'
import { createApiKeyCipher } from '../llm/api-key-cipher.js'
import { resolveLlmEnvConfig } from '../llm/llm-runtime-config.service.js'
import { PrismaService } from '../prisma/prisma.service.js'
import { GOOGLE_DATA_SCOPES, GoogleDataClient } from './google-data-client.js'
import { GoogleDataController } from './google-data.controller.js'
import { GoogleDataService } from './google-data.service.js'

const url = process.env.TEST_DATABASE_URL?.trim()
if (!url || url === process.env.DATABASE_URL?.trim())
  throw new Error('Google 数据测试只允许独立 TEST_DATABASE_URL')
const { Pool } = createRequire(import.meta.url)('pg') as { Pool: new (options: { connectionString: string, max: number }) => { query: (sql: string) => Promise<unknown>, end: () => Promise<void> } }
const WEB = 'http://localhost:5173'
const digest = (value: string) => createHash('sha256').update(value).digest('base64url')

describe('Google 数据：真实隔离库与受控 HTTP OAuth/API', { timeout: 60_000 }, () => {
  const schema = `google_data_${randomUUID().replaceAll('-', '')}`
  const pool = new Pool({ connectionString: url, max: 1 })
  let prisma: PrismaService
  let client: GoogleDataClient
  let service: GoogleDataService
  let auth: AuthContext
  let other: AuthContext
  let app: INestApplication
  let apiUrl: string
  let fakeUrl: string
  const codes = new Map<string, { challenge: string, scopes: string, sub: string }>()
  const identities = new Map<string, string>()
  const requests: Array<{ path: string, body: Record<string, unknown> }> = []
  let hold: { path: string, started: () => void, gate: Promise<void> } | undefined
  let apiStatus = 200
  let tokenFailure = false
  let malformed = false
  let refreshed = 0
  let noRefresh = false
  let paginate = false
  const server = createServer(async (req, res) => {
    let raw = ''
    for await (const chunk of req) raw += chunk
    const path = new URL(req.url!, 'http://fake').pathname
    const body = (req.headers['content-type'] === 'application/x-www-form-urlencoded' ? Object.fromEntries(new URLSearchParams(raw)) : raw ? JSON.parse(raw) : {}) as Record<string, unknown>
    requests.push({ path, body })
    if (hold?.path === path) {
      hold.started()
      await hold.gate
    }
    const reply = (value: unknown, status = 200) => {
      res.writeHead(status, { 'content-type': 'application/json' })
      res.end(JSON.stringify(value))
    }
    if (path === '/token') {
      if (body.grant_type === 'refresh_token') {
        refreshed++
        return reply(tokenFailure ? { error: 'invalid_grant' } : { access_token: 'refreshed', expires_in: 3600 }, tokenFailure ? 400 : 200)
      }
      const issued = codes.get(String(body.code))
      codes.delete(String(body.code))
      if (!issued || digest(String(body.code_verifier)) !== issued.challenge || body.redirect_uri !== service.callbackUrl || body.client_id !== 'data-client')
        return reply({ error: 'invalid_grant' }, 400)
      const access = `access-${randomUUID()}`
      identities.set(access, issued.sub)
      return reply({ access_token: access, ...(noRefresh ? {} : { refresh_token: 'secret-refresh' }), scope: issued.scopes, expires_in: 3600 })
    }
    if (path === '/v1/userinfo') {
      const sub = identities.get(String(req.headers.authorization).replace('Bearer ', ''))
      return reply({ sub, email: `${sub}@example.test`, email_verified: true })
    }
    if (apiStatus !== 200)
      return reply({ error: { message: 'upstream contains secret-refresh' } }, apiStatus)
    if (path.endsWith('/sites'))
      return reply({ siteEntry: [{ siteUrl: 'sc-domain:topuplist.com', permissionLevel: 'siteOwner' }, { siteUrl: 'sc-domain:unverified.test', permissionLevel: 'siteUnverifiedUser' }] })
    if (path.endsWith('/accountSummaries'))
      return reply({ accountSummaries: [{ propertySummaries: [{ property: 'properties/42', displayName: 'Topuplist' }] }], ...(paginate ? { nextPageToken: 'next' } : {}) })
    if (path.endsWith('/dataStreams'))
      return reply({ dataStreams: [{ name: 'properties/42/dataStreams/7', displayName: '生产流', type: 'WEB_DATA_STREAM', webStreamData: { defaultUri: 'https://topuplist.com' } }, { name: 'properties/42/dataStreams/9', displayName: '未填网址', type: 'WEB_DATA_STREAM', webStreamData: {} }, { name: 'properties/42/dataStreams/8', displayName: 'App', type: 'ANDROID_APP_DATA_STREAM' }] })
    return reply(malformed ? { rows: 'not-an-array' } : { rows: [] })
  })
  beforeAll(async () => {
    vi.stubEnv('GOOGLE_DATA_CLIENT_ID', 'data-client')
    vi.stubEnv('GOOGLE_DATA_CLIENT_SECRET', 'data-secret')
    vi.stubEnv('APP_ORIGINS', WEB)
    vi.stubEnv('OUTBOUND_PROXY_URL', '')
    await pool.query(`CREATE SCHEMA "${schema}"`)
    await pool.query(`SET search_path TO "${schema}", public`)
    const directory = new URL('../../../../prisma/migrations/', import.meta.url)
    for (const entry of (await readdir(directory)).filter(name => name !== 'migration_lock.toml').sort()) await pool.query(await readFile(new URL(`${entry}/migration.sql`, directory), 'utf8'))
    const connection = new URL(url)
    connection.searchParams.set('schema', schema)
    prisma = new PrismaService(connection.toString())
    await prisma.$connect()
    const users = await Promise.all(['owner', 'other'].map(name => prisma.user.create({ data: { email: `${name}@${schema}.test`, mustChangePassword: false } })))
    auth = { user: { ...users[0]!, status: 'active' } as unknown as AuthContext['user'], sessionId: 'session-a' }
    other = { user: { ...users[1]!, status: 'active' } as unknown as AuthContext['user'], sessionId: 'session-b' }
    client = new GoogleDataClient()
    service = new GoogleDataService(prisma, client)
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    fakeUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`
    Object.defineProperty(client, 'fetch', { value: async (input: string | URL, init: RequestInit) => {
      const target = new URL(input)
      return fetch(`${fakeUrl}${target.pathname}${target.search}`, { method: init.method!, headers: init.headers!, ...(init.body ? { body: init.body } : {}), signal: init.signal! })
    } })
    @Module({ controllers: [GoogleDataController], providers: [{ provide: GoogleDataService, useValue: service }, { provide: PrismaService, useValue: prisma }, AuthService, { provide: APP_GUARD, useClass: AuthGuard }] })
    class TestModule {}
    app = await NestFactory.create(TestModule, { logger: false, bodyParser: false })
    registerAppGlobals(app)
    await app.listen(0, '127.0.0.1')
    apiUrl = await app.getUrl()
  })
  afterAll(async () => {
    await app?.close()
    await prisma?.$disconnect()
    await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
    await pool.end()
    server.closeAllConnections()
    await new Promise<void>(resolve => server.close(() => resolve()))
    vi.unstubAllEnvs()
  })
  async function begin(scopes = `${GOOGLE_DATA_SCOPES.gsc} ${GOOGLE_DATA_SCOPES.ga4}`, sub = 'google-owner') {
    const result = await service.start(auth, ['gsc', 'ga4'])
    const params = new URL(result.authorizationUrl).searchParams
    assert.equal(params.get('code_challenge_method'), 'S256')
    assert.equal(params.get('access_type'), 'offline')
    assert.equal(params.get('redirect_uri'), `${WEB}/api/google-data/oauth/callback`)
    assert.ok(!result.authorizationUrl.includes('data-secret'))
    const code = randomUUID()
    codes.set(code, { challenge: params.get('code_challenge')!, scopes, sub })
    return { state: params.get('state')!, code }
  }
  async function connect(scopes?: string) {
    await service.callback(auth, await begin(scopes))
    return service.detail(auth.user.id)
  }
  async function expire() {
    const row = await prisma.googleDataConnection.findUniqueOrThrow({ where: { userId: auth.user.id } })
    const cipher = createApiKeyCipher(resolveLlmEnvConfig(process.env).secretKey)
    const value = JSON.parse(cipher.decrypt(row.credentials!))
    value.expires = 0
    await prisma.googleDataConnection.update({ where: { userId: row.userId }, data: { credentials: cipher.encrypt(JSON.stringify(value)) } })
  }
  function barrier(path: string) {
    let release!: () => void
    let started!: () => void
    const began = new Promise<void>((resolve) => {
      started = resolve
    })
    hold = { path, started, gate: new Promise<void>((resolve) => {
      release = resolve
    }) }
    return { began, release: () => {
      hold = undefined
      release()
    } }
  }

  it('授权只绑定发起用户/会话；state 一次性；用户身份不被 Google 数据账号替换', async () => {
    const query = await begin()
    await assert.rejects(service.callback(other, query), /authorizationFailed/)
    await assert.rejects(service.callback({ ...auth, sessionId: 'another-session' }, query), /authorizationFailed/)
    await service.callback(auth, query)
    await assert.rejects(service.callback(auth, query), /authorizationFailed/)
    const view = await service.detail(auth.user.id)
    assert.equal(view.email, 'google-owner@example.test')
    assert.equal((await service.detail(other.user.id)).connected, false)
    assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: auth.user.id } })).googleSub, null)
    const row = await prisma.googleDataConnection.findUniqueOrThrow({ where: { userId: auth.user.id } })
    assert.ok(row.credentials?.startsWith('v1:'))
    assert.ok(!row.credentials?.includes('secret-refresh'))
    assert.ok(!JSON.stringify(view).includes('secret-refresh'))
  })
  it('过期/拒绝与篡改 state 不绑定；配置缺失不开始授权', async () => {
    const query = await begin()
    await assert.rejects(service.callback(auth, { ...query, state: 'wrong' }), /authorizationFailed/)
    await prisma.googleDataConnection.update({ where: { userId: auth.user.id }, data: { authExpiresAt: new Date(0) } })
    await assert.rejects(service.callback(auth, query), /authorizationFailed/)
    const refused = await begin()
    await assert.rejects(service.callback(auth, { state: refused.state, error: 'access_denied' }), /authorizationFailed/)
    assert.equal((await service.detail(auth.user.id)).authorizing, false)
    vi.stubEnv('GOOGLE_DATA_CLIENT_ID', '')
    const unconfigured = new GoogleDataService(prisma, new GoogleDataClient())
    await assert.rejects(unconfigured.start(auth, ['gsc']), /notConfigured/)
    vi.stubEnv('GOOGLE_DATA_CLIENT_ID', 'data-client')
  })
  it('部分授权只开放实际服务；换账号不能继承旧 refresh token 或资源', async () => {
    await connect(GOOGLE_DATA_SCOPES.gsc)
    assert.deepEqual((await service.detail(auth.user.id)).services, ['gsc'])
    await assert.rejects(service.resources(auth.user.id, 'ga4'), /missingScope/)
    noRefresh = true
    try {
      await assert.rejects(service.callback(auth, await begin(GOOGLE_DATA_SCOPES.gsc, 'different')), /invalidResponse/)
    }
    finally { noRefresh = false }
    assert.equal((await service.detail(auth.user.id)).email, 'google-owner@example.test')
  })
  it('资源与生产流经服务端校验；验证用选中资源；无数据不解释为 0', async () => {
    let view = await connect()
    assert.deepEqual(await service.resources(auth.user.id, 'gsc'), [{ id: 'sc-domain:topuplist.com', name: 'sc-domain:topuplist.com' }])
    await assert.rejects(service.select(auth.user.id, 'gsc', view.revision, 'sc-domain:other.test'), /invalidResource/)
    view = await service.select(auth.user.id, 'gsc', view.revision, 'sc-domain:topuplist.com')
    await assert.rejects(service.select(auth.user.id, 'ga4', view.revision, 'properties/42', 'properties/42/dataStreams/8'), /invalidResource/)
    view = await service.select(auth.user.id, 'ga4', view.revision, 'properties/42', 'properties/42/dataStreams/7')
    await assert.rejects(service.verify(auth.user.id, 'gsc', view.revision - 1), /connectionChanged/)
    const streams = await service.resources(auth.user.id, 'ga4', 'properties/42')
    assert.ok(streams.some(item => item.id === 'properties/42/dataStreams/9' && item.url === undefined))
    assert.equal((await service.verify(auth.user.id, 'gsc', (await service.detail(auth.user.id)).revision)).hasData, false)
    assert.equal((await service.verify(auth.user.id, 'ga4', (await service.detail(auth.user.id)).revision)).hasData, false)
    const report = [...requests].reverse().find(item => item.path.endsWith(':runReport'))!
    assert.equal(report.path, '/v1beta/properties/42:runReport')
    assert.deepEqual(report.body.dimensionFilter, { filter: { fieldName: 'streamId', stringFilter: { matchType: 'EXACT', value: '7' } } })
    await assert.rejects(service.resources(other.user.id, 'gsc'), /needsAuth/)
    malformed = true
    try {
      await assert.rejects(service.verify(auth.user.id, 'gsc', (await service.detail(auth.user.id)).revision), /invalidResponse/)
    }
    finally { malformed = false }
  })
  it('403/429/5xx 不泄漏原始响应、不误报成功；分页超过上限明确失败', async () => {
    for (const [code, reason] of [[403, 'permissionDenied'], [429, 'quotaExceeded'], [503, 'upstreamFailed']] as const) {
      apiStatus = code
      await assert.rejects(service.verify(auth.user.id, 'gsc', (await service.detail(auth.user.id)).revision), new RegExp(`^GoogleDataError: ${reason}$`))
    }
    apiStatus = 200
    paginate = true
    try {
      await assert.rejects(service.resources(auth.user.id, 'ga4'), /tooManyResources/)
    }
    finally { paginate = false }
  })
  it('并发刷新只交换一次；invalid_grant 与 401 标记需重连', async () => {
    await expire()
    const before = refreshed
    await Promise.all([service.resources(auth.user.id, 'gsc'), service.resources(auth.user.id, 'gsc')])
    assert.equal(refreshed, before + 1)
    await expire()
    tokenFailure = true
    try {
      await assert.rejects(service.resources(auth.user.id, 'gsc'), /needsAuth/)
    }
    finally { tokenFailure = false }
    assert.equal((await service.detail(auth.user.id)).needsAuth, true)
    await connect()
    apiStatus = 401
    try {
      await assert.rejects(service.resources(auth.user.id, 'gsc'), /needsAuth/)
    }
    finally { apiStatus = 200 }
    assert.equal((await service.detail(auth.user.id)).needsAuth, true)
  })
  it('断开期间迟到 OAuth / refresh / 资源保存不能复活连接', async () => {
    let query = await begin()
    let gate = barrier('/token')
    const operation = service.callback(auth, query)
    let rejected = assert.rejects(operation, /connectionChanged/)
    await gate.began
    await service.disconnect(auth.user.id)
    gate.release()
    await rejected
    assert.equal((await service.detail(auth.user.id)).connected, false)
    await connect()
    await expire()
    gate = barrier('/token')
    const refreshing = service.resources(auth.user.id, 'gsc')
    rejected = assert.rejects(refreshing, /connectionChanged/)
    await gate.began
    await service.disconnect(auth.user.id)
    gate.release()
    await rejected
    let view = await connect()
    gate = barrier('/webmasters/v3/sites')
    const saving = service.select(auth.user.id, 'gsc', view.revision, 'sc-domain:topuplist.com')
    rejected = assert.rejects(saving, /connectionChanged/)
    await gate.began
    await service.disconnect(auth.user.id)
    gate.release()
    await rejected
    view = await service.detail(auth.user.id)
    assert.equal(view.connected, false)
    assert.equal(view.selection.gscSite, null)
    query = await begin()
    await service.cancel(auth.user.id)
    await assert.rejects(service.callback(auth, query), /authorizationFailed/)
  })
  it('新授权不会被旧回调覆盖', async () => {
    const old = await begin()
    const gate = barrier('/token')
    const rejected = assert.rejects(service.callback(auth, old), /connectionChanged/)
    await gate.began
    const newer = await begin(GOOGLE_DATA_SCOPES.ga4, 'new-owner')
    gate.release()
    await rejected
    await service.callback(auth, newer)
    assert.equal((await service.detail(auth.user.id)).email, 'new-owner@example.test')
    assert.deepEqual((await service.detail(auth.user.id)).services, ['ga4'])
  })
  it('刷新后数据库写入失败要求重连；旧令牌失败不覆盖新凭据', async () => {
    await connect()
    await expire()
    const original = prisma.googleDataConnection.updateMany.bind(prisma.googleDataConnection)
    let fail = true
    const spy = vi.spyOn(prisma.googleDataConnection, 'updateMany').mockImplementation((args) => {
      if (fail && args?.data.credentials) {
        fail = false
        throw new Error('injected storage failure')
      }
      return original(args)
    })
    try {
      await assert.rejects(service.resources(auth.user.id, 'gsc'), /injected storage failure/)
      assert.equal((await service.detail(auth.user.id)).needsAuth, true)
    }
    finally { spy.mockRestore() }
    await connect()
    const gate = barrier('/webmasters/v3/sites')
    const old = service.resources(auth.user.id, 'gsc')
    const rejected = assert.rejects(old, /needsAuth/)
    await gate.began
    await expire()
    await service.resources(auth.user.id, 'ga4')
    apiStatus = 401
    gate.release()
    await rejected
    apiStatus = 200
    assert.equal((await service.detail(auth.user.id)).needsAuth, false)
  })
  it('HTTP 入口沿用鉴权与全局 DTO 校验', async () => {
    assert.equal((await fetch(`${apiUrl}/api/google-data`)).status, 401)
    const authService = app.get(AuthService)
    const user = await prisma.user.findUniqueOrThrow({ where: { id: auth.user.id } })
    const session = await authService.createSession(user.id, { resetPasswordLock: false })
    const headers = { 'origin': WEB, 'cookie': `agent_session=${session!.token}`, 'content-type': 'application/json' }
    const response = await fetch(`${apiUrl}/api/google-data/connect`, { method: 'POST', headers, body: JSON.stringify({ services: ['gsc'], userId: other.user.id }) })
    assert.equal(response.status, 400)
    assert.equal((await fetch(`${apiUrl}/api/google-data/connect`, { method: 'POST', headers, body: JSON.stringify({ services: [] }) })).status, 400)
    assert.equal((await fetch(`${apiUrl}/api/google-data/disconnect`, { method: 'POST', headers: { ...headers, origin: 'https://evil.test' }, body: '{}' })).status, 403)
  })
})
