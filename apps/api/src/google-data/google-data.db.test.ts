import type { ModelInputItem, ModelStreamEvent } from '@agent/ai'
import type { INestApplication } from '@nestjs/common'
import type { AuthContext } from '../auth/auth.decorators.js'
import type { LLMService } from '../llm/llm.service.js'
import type { GoogleQueryRun } from './google-query.service.js'
import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import process from 'node:process'
import { Module } from '@nestjs/common'
import { APP_GUARD, NestFactory } from '@nestjs/core'
import { afterAll, beforeAll, describe, it, vi } from 'vitest'
import { AgentRuntimeService } from '../agent-runtime/agent-runtime.service.js'
import { ContextCompactionService } from '../agent-runtime/context/context-compaction.service.js'
import { AgentRunRecorderService } from '../agent-runtime/lifecycle/agent-run-recorder.service.js'
import { AuthGuard } from '../auth/auth.guard.js'
import { AuthService } from '../auth/auth.service.js'
import { registerAppGlobals } from '../common/bootstrap/register-app-globals.js'
import { createResolvedLlmModel } from '../llm/__fixtures__.js'
import { createApiKeyCipher } from '../llm/api-key-cipher.js'
import { resolveLlmEnvConfig } from '../llm/llm-runtime-config.service.js'
import { PrismaService } from '../prisma/prisma.service.js'
import { createRuntimeConfigSnapshot } from '../runtime-config/__fixtures__.js'
import { ToolInvocationService } from '../tools/core/tool-invocation.service.js'
import { ToolRegistryService } from '../tools/core/tool-registry.service.js'
import { ga4MetadataDefinition, Ga4MetadataTool, ga4QueryDefinition, Ga4QueryTool, gscInspectDefinition, GscInspectTool, gscQueryDefinition, GscQueryTool } from '../tools/google/google-query-tools.js'
import { GOOGLE_DATA_SCOPES, GoogleDataClient } from './google-data-client.js'
import { GoogleDataController } from './google-data.controller.js'
import { GoogleDataService } from './google-data.service.js'
import { GoogleQueryService } from './google-query.service.js'
import { GscInspectionService } from './gsc-inspection.service.js'

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
  let queryRows = false
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
    if (path.endsWith('/urlInspection/index:inspect'))
      return reply(malformed ? { inspectionResult: {} } : { inspectionResult: { indexStatusResult: { verdict: 'PASS', googleCanonical: body.inspectionUrl, coverageState: 'Submitted and indexed', lastCrawlTime: '2026-10-12T00:00:00Z' } } })
    if (path.endsWith('/sites'))
      return reply({ siteEntry: [{ siteUrl: 'sc-domain:topuplist.com', permissionLevel: 'siteOwner' }, { siteUrl: 'sc-domain:unverified.test', permissionLevel: 'siteUnverifiedUser' }] })
    if (path.endsWith('/accountSummaries'))
      return reply({ accountSummaries: [{ propertySummaries: [{ property: 'properties/42', displayName: 'Topuplist' }] }], ...(paginate ? { nextPageToken: 'next' } : {}) })
    if (path.endsWith('/dataStreams'))
      return reply({ dataStreams: [{ name: 'properties/42/dataStreams/7', displayName: '生产流', type: 'WEB_DATA_STREAM', webStreamData: { defaultUri: 'https://topuplist.com' } }, { name: 'properties/42/dataStreams/9', displayName: '未填网址', type: 'WEB_DATA_STREAM', webStreamData: {} }, { name: 'properties/42/dataStreams/8', displayName: 'App', type: 'ANDROID_APP_DATA_STREAM' }] })
    if (path.endsWith('/metadata')) {
      return reply({
        dimensions: [{ apiName: 'date', uiName: 'Date' }, { apiName: 'streamId' }, { apiName: 'country' }, { apiName: 'customEvent:payment_method', uiName: 'Payment method', customDefinition: true }],
        metrics: [{ apiName: 'sessions', type: 'TYPE_INTEGER' }, { apiName: 'totalUsers', type: 'TYPE_INTEGER' }],
      })
    }
    if (path.endsWith(':runReport') && Array.isArray(body.dimensions)) {
      const dims = [...body.dimensions as Array<{ name: string }>, ...((body.dateRanges as unknown[]).length > 1 ? [{ name: 'dateRange' }] : [])]
      const metrics = body.metrics as Array<{ name: string }>
      return reply({ dimensionHeaders: dims, metricHeaders: metrics.map(metric => ({ ...metric, type: 'TYPE_INTEGER' })), rows: queryRows ? [{ dimensionValues: dims.map(dim => ({ value: dim.name === 'dateRange' ? 'date_range_0' : 'value' })), metricValues: metrics.map(() => ({ value: '7' })) }] : [], rowCount: queryRows ? 1 : 0, metadata: { timeZone: 'Asia/Shanghai', currencyCode: 'USD', subjectToThresholding: true }, propertyQuota: { tokensPerDay: { remaining: 100 } } })
    }
    return reply(malformed ? { rows: 'not-an-array' } : { rows: queryRows ? [{ keys: (body.dimensions as string[] ?? []).map(() => 'value'), clicks: 2, impressions: 4, ctr: 0.5, position: 3 }] : [], responseAggregationType: 'byProperty', metadata: { first_incomplete_date: '2026-10-07' } })
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
    connection.searchParams.set('options', `-c search_path=${schema},public`)
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
  async function queryHarness() {
    let view = await connect()
    view = await service.select(auth.user.id, 'gsc', view.revision, 'sc-domain:topuplist.com')
    await service.select(auth.user.id, 'ga4', view.revision, 'properties/42', 'properties/42/dataStreams/7')
    const queries = new GoogleQueryService(service)
    const registry = new ToolRegistryService()
    registry.register({ definition: gscQueryDefinition, executor: new GscQueryTool(queries) })
    registry.register({ definition: ga4MetadataDefinition, executor: new Ga4MetadataTool(queries) })
    registry.register({ definition: ga4QueryDefinition, executor: new Ga4QueryTool(queries) })
    registry.register({ definition: gscInspectDefinition, executor: new GscInspectTool(new GscInspectionService(service, prisma)) })
    return new ToolInvocationService(registry)
  }
  function invoke(tools: ToolInvocationService, toolName: string, input: unknown, run: GoogleQueryRun, signal = new AbortController().signal) {
    return tools.invoke({ toolName, callId: randomUUID(), rawArgumentsJson: JSON.stringify(input) }, {
      googleData: run,
      argumentsTruncated: false,
      signal,
      serperApiKey: { status: 'missing' },
      databaseDeadline: { deadlineAt: Date.now() + 30_000, signal, createTimeoutError: () => new Error('deadline') },
    })
  }
  const range = { startDate: '2026-10-01', endDate: '2026-10-07' }
  it('三个查询工具实际协议、metadata复用和强制stream AND，不允许模型覆盖身份', async () => {
    const tools = await queryHarness()
    const run = { userId: auth.user.id }
    queryRows = true
    try {
      const gsc = await invoke(tools, 'gsc_query', { ...range, dimensions: ['date'], dimensionFilterGroups: [{ groupType: 'and', filters: [{ dimension: 'query', operator: 'excludingRegex', expression: 'brand' }] }] }, run)
      assert.equal(gsc.result.ok, true)
      assert.equal(JSON.parse(gsc.result.modelContent).rows[0].clicks, 2)
      const metadata = await invoke(tools, 'ga4_metadata', { search: 'payment' }, run)
      assert.equal(JSON.parse(metadata.result.modelContent).fields[0].apiName, 'customEvent:payment_method')
      const input = { dateRanges: [range, { startDate: '2026-09-01', endDate: '2026-09-07' }], dimensions: ['date'], metrics: ['sessions'], dimensionFilter: { orGroup: { expressions: [{ filter: { fieldName: 'streamId', stringFilter: { matchType: 'EXACT', value: 'evil-stream' } } }] } }, metricFilter: { filter: { fieldName: 'sessions', numericFilter: { operation: 'GREATER_THAN', value: { doubleValue: 0 } } } }, orderBys: [{ metric: { metricName: 'sessions' }, desc: true }], currencyCode: 'USD' }
      const before = requests.filter(call => call.path.endsWith('/metadata')).length
      const ga4 = await invoke(tools, 'ga4_query', input, run)
      assert.equal(ga4.result.ok, true)
      const output = JSON.parse(ga4.result.modelContent)
      assert.equal(output.rows[0].metricValues[0].value, '7')
      assert.equal(output.metadata.subjectToThresholding, true)
      assert.equal(requests.filter(call => call.path.endsWith('/metadata')).length, before)
      const request = [...requests].reverse().find(call => call.path.endsWith(':runReport'))!
      assert.deepEqual((request.body.dimensionFilter as { andGroup: { expressions: unknown[] } }).andGroup.expressions[0], { filter: { fieldName: 'streamId', stringFilter: { matchType: 'EXACT', value: '7' } } })
      assert.equal(request.body.returnPropertyQuota, true)
      assert.equal(request.body.limit, '100')
      const bad = await invoke(tools, 'ga4_query', { ...input, userId: other.user.id }, run)
      assert.equal(bad.result.ok, false)
      assert.equal(bad.argumentsValidated, false)
      const isolated = await invoke(tools, 'ga4_query', { dateRanges: [range], metrics: ['sessions'] }, { userId: other.user.id })
      assert.equal(isolated.result.ok, false)
      assert.ok(!isolated.result.modelContent.includes('secret-refresh'))
      const unknown = await invoke(tools, 'ga4_query', { dateRanges: [range], metrics: ['inventedMetric'] }, run)
      assert.match(unknown.result.modelContent, /ga4_metadata/)
    }
    finally { queryRows = false }
  })
  it('同 Run 的连接变化、断开与迟到Google响应不能跨资源回传', async () => {
    const tools = await queryHarness()
    const run = { userId: auth.user.id }
    assert.equal((await invoke(tools, 'ga4_metadata', {}, run)).result.ok, true)
    const view = await service.detail(auth.user.id)
    await service.select(auth.user.id, 'gsc', view.revision, 'sc-domain:topuplist.com')
    const changed = await invoke(tools, 'ga4_query', { dateRanges: [range], metrics: ['sessions'] }, run)
    assert.equal(changed.result.ok, false)
    assert.match(changed.result.modelContent, /已改变/)
    const gate = barrier('/webmasters/v3/sites/sc-domain%3Atopuplist.com/searchAnalytics/query')
    const late = invoke(tools, 'gsc_query', range, { userId: auth.user.id })
    await gate.began
    await service.disconnect(auth.user.id)
    gate.release()
    assert.equal((await late).result.ok, false)
  })
  it('Google错误、取消与小时窗口不能伪装成无数据', async () => {
    const tools = await queryHarness()
    const outside = await invoke(tools, 'gsc_query', { ...range, dimensionFilterGroups: [{ groupType: 'and', filters: [{ dimension: 'page', operator: 'equals', expression: 'https://other.test/blogs/detail/example' }] }] }, { userId: auth.user.id })
    assert.equal(outside.result.ok, false)
    assert.match(outside.result.modelContent, /站点范围/)
    for (const status of [400, 403, 429, 503]) {
      apiStatus = status
      const output = await invoke(tools, 'gsc_query', range, { userId: auth.user.id })
      assert.equal(output.result.ok, false)
      assert.ok(!output.result.modelContent.includes('secret-refresh'))
    }
    apiStatus = 200
    const window = await invoke(tools, 'gsc_query', { startDate: '2020-01-01', endDate: '2020-01-02', dimensions: ['hour'], dataState: 'hourly_all' }, { userId: auth.user.id })
    assert.equal(window.result.ok, false)
    const controller = new AbortController()
    const gate = barrier('/webmasters/v3/sites/sc-domain%3Atopuplist.com/searchAnalytics/query')
    const pending = invoke(tools, 'gsc_query', range, { userId: auth.user.id }, controller.signal)
    const rejected = assert.rejects(pending, /stop/)
    await gate.began
    controller.abort(new Error('stop'))
    gate.release()
    await rejected
  })
  it('真实宿主透传个人上下文，工具结果落库且成为下一轮模型输入；无连接普通聊天正常', async () => {
    const tools = await queryHarness()
    const model = createResolvedLlmModel()
    const recorder = new AgentRunRecorderService(prisma)
    const wire: ModelInputItem[][] = []
    const llm = { async* chatStream(_provider: unknown, input: ModelInputItem[]): AsyncGenerator<ModelStreamEvent> {
      wire.push(structuredClone(input))
      if (wire.length === 1) {
        yield { type: 'tool_call_completed', reasoningContent: '', toolCall: { providerCallId: 'google-call', name: 'gsc_query', argumentsJson: JSON.stringify(range), index: 0 } }
        yield { type: 'response_completed', finishReason: 'tool_calls' }
      }
      else {
        yield { type: 'text_delta', delta: '已查询。' }
        yield { type: 'response_completed', finishReason: 'stop' }
      }
    } } as unknown as LLMService
    const runtime = new AgentRuntimeService(llm, prisma, recorder, tools, new ContextCompactionService(llm, prisma, recorder))
    const conversation = await prisma.conversation.create({ data: { userId: auth.user.id, title: 'query protocol test' } })
    const events = []
    for await (const event of runtime.runTurnStream({ userId: auth.user.id, conversationId: conversation.id, userContent: '查询搜索表现', model, runtimeConfig: createRuntimeConfigSnapshot(), instructions: [] })) events.push(event)
    assert.equal(events[events.length - 1]?.type, 'run_completed')
    const run = await prisma.agentRun.findFirstOrThrow({ where: { conversationId: conversation.id } })
    const step = await prisma.agentStep.findFirstOrThrow({ where: { runId: run.id, type: 'tool_execution' } })
    const output = step.output as { observation: string, ok: boolean }
    assert.equal(output.ok, true)
    assert.equal(JSON.parse(output.observation).source.siteUrl, 'sc-domain:topuplist.com')
    assert.ok(wire[1]!.some(item => item.type === 'tool_result' && item.content === output.observation))
    assert.ok(!JSON.stringify(step).includes('secret-refresh'))
    const otherConversation = await prisma.conversation.create({ data: { userId: other.user.id, title: 'normal chat' } })
    const normal = []
    for await (const event of runtime.runTurnStream({ userId: other.user.id, conversationId: otherConversation.id, userContent: '你好', model, runtimeConfig: createRuntimeConfigSnapshot(), instructions: [] })) normal.push(event)
    assert.equal(normal[normal.length - 1]?.type, 'run_completed')
  })
  it('收录经实际工具保存缓存；跨用户/账号/站点及断开后不能复用', async () => {
    const tools = await queryHarness()
    const urls = ['https://topuplist.com/blogs/detail/one']
    const count = () => requests.filter(item => item.path.endsWith('/urlInspection/index:inspect')).length
    const before = count()
    const first = await invoke(tools, 'gsc_inspect', { urls }, { userId: auth.user.id })
    assert.equal(first.result.ok, true)
    const firstData = JSON.parse(first.result.modelContent)
    assert.equal(firstData.rows[0].status, 'indexed')
    const cached = JSON.parse((await invoke(tools, 'gsc_inspect', { urls }, { userId: auth.user.id })).result.modelContent)
    assert.equal(cached.rows[0].cached, true)
    assert.equal(cached.rows[0].checkedAt, firstData.rows[0].checkedAt)
    assert.equal(count(), before + 1)
    assert.equal((await invoke(tools, 'gsc_inspect', { urls }, { userId: other.user.id })).result.ok, false)
    assert.equal((await invoke(tools, 'gsc_inspect', { urls: ['https://topuplist.com.evil.test/'] }, { userId: auth.user.id })).result.ok, false)
    await service.callback(auth, await begin(undefined, 'another-google-account'))
    const view = await service.detail(auth.user.id)
    await service.select(auth.user.id, 'gsc', view.revision, 'sc-domain:topuplist.com')
    const changed = await invoke(tools, 'gsc_inspect', { urls }, { userId: auth.user.id })
    assert.equal(JSON.parse(changed.result.modelContent).rows[0].cached, false)
    assert.equal(count(), before + 2)
    await service.disconnect(auth.user.id)
    assert.equal((await invoke(tools, 'gsc_inspect', { urls }, { userId: auth.user.id })).result.ok, false)
  })
  it('收录失败计预算但保留旧成功，429停止后续且不把失败记成未收录', async () => {
    const tools = await queryHarness()
    const urls = ['https://topuplist.com/blogs/detail/failure']
    const run = { userId: auth.user.id }
    await invoke(tools, 'gsc_inspect', { urls }, run)
    const original = await prisma.googleInspection.findFirstOrThrow({ where: { userId: auth.user.id, url: urls[0]! } })
    const quota = (await prisma.googleInspectionBudget.findFirstOrThrow()).used
    for (const status of [503, 403, 429]) {
      apiStatus = status
      const result = await invoke(tools, 'gsc_inspect', { urls, refresh: true }, run)
      assert.equal(result.result.ok, true)
      assert.equal(JSON.parse(result.result.modelContent).rows[0].status, 'error')
      assert.ok(!result.result.modelContent.includes('secret-refresh'))
    }
    apiStatus = 200
    malformed = true
    const invalid = await invoke(tools, 'gsc_inspect', { urls, refresh: true }, run)
    malformed = false
    assert.equal(JSON.parse(invalid.result.modelContent).rows[0].status, 'error')
    assert.equal((await prisma.googleInspectionBudget.findFirstOrThrow()).used, quota + 4)
    assert.equal((await prisma.googleInspection.findUniqueOrThrow({ where: { id: original.id } })).checkedAt.toISOString(), original.checkedAt.toISOString())
    apiStatus = 429
    const stopped = JSON.parse((await invoke(tools, 'gsc_inspect', { urls: Array.from({ length: 5 }, (_, i) => `https://topuplist.com/blocked-${i}`) }, run)).result.modelContent)
    apiStatus = 200
    assert.ok(stopped.summary.failedCount >= 1 && stopped.summary.failedCount <= 2)
    assert.ok(stopped.summary.uncheckedCount >= 3)
  })
  it('收录401令连接需重授权，成功缓存不能绕过失效连接', async () => {
    const tools = await queryHarness()
    const urls = ['https://topuplist.com/revoked']
    assert.equal((await invoke(tools, 'gsc_inspect', { urls }, { userId: auth.user.id })).result.ok, true)
    apiStatus = 401
    try {
      assert.equal((await invoke(tools, 'gsc_inspect', { urls, refresh: true }, { userId: auth.user.id })).result.ok, false)
      assert.equal((await service.detail(auth.user.id)).needsAuth, true)
    }
    finally { apiStatus = 200 }
    assert.equal((await invoke(tools, 'gsc_inspect', { urls }, { userId: auth.user.id })).result.ok, false)
  })
  it('同站点检查预算并发争抢不超过2000，取消与迟到响应不交付', async () => {
    const tools = await queryHarness()
    const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
    await prisma.googleInspectionBudget.upsert({ where: { siteUrl_day: { siteUrl: 'sc-domain:topuplist.com', day } }, create: { siteUrl: 'sc-domain:topuplist.com', day, used: 1999 }, update: { used: 1999 } })
    const before = requests.filter(item => item.path.endsWith('/urlInspection/index:inspect')).length
    const results = await Promise.all([0, 1, 2].map(i => invoke(tools, 'gsc_inspect', { urls: [`https://topuplist.com/budget-${i}`] }, { userId: auth.user.id })))
    assert.equal(results.filter(result => JSON.parse(result.result.modelContent).summary.checkedCount === 1).length, 1)
    assert.equal(requests.filter(item => item.path.endsWith('/urlInspection/index:inspect')).length, before + 1)
    assert.equal((await prisma.googleInspectionBudget.findFirstOrThrow()).used, 2000)
    const cachedUrl = results.map(result => JSON.parse(result.result.modelContent)).find(data => data.summary.checkedCount === 1).rows[0].url
    const mixed = JSON.parse((await invoke(tools, 'gsc_inspect', { urls: ['https://topuplist.com/uncached-a', 'https://topuplist.com/uncached-b', cachedUrl] }, { userId: auth.user.id })).result.modelContent)
    assert.equal(mixed.summary.cachedCount, 1)
    assert.equal(mixed.summary.uncheckedCount, 2)
    assert.equal(requests.filter(item => item.path.endsWith('/urlInspection/index:inspect')).length, before + 1)
    await prisma.googleInspectionBudget.updateMany({ data: { used: 0 } })
    const gate = barrier('/v1/urlInspection/index:inspect')
    const pending = invoke(tools, 'gsc_inspect', { urls: ['https://topuplist.com/late'] }, { userId: auth.user.id })
    await gate.began
    await service.disconnect(auth.user.id)
    gate.release()
    assert.equal((await pending).result.ok, false)
    assert.equal(await prisma.googleInspection.count({ where: { url: 'https://topuplist.com/late' } }), 0)
    const fresh = await queryHarness()
    const controller = new AbortController()
    const cancelGate = barrier('/v1/urlInspection/index:inspect')
    const canceled = invoke(fresh, 'gsc_inspect', { urls: ['https://topuplist.com/cancel'] }, { userId: auth.user.id }, controller.signal)
    const rejected = assert.rejects(canceled, /stop/)
    await cancelGate.began
    controller.abort(new Error('stop'))
    cancelGate.release()
    await rejected
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
