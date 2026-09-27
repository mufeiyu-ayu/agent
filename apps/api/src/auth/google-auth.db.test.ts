/* eslint-disable perfectionist/sort-imports */
import 'reflect-metadata'

import type { INestApplication } from '@nestjs/common'
import { Buffer } from 'node:buffer'
import assert from 'node:assert/strict'
import { createHash, generateKeyPairSync, randomUUID, sign } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import process from 'node:process'
import { afterAll, beforeAll, describe, it } from 'vitest'
import { Module } from '@nestjs/common'
import { APP_GUARD, NestFactory } from '@nestjs/core'

import { AdminUsersController } from '../admin-users/admin-users.controller.js'
import { AdminUsersService } from '../admin-users/admin-users.service.js'
import { registerAppGlobals } from '../common/bootstrap/register-app-globals.js'
import { PrismaService } from '../prisma/prisma.service.js'
import { AuthController } from './auth.controller.js'
import { AuthGuard } from './auth.guard.js'
import { AuthService, LOGIN_FAILED_MESSAGE, userStatus } from './auth.service.js'
import { GoogleAuthController } from './google-auth.controller.js'
import { GOOGLE_ENDPOINTS, GOOGLE_LOGIN_FAILED_MESSAGE, GoogleAuthService, PENDING_USER_LIMIT } from './google-auth.service.js'
import { hashPassword } from './password.js'

// 本入口不允许 skip：缺少隔离数据库时必须显式失败，而不是假装通过。
const testDatabaseUrl = process.env.TEST_DATABASE_URL?.trim()

if (!testDatabaseUrl)
  throw new Error('缺少 TEST_DATABASE_URL：先 docker compose --profile integration up -d postgres-test，再按 .env.example 在根目录 .env 配置')

if (testDatabaseUrl === process.env.DATABASE_URL?.trim())
  throw new Error('TEST_DATABASE_URL 不得与 DATABASE_URL 相同，禁止在开发库上运行真实库测试')

const MIGRATIONS_DIR = new URL('../../../../prisma/migrations/', import.meta.url)
const WEB = 'http://localhost:5173'
const CLIENT_ID = 'test-client.apps.googleusercontent.com'
const CLIENT_SECRET = 'test-client-secret-value'
const KID = 'test-key-1'

const { Pool: PgPool } = createRequire(import.meta.url)('pg') as {
  Pool: new (options: { connectionString: string, max: number }) => {
    query: (text: string, values?: unknown[]) => Promise<unknown>
    end: () => Promise<void>
  }
}

type Claims = Record<string, unknown>

interface GoogleAccount {
  sub: string
  email: string
  name?: string
  picture?: string
}

/**
 * 本地假 Google：token 端点按授权码返回 id_token（与真 Google 一样校验 PKCE、授权码只能用一次），
 * JWKS 端点返回测试密钥的公钥。
 */
function startFakeGoogle(jwks: object[]) {
  const codes = new Map<string, { claims: Claims, challenge: string, redirectUri: string }>()
  const server = createServer((request, response) => {
    let body = ''
    request.on('data', (chunk) => {
      body += chunk
    })
    request.on('end', () => {
      const reply = (status: number, payload: unknown, headers: Record<string, string> = {}) => {
        response.writeHead(status, { 'content-type': 'application/json', ...headers })
        response.end(JSON.stringify(payload))
      }

      if (request.url === '/jwks')
        return reply(200, { keys: jwks }, { 'cache-control': 'public, max-age=3600' })

      const form = new URLSearchParams(body)
      const issued = codes.get(form.get('code') ?? '')
      codes.delete(form.get('code') ?? '')

      if (form.get('client_id') !== CLIENT_ID || form.get('client_secret') !== CLIENT_SECRET)
        return reply(401, { error: 'invalid_client' })

      if (!issued || issued.redirectUri !== form.get('redirect_uri')
        || createHash('sha256').update(form.get('code_verifier') ?? '').digest('base64url') !== issued.challenge) {
        return reply(400, { error: 'invalid_grant' })
      }

      reply(200, { access_token: `ya29.${randomUUID()}`, id_token: unsignedJwt(issued.claims), token_type: 'Bearer' })
    })
  })

  return {
    server,
    issueCode(claims: Claims, challenge: string, redirectUri: string): string {
      const code = `4/${randomUUID()}`
      codes.set(code, { claims, challenge, redirectUri })
      return code
    },
  }
}

describe('Google 登录（真实库 + 本地假 Google）', { timeout: 60_000 }, () => {
  const schema = `google_test_${randomUUID().replaceAll('-', '')}`
  const schemaUrl = withSearchPath(testDatabaseUrl, schema)
  const adminPool = new PgPool({ connectionString: testDatabaseUrl, max: 1 })
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
  const jwks: object[] = [{ ...publicKey.export({ format: 'jwk' }), kid: KID, alg: 'RS256', use: 'sig' }]
  const fake = startFakeGoogle(jwks)
  // AC-10：出现过的授权码、id_token、code_verifier、客户端密钥，最后在日志与全部响应里搜。
  const secrets = new Set<string>([CLIENT_SECRET])
  const responseTexts: string[] = []
  const logs: string[] = []
  const restore: Array<() => void> = []
  let prisma: PrismaService
  let app: INestApplication
  let baseUrl: string
  let adminCookie: string
  let ipCounter = 0

  beforeAll(async () => {
    await adminPool.query(`CREATE SCHEMA "${schema}"`)
    await adminPool.query(`SET search_path TO "${schema}", public`)
    const migrations = (await readdir(MIGRATIONS_DIR, { withFileTypes: true }))
      .filter(entry => entry.isDirectory())
      .map(entry => entry.name)
      .sort()

    for (const migration of migrations)
      await adminPool.query(await readFile(new URL(`${migration}/migration.sql`, MIGRATIONS_DIR), 'utf8'))

    await new Promise<void>(resolve => fake.server.listen(0, '127.0.0.1', resolve))
    const fakeUrl = `http://127.0.0.1:${(fake.server.address() as { port: number }).port}`
    const endpoints = { ...GOOGLE_ENDPOINTS }
    Object.assign(GOOGLE_ENDPOINTS, { authorize: `${fakeUrl}/authorize`, token: `${fakeUrl}/token`, jwks: `${fakeUrl}/jwks` })
    restore.push(() => Object.assign(GOOGLE_ENDPOINTS, endpoints))

    const env = { ...process.env }
    Object.assign(process.env, { GOOGLE_OAUTH_CLIENT_ID: CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET: CLIENT_SECRET, APP_ORIGINS: `${WEB},http://localhost:5174` })
    delete process.env.OUTBOUND_PROXY_URL
    restore.push(() => {
      process.env = env
    })

    for (const stream of [process.stdout, process.stderr]) {
      const write = stream.write.bind(stream)
      stream.write = ((chunk: unknown, ...rest: unknown[]) => {
        logs.push(String(chunk))
        return (write as (...args: unknown[]) => boolean)(chunk, ...rest)
      }) as typeof stream.write
      restore.push(() => {
        stream.write = write
      })
    }

    prisma = new PrismaService(schemaUrl)

    @Module({
      controllers: [AuthController, GoogleAuthController, AdminUsersController],
      providers: [
        { provide: PrismaService, useValue: prisma },
        { provide: APP_GUARD, useClass: AuthGuard },
        AuthService,
        GoogleAuthService,
        AdminUsersService,
      ],
    })
    class TestModule {}

    app = await NestFactory.create(TestModule, { logger: ['error', 'warn'] })
    // 用 X-Forwarded-For 给每个用例一个独立 IP，限流互不干扰。
    app.getHttpAdapter().getInstance().set('trust proxy', 'loopback')
    registerAppGlobals(app)
    await app.listen(0, '127.0.0.1')
    baseUrl = await app.getUrl()

    await prisma.user.create({ data: { email: 'admin@example.com', passwordHash: await hashPassword('admin-password'), role: 'ADMIN', mustChangePassword: false } })
    adminCookie = (await passwordLogin('admin@example.com', 'admin-password')).cookie!
  })

  afterAll(async () => {
    restore.reverse().forEach(undo => undo())
    await app?.close()
    await prisma?.$disconnect()
    fake.server.close()
    await adminPool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
    await adminPool.end()
  })

  async function request(path: string, init: { method?: string, cookie?: string, body?: unknown, headers?: Record<string, string>, ip?: string } = {}) {
    const method = init.method ?? 'GET'
    const response = await fetch(`${baseUrl}/api${path}`, {
      method,
      redirect: 'manual',
      headers: {
        'content-type': 'application/json',
        'x-forwarded-for': init.ip ?? '10.0.0.1',
        ...(method === 'GET' ? {} : { origin: WEB }),
        ...(init.cookie ? { cookie: init.cookie } : {}),
        ...init.headers,
      },
      ...(init.body ? { body: JSON.stringify(init.body) } : {}),
    })
    const text = await response.text()
    const location = response.headers.get('location')
    // Set-Cookie 不计入：流程 Cookie 本就装着 code_verifier（签名、HttpOnly，只回到本站）。
    responseTexts.push(text, location ?? '')
    const session = response.headers.getSetCookie().find(cookie => /^agent_session=[^;]+/.test(cookie))

    return {
      status: response.status,
      body: text.startsWith('{') ? JSON.parse(text) as { message?: string, data?: any } : {},
      location,
      setCookies: response.headers.getSetCookie(),
      cookie: session?.split(';')[0],
    }
  }

  async function passwordLogin(email: string, password: string) {
    return request('/auth/login', { method: 'POST', body: { email, password } })
  }

  function nextIp(): string {
    ipCounter += 1
    return `10.1.${Math.floor(ipCounter / 250)}.${ipCounter % 250}`
  }

  function claimsFor(account: GoogleAccount, nonce: string, extra: Claims = {}): Claims {
    return {
      iss: 'https://accounts.google.com',
      aud: CLIENT_ID,
      exp: Math.floor(Date.now() / 1000) + 3600,
      iat: Math.floor(Date.now() / 1000),
      nonce,
      sub: account.sub,
      email: account.email,
      email_verified: true,
      ...(account.name ? { name: account.name } : {}),
      ...(account.picture ? { picture: account.picture } : {}),
      ...extra,
    }
  }

  /**
   * 走一遍重定向登录：start → 假 Google 发授权码 → callback。`tamper` 用于故障注入。
   */
  async function googleLogin(account: GoogleAccount, options: {
    redirect?: string
    ip?: string
    claims?: Claims
    tamper?: (input: { state: string, cookie: string | undefined }) => { state?: string | undefined, cookie?: string | undefined }
    referer?: string
  } = {}) {
    const ip = options.ip ?? nextIp()
    const start = await request(`/auth/google/start${options.redirect === undefined ? '' : `?redirect=${encodeURIComponent(options.redirect)}`}`, {
      headers: { referer: options.referer ?? `${WEB}/login` },
      ip,
    })
    assert.equal(start.status, 302)
    const authorize = new URL(start.location!)
    const params = Object.fromEntries(authorize.searchParams)
    const flowCookie = start.setCookies.find(cookie => cookie.startsWith('agent_google_flow='))?.split(';')[0]
    const code = fake.issueCode(claimsFor(account, params.nonce!, options.claims), params.code_challenge!, params.redirect_uri!)
    const flow = JSON.parse(Buffer.from(flowCookie!.split('=')[1]!.split('.')[0]!, 'base64url').toString('utf8')) as { verifier: string }
    secrets.add(flow.verifier)
    const tampered = options.tamper?.({ state: params.state!, cookie: flowCookie }) ?? {}
    const state = 'state' in tampered ? tampered.state : params.state
    const cookie = 'cookie' in tampered ? tampered.cookie : flowCookie
    secrets.add(code)

    const callback = await request(`/auth/google/callback?code=${encodeURIComponent(code)}${state === undefined ? '' : `&state=${encodeURIComponent(state)}`}&scope=openid+email+profile&authuser=0&prompt=consent`, {
      ...(cookie ? { cookie } : {}),
      ip,
    })
    assert.equal(callback.status, 302)
    return { start: params, callback, code, flowCookie, ip }
  }

  function signJwt(claims: Claims, key = privateKey, kid = KID): string {
    const header = Buffer.from(JSON.stringify({ alg: 'RS256', kid, typ: 'JWT' })).toString('base64url')
    const payload = Buffer.from(JSON.stringify(claims)).toString('base64url')
    const token = `${header}.${payload}.${sign('RSA-SHA256', Buffer.from(`${header}.${payload}`), key).toString('base64url')}`
    secrets.add(token)
    return token
  }

  async function oneTapNonce(ip: string): Promise<string> {
    const result = await request('/auth/google/one-tap/nonce', { method: 'POST', ip })
    assert.equal(result.status, 200)
    return result.body.data.nonce as string
  }

  async function sessionCount(): Promise<number> {
    return prisma.session.count()
  }

  it('AC-01 / AC-20 同邮箱的密码账号用 Google 直接登录并绑定 sub；昵称头像随登录更新；密码登录仍可用', async () => {
    await prisma.user.create({ data: { email: 'op@example.com', passwordHash: await hashPassword('op-password-1'), mustChangePassword: false } })
    const account = { sub: 'sub-op', email: 'OP@example.com', name: '小运营', picture: 'https://lh3.googleusercontent.com/a/op' }

    const first = await googleLogin(account, { redirect: '/workspace?c=1' })
    const bound = await prisma.user.findUniqueOrThrow({ where: { email: 'op@example.com' } })

    assert.equal(first.callback.location, `${WEB}/workspace?c=1`)
    assert.ok(first.callback.cookie)
    assert.ok(first.callback.setCookies.some(cookie => /^agent_google_flow=;.*Max-Age=0/.test(cookie)))
    assert.equal(bound.googleSub, 'sub-op')
    assert.equal(first.start.redirect_uri, `${WEB}/api/auth/google/callback`)
    assert.equal(first.start.code_challenge_method, 'S256')
    assert.equal(first.start.scope, 'openid email profile')

    const me = await request('/auth/me', { cookie: first.callback.cookie! })
    assert.deepEqual(
      { email: me.body.data.email, name: me.body.data.name, avatarUrl: me.body.data.avatarUrl },
      { email: 'op@example.com', name: '小运营', avatarUrl: 'https://lh3.googleusercontent.com/a/op' },
    )

    const renamed = await googleLogin({ ...account, name: '改名后的运营' })
    const list = await request('/admin/users', { cookie: adminCookie })
    assert.ok(renamed.callback.cookie)
    assert.equal(list.body.data.find((user: { email: string }) => user.email === 'op@example.com').name, '改名后的运营')
    assert.equal((await passwordLogin('op@example.com', 'op-password-1')).status, 200)
  })

  it('AC-05 回跳参数是外站地址时只跳本站默认页；管理台来源回到管理台', async () => {
    await prisma.user.create({ data: { email: 'redirect@example.com', googleSub: 'sub-redirect', mustChangePassword: false } })
    const account = { sub: 'sub-redirect', email: 'redirect@example.com' }

    for (const redirect of ['https://evil.example', '//evil.example', '/\\evil.example', '/\t/evil.example', 'evil.example', `/workspace?c=${'x'.repeat(2000)}`])
      assert.equal((await googleLogin(account, { redirect })).callback.location, `${WEB}/workspace`, redirect)

    // Referer 不在 APP_ORIGINS 里时回调地址用第一个站点地址，不信任请求头。
    const foreign = await googleLogin(account, { referer: 'https://evil.example/' })
    assert.equal(foreign.start.redirect_uri, `${WEB}/api/auth/google/callback`)
    const admin = await googleLogin(account, { redirect: '/overview', referer: 'http://localhost:5174/login' })
    assert.equal(admin.callback.location, 'http://localhost:5174/overview')
  })

  it('AC-02 / AC-22 陌生账号建为待审核成员、不建 Session；列表显示头像昵称；通过后再登录进入工作台', async () => {
    const account = { sub: 'sub-stranger', email: 'stranger@gmail.com', name: 'Stranger', picture: 'https://lh3.googleusercontent.com/a/s' }
    const before = await sessionCount()

    const first = await googleLogin(account)
    const pending = await prisma.user.findUniqueOrThrow({ where: { email: 'stranger@gmail.com' } })

    assert.equal(first.callback.location, loginAt('pending'))
    assert.equal(first.callback.cookie, undefined)
    assert.equal(await sessionCount(), before)
    assert.deepEqual(
      { status: userStatus(pending), role: pending.role, passwordHash: pending.passwordHash, mustChangePassword: pending.mustChangePassword, googleSub: pending.googleSub },
      { status: 'PENDING', role: 'MEMBER', passwordHash: null, mustChangePassword: false, googleSub: 'sub-stranger' },
    )

    const row = (await request('/admin/users', { cookie: adminCookie })).body.data.find((user: { id: string }) => user.id === pending.id)
    assert.deepEqual({ status: row.status, name: row.name, avatarUrl: row.avatarUrl }, { status: 'PENDING', name: 'Stranger', avatarUrl: 'https://lh3.googleusercontent.com/a/s' })

    // 管理台来源的待审核回到管理台登录页（线上管理台在 /admin/ 下）。
    assert.equal((await googleLogin(account, { redirect: '/admin/overview' })).callback.location, loginAt('pending', '/overview', `${WEB}/admin/login`))
    assert.equal((await request(`/admin/users/${pending.id}`, { method: 'PATCH', cookie: adminCookie, body: { status: 'PENDING' } })).status, 400)
    // 只改角色（或空 PATCH）不能顺带放行待审核
    assert.equal((await request(`/admin/users/${pending.id}`, { method: 'PATCH', cookie: adminCookie, body: { role: 'ADMIN' } })).body.data.status, 'PENDING')
    assert.equal((await request(`/admin/users/${pending.id}`, { method: 'PATCH', cookie: adminCookie, body: {} })).body.data.status, 'PENDING')
    assert.equal((await googleLogin(account)).callback.location, loginAt('pending'))
    await request(`/admin/users/${pending.id}`, { method: 'PATCH', cookie: adminCookie, body: { role: 'MEMBER' } })
    assert.equal((await request(`/admin/users/${pending.id}`, { method: 'PATCH', cookie: adminCookie, body: { status: 'ACTIVE' } })).status, 200)

    const approved = await googleLogin(account)
    assert.equal(approved.callback.location, `${WEB}/workspace`)
    assert.equal((await request('/auth/me', { cookie: approved.callback.cookie! })).body.data.role, 'MEMBER')
  })

  it('AC-03 拒绝后再登录得到与停用账号相同的失败，不新建第二条待审核', async () => {
    const account = { sub: 'sub-rejected', email: 'rejected@gmail.com' }
    await googleLogin(account)
    const user = await prisma.user.findUniqueOrThrow({ where: { email: 'rejected@gmail.com' } })
    assert.equal((await request(`/admin/users/${user.id}`, { method: 'PATCH', cookie: adminCookie, body: { status: 'DISABLED' } })).status, 200)
    await prisma.user.create({ data: { email: 'disabled@example.com', googleSub: 'sub-disabled', disabled: true, mustChangePassword: false } })
    const before = await sessionCount()

    const rejected = await googleLogin({ ...account, name: '改了名字想混过审核' })
    const disabled = await googleLogin({ sub: 'sub-disabled', email: 'disabled@example.com' })
    assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).name, null)

    assert.equal(rejected.callback.location, loginAt('failed'))
    assert.equal(disabled.callback.location, rejected.callback.location)
    assert.equal(await prisma.user.count({ where: { OR: [{ email: 'rejected@gmail.com' }, { googleSub: 'sub-rejected' }] } }), 1)
    assert.equal(await sessionCount(), before)
  })

  it('AC-04 state 篡改 / 缺失、授权码重放、nonce 不匹配、email_verified 为假都被拒且不建 Session', async () => {
    const account = { sub: 'sub-op', email: 'op@example.com' }
    const failed = loginAt('failed')
    const before = await sessionCount()

    assert.equal((await googleLogin(account, { tamper: ({ state }) => ({ state: `${state}x` }) })).callback.location, failed)
    assert.equal((await googleLogin(account, { tamper: () => ({ state: undefined }) })).callback.location, failed)
    // 没有或改坏了流程 Cookie（签名对不上）：不知道原目标页，回默认登录页
    assert.equal((await googleLogin(account, { tamper: () => ({ cookie: undefined }) })).callback.location, loginAt('failed', null))
    assert.equal((await googleLogin(account, { tamper: ({ cookie }) => ({ cookie: `${cookie}x` }) })).callback.location, loginAt('failed', null))
    assert.equal((await googleLogin(account, { claims: { nonce: 'another-nonce' } })).callback.location, failed)
    assert.equal((await googleLogin(account, { claims: { email_verified: false } })).callback.location, failed)
    assert.equal((await googleLogin(account, { claims: { aud: 'other-client' } })).callback.location, failed)
    assert.equal((await googleLogin(account, { claims: { exp: Math.floor(Date.now() / 1000) - 10 } })).callback.location, failed)
    assert.equal(await sessionCount(), before)

    // 重放：同一授权码、同一流程 Cookie 再回调一次
    const once = await googleLogin(account)
    assert.ok(once.callback.cookie)
    const replay = await request(`/auth/google/callback?code=${encodeURIComponent(once.code)}&state=${encodeURIComponent(once.start.state!)}`, { cookie: once.flowCookie!, ip: once.ip })
    assert.equal(replay.location, failed)
    assert.equal(replay.cookie, undefined)
    assert.equal(await sessionCount(), before + 1)
  })

  it('AC-07 同一 sub 换了邮箱仍登录原账号，不新建、不改绑', async () => {
    const original = await prisma.user.findUniqueOrThrow({ where: { googleSub: 'sub-op' } })
    const users = await prisma.user.count()

    const result = await googleLogin({ sub: 'sub-op', email: 'op-new-address@gmail.com' })
    const me = await request('/auth/me', { cookie: result.callback.cookie! })

    assert.equal(me.body.data.id, original.id)
    assert.equal(me.body.data.email, 'op@example.com')
    assert.equal(await prisma.user.count(), users)

    // 反过来：邮箱对上但已绑了别的 sub，不改绑
    const other = await googleLogin({ sub: 'sub-someone-else', email: 'op@example.com' })
    assert.equal(other.callback.location, loginAt('failed'))
    assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: original.id } })).googleSub, 'sub-op')
  })

  it('AC-09 无密码账号用密码登录得到统一失败；管理员重置后可用临时密码登录并被要求改密码', async () => {
    const user = await prisma.user.findUniqueOrThrow({ where: { email: 'stranger@gmail.com' } })

    const attempt = await passwordLogin('stranger@gmail.com', 'any-password-1')
    assert.equal(attempt.status, 401)
    assert.equal(attempt.body.message, LOGIN_FAILED_MESSAGE)

    secrets.add('stranger-temp-pw')
    assert.equal((await request(`/admin/users/${user.id}/reset-password`, { method: 'POST', cookie: adminCookie, body: { password: 'stranger-temp-pw' } })).status, 200)
    const login = await passwordLogin('stranger@gmail.com', 'stranger-temp-pw')
    assert.equal(login.status, 200)
    assert.equal(login.body.data.mustChangePassword, true)
  })

  it('AC-15 One Tap：篡改签名、aud 不对、过期、nonce 不是签发的 / 重复使用、外站 Origin 均被拒且不建 Session', async () => {
    const ip = nextIp()
    const account = { sub: 'sub-op', email: 'op@example.com', name: 'One Tap 运营' }
    const oneTap = (credential: string, headers?: Record<string, string>) =>
      request('/auth/google/one-tap', { method: 'POST', body: { credential }, ip, ...(headers ? { headers } : {}) })
    const before = await sessionCount()
    const { privateKey: otherKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })

    const good = signJwt(claimsFor(account, await oneTapNonce(ip)))
    const [header, , signature] = good.split('.')
    const tamperedPayload = Buffer.from(JSON.stringify({ ...claimsFor(account, 'x'), sub: 'sub-admin' })).toString('base64url')
    const rejected = [
      await oneTap(`${header}.${tamperedPayload}.${signature}`),
      await oneTap(signJwt(claimsFor(account, await oneTapNonce(ip)), otherKey)),
      await oneTap(signJwt(claimsFor(account, await oneTapNonce(ip), { aud: 'other-client' }))),
      await oneTap(signJwt(claimsFor(account, await oneTapNonce(ip), { exp: Math.floor(Date.now() / 1000) - 10 }))),
      await oneTap(signJwt(claimsFor(account, 'never-issued-nonce'))),
      await oneTap(signJwt(claimsFor(account, await oneTapNonce(ip), { email_verified: false }))),
    ]

    for (const result of rejected) {
      assert.equal(result.status, 401)
      assert.equal(result.body.message, GOOGLE_LOGIN_FAILED_MESSAGE)
      assert.equal(result.cookie, undefined)
    }

    assert.equal((await oneTap(good, { origin: 'https://evil.example' })).status, 403)
    assert.equal(await sessionCount(), before)

    const ok = await oneTap(good)
    assert.equal(ok.status, 200)
    assert.equal(ok.body.data.status, 'ok')
    assert.equal(ok.body.data.user.name, 'One Tap 运营')
    assert.ok(ok.cookie)
    assert.equal((await request('/auth/me', { cookie: ok.cookie! })).body.data.email, 'op@example.com')

    // 同一个 nonce（同一个 token）再用一次
    const replay = await oneTap(good)
    assert.equal(replay.status, 401)
    assert.equal(await sessionCount(), before + 1)
  })

  it('AC-16 One Tap 的陌生 / 待审核 / 被拒账号与重定向登录结果一致', async () => {
    const ip = nextIp()
    const oneTap = async (account: GoogleAccount) =>
      request('/auth/google/one-tap', { method: 'POST', body: { credential: signJwt(claimsFor(account, await oneTapNonce(ip))) }, ip })
    const stranger = { sub: 'sub-onetap-stranger', email: 'onetap@gmail.com', name: 'Tap', picture: 'https://lh3.googleusercontent.com/a/t' }

    const first = await oneTap(stranger)
    assert.equal(first.status, 200)
    assert.deepEqual(first.body.data, { status: 'pending' })
    assert.equal(first.cookie, undefined)
    const user = await prisma.user.findUniqueOrThrow({ where: { googleSub: 'sub-onetap-stranger' } })
    assert.deepEqual({ status: userStatus(user), name: user.name, avatarUrl: user.avatarUrl }, { status: 'PENDING', name: 'Tap', avatarUrl: 'https://lh3.googleusercontent.com/a/t' })
    assert.deepEqual((await oneTap(stranger)).body.data, { status: 'pending' })
    assert.equal((await googleLogin(stranger)).callback.location, loginAt('pending'))

    await request(`/admin/users/${user.id}`, { method: 'PATCH', cookie: adminCookie, body: { status: 'DISABLED' } })
    const rejected = await oneTap(stranger)
    assert.equal(rejected.status, 401)
    assert.equal(rejected.body.message, GOOGLE_LOGIN_FAILED_MESSAGE)
    assert.equal((await googleLogin(stranger)).callback.location, loginAt('failed'))
    assert.equal(await prisma.user.count({ where: { email: 'onetap@gmail.com' } }), 1)
  })

  it('AC-06 待审核满 50 个后不再新建；同一 IP 频繁请求回调被限流', async () => {
    const existing = await prisma.user.count({ where: { pendingApproval: true } })
    await prisma.user.createMany({
      data: Array.from({ length: PENDING_USER_LIMIT - existing }, (_, index) => ({
        email: `pending-${index}@gmail.com`,
        googleSub: `sub-pending-${index}`,
        pendingApproval: true,
        mustChangePassword: false,
      })),
    })

    const full = await googleLogin({ sub: 'sub-late', email: 'late@gmail.com' })
    assert.equal(full.callback.location, loginAt('busy'))
    const tapIp = nextIp()
    const nonce = (await request('/auth/google/one-tap/nonce', { method: 'POST', ip: tapIp })).body.data.nonce as string
    const tapFull = await request('/auth/google/one-tap', { method: 'POST', ip: tapIp, body: { credential: signJwt(claimsFor({ sub: 'sub-late', email: 'late@gmail.com' }, nonce)) } })
    assert.deepEqual([tapFull.status, tapFull.body.data], [200, { status: 'busy' }])
    assert.equal(await prisma.user.count({ where: { email: 'late@gmail.com' } }), 0)

    const ip = nextIp()
    const locations: string[] = []
    for (let index = 0; index < 51; index += 1)
      locations.push((await request(`/auth/google/callback?code=x&state=y`, { ip })).location!)

    assert.ok(locations.slice(0, 50).every(location => location === loginAt('failed', null)))
    // 限流与待审核名额已满是两种提示
    assert.equal(locations[50], loginAt('throttled', null))
    // 被限流后，正常流程也进不来；换 IP 不受影响
    assert.equal((await googleLogin({ sub: 'sub-op', email: 'op@example.com' }, { ip })).callback.location, loginAt('throttled'))
    assert.equal((await googleLogin({ sub: 'sub-op', email: 'op@example.com' })).callback.location, `${WEB}/workspace`)
    const tap = await request('/auth/google/one-tap', { method: 'POST', body: { credential: 'x' }, ip })
    assert.equal(tap.status, 429)

    // nonce 签发单独按 IP 限流，刷不满全局池
    const nonceIp = nextIp()
    const nonceStatuses: number[] = []
    for (let index = 0; index < 301; index += 1)
      nonceStatuses.push((await request('/auth/google/one-tap/nonce', { method: 'POST', ip: nonceIp })).status)
    assert.deepEqual([nonceStatuses.slice(0, 300).every(status => status === 200), nonceStatuses[300]], [true, 429])
  })

  it('Google 登录不清密码失败锁定；Google 换签名密钥后 One Tap 仍可用', async () => {
    const lockedUntil = new Date(Date.now() + 10 * 60_000)
    await prisma.user.update({ where: { email: 'op@example.com' }, data: { failedLoginCount: 3, lockedUntil } })

    assert.equal((await googleLogin({ sub: 'sub-op', email: 'op@example.com' })).callback.location, `${WEB}/workspace`)
    const after = await prisma.user.findUniqueOrThrow({ where: { email: 'op@example.com' } })
    assert.deepEqual([after.failedLoginCount, after.lockedUntil?.getTime()], [3, lockedUntil.getTime()])
    await prisma.user.update({ where: { email: 'op@example.com' }, data: { failedLoginCount: 0, lockedUntil: null } })

    // 换密钥：新 kid 不在缓存里，超过强制重取间隔后重新拉 JWKS
    const { privateKey: rotated, publicKey: rotatedPublic } = generateKeyPairSync('rsa', { modulusLength: 2048 })
    jwks.push({ ...rotatedPublic.export({ format: 'jwk' }), kid: 'test-key-2', alg: 'RS256', use: 'sig' })
    const cache = (app.get(GoogleAuthService) as unknown as { jwks: { fetchedAt: number } }).jwks
    cache.fetchedAt -= 61_000
    const ip = nextIp()
    const result = await request('/auth/google/one-tap', {
      method: 'POST',
      ip,
      body: { credential: signJwt(claimsFor({ sub: 'sub-op', email: 'op@example.com' }, await oneTapNonce(ip)), rotated, 'test-key-2') },
    })
    assert.deepEqual([result.status, result.body.data.status], [200, 'ok'])
  })

  it('AC-10 日志与全部响应里搜不到授权码、token、code_verifier 与客户端密钥', () => {
    const haystack = [...logs, ...responseTexts].join('\n')

    assert.ok(secrets.size > 20)
    assert.ok(logs.some(line => line.includes('Google 重定向登录失败')), '失败原因应进日志')
    for (const secret of secrets)
      assert.ok(!haystack.includes(secret), `泄露：${secret.slice(0, 6)}…`)
  })
})

/** 回调没进站时回到的登录页；流程 Cookie 有效时带回原目标页。 */
function loginAt(result: string, redirect: string | null = '/workspace', base = `${WEB}/login`): string {
  return `${base}?google=${result}${redirect === null ? '' : `&redirect=${encodeURIComponent(redirect)}`}`
}

function unsignedJwt(claims: Claims): string {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url')
  return `${encode({ alg: 'RS256', kid: KID })}.${encode(claims)}.c2lnbmF0dXJl`
}

function withSearchPath(connectionString: string, schema: string): string {
  const url = new URL(connectionString)
  url.searchParams.set('schema', schema)
  url.searchParams.set('options', `-c search_path=${schema},public`)
  return url.toString()
}
