/* eslint-disable perfectionist/sort-imports */
import 'reflect-metadata'

import type { INestApplication } from '@nestjs/common'
import type { UserRole } from '../generated/prisma/client.js'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { afterAll, beforeAll, describe, it, onTestFinished, vi } from 'vitest'
import { Module } from '@nestjs/common'
import { APP_GUARD, NestFactory } from '@nestjs/core'

import { AdminConversationsController } from '../admin-conversations/admin-conversations.controller.js'
import { AdminConversationsService } from '../admin-conversations/admin-conversations.service.js'
import { AdminUsersController } from '../admin-users/admin-users.controller.js'
import { AdminUsersService } from '../admin-users/admin-users.service.js'
import { AgentRuntimeService } from '../agent-runtime/agent-runtime.service.js'
import { ChatController } from '../chat/chat.controller.js'
import { ChatService } from '../chat/chat.service.js'
import { registerAppGlobals } from '../common/bootstrap/register-app-globals.js'
import { ConversationsController } from '../conversations/conversations.controller.js'
import { ConversationsService } from '../conversations/conversations.service.js'
import { MessagesController } from '../conversations/messages.controller.js'
import { MessagesService } from '../conversations/messages.service.js'
import { createResolvedLlmModel } from '../llm/__fixtures__.js'
import { LlmModelConfigService } from '../llm/llm-model-config.service.js'
import { PrismaService } from '../prisma/prisma.service.js'
import { RuntimeConfigService } from '../runtime-config/runtime-config.service.js'
import { WorkspaceGcService } from '../workspaces/workspace-gc.service.js'
import { AuthController } from './auth.controller.js'
import { AuthGuard } from './auth.guard.js'
import { AuthService, LOGIN_FAILED_MESSAGE } from './auth.service.js'
import { hashPassword } from './password.js'

// 本入口不允许 skip：缺少隔离数据库时必须显式失败，而不是假装通过。
const testDatabaseUrl = process.env.TEST_DATABASE_URL?.trim()

if (!testDatabaseUrl)
  throw new Error('缺少 TEST_DATABASE_URL：先 docker compose --profile integration up -d postgres-test，再按 .env.example 在根目录 .env 配置')

if (testDatabaseUrl === process.env.DATABASE_URL?.trim())
  throw new Error('TEST_DATABASE_URL 不得与 DATABASE_URL 相同，禁止在开发库上运行真实库测试')

const MIGRATIONS_DIR = new URL('../../../../prisma/migrations/', import.meta.url)
const API_DIR = fileURLToPath(new URL('../../', import.meta.url))
const ORIGIN = 'http://localhost:5173'

const { Pool: PgPool } = createRequire(import.meta.url)('pg') as {
  Pool: new (options: { connectionString: string, max: number }) => {
    query: (text: string, values?: unknown[]) => Promise<unknown>
    end: () => Promise<void>
  }
}

interface ApiResult {
  status: number
  body: { message?: string, data?: any, error?: { error?: string } }
  setCookie: string | null
}

describe('鉴权与会话隔离（真实库）', { timeout: 60_000 }, () => {
  const schema = `auth_test_${randomUUID().replaceAll('-', '')}`
  const schemaUrl = withSearchPath(testDatabaseUrl, schema)
  const adminPool = new PgPool({ connectionString: testDatabaseUrl, max: 1 })
  const runtimeCalls: Array<{ conversationId: string }> = []
  // AC-13：测试里出现过的明文密码与 token，最后在日志和全部响应体里搜索。
  const secrets = new Set<string>()
  const responseBodies: string[] = []
  const logs: string[] = []
  const restoreWrites: Array<() => void> = []
  let prisma: PrismaService
  let app: INestApplication
  let baseUrl: string

  beforeAll(async () => {
    assert.match(schema, /^auth_test_[a-f\d]+$/)
    await adminPool.query(`CREATE SCHEMA "${schema}"`)
    await adminPool.query(`SET search_path TO "${schema}", public`)
    const migrations = (await readdir(MIGRATIONS_DIR, { withFileTypes: true }))
      .filter(entry => entry.isDirectory())
      .map(entry => entry.name)
      .sort()

    for (const migration of migrations)
      await adminPool.query(await readFile(new URL(`${migration}/migration.sql`, MIGRATIONS_DIR), 'utf8'))

    prisma = new PrismaService(schemaUrl)

    @Module({
      controllers: [AuthController, AdminUsersController, AdminConversationsController, ConversationsController, MessagesController, ChatController],
      providers: [
        { provide: PrismaService, useValue: prisma },
        { provide: APP_GUARD, useClass: AuthGuard },
        AuthService,
        AdminUsersService,
        AdminConversationsService,
        ConversationsService,
        // 鉴权用例不验证对象回收：会话删除依赖的回收服务用空实现，不随本机 OSS 配置访问云。
        { provide: WorkspaceGcService, useValue: { register: async () => {}, kick: () => {} } satisfies Pick<WorkspaceGcService, 'register' | 'kick'> },
        MessagesService,
        ChatService,
        {
          provide: AgentRuntimeService,
          useValue: {
            async* runTurnStream(input: { conversationId: string }) {
              runtimeCalls.push(input)
            },
          },
        },
        { provide: LlmModelConfigService, useValue: { resolveModel: async () => createResolvedLlmModel() } },
        // 运行配置读的是迁移插入的那一行（没配 Serper Key，用不到解密）。
        RuntimeConfigService,
      ],
    })
    class TestModule {}

    for (const stream of [process.stdout, process.stderr]) {
      const write = stream.write.bind(stream)
      stream.write = ((chunk: unknown, ...rest: unknown[]) => {
        logs.push(String(chunk))
        return (write as (...args: unknown[]) => boolean)(chunk, ...rest)
      }) as typeof stream.write
      restoreWrites.push(() => {
        stream.write = write
      })
    }

    app = await NestFactory.create(TestModule, { logger: ['error', 'warn'] })
    // 只为 AC-08 用 X-Forwarded-Proto 模拟 HTTPS；线上由 main.ts 按 TRUST_PROXY 设置。
    app.getHttpAdapter().getInstance().set('trust proxy', 'loopback')
    registerAppGlobals(app)
    await app.listen(0, '127.0.0.1')
    baseUrl = await app.getUrl()
  })

  afterAll(async () => {
    restoreWrites.forEach(restore => restore())
    await app?.close()
    await prisma?.$disconnect()
    await adminPool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
    await adminPool.end()
  })

  async function api(path: string, options: { method?: string, cookie?: string, body?: unknown, headers?: Record<string, string> } = {}): Promise<ApiResult> {
    const method = options.method ?? 'GET'
    const response = await fetch(`${baseUrl}/api${path}`, {
      method,
      headers: {
        'content-type': 'application/json',
        ...(method === 'GET' ? {} : { origin: ORIGIN }),
        ...(options.cookie ? { cookie: options.cookie } : {}),
        ...options.headers,
      },
      ...(options.body ? { body: JSON.stringify(options.body) } : {}),
    })
    const text = await response.text()
    responseBodies.push(text)
    const setCookie = response.headers.get('set-cookie')
    const token = setCookie?.match(/^agent_session=([^;]*)/)?.[1]

    if (token)
      secrets.add(token)

    return { status: response.status, body: text.startsWith('{') ? JSON.parse(text) : {}, setCookie }
  }

  async function login(email: string, password: string, headers?: Record<string, string>): Promise<{ cookie: string, result: ApiResult }> {
    secrets.add(password)
    const result = await api('/auth/login', { method: 'POST', body: { email, password }, ...(headers ? { headers } : {}) })
    assert.equal(result.status, 200, `登录 ${email} 应成功：${result.body.message}`)
    return { cookie: result.setCookie!.split(';')[0]!, result }
  }

  async function createUser(email: string, password: string, role: UserRole = 'MEMBER', mustChangePassword = false) {
    secrets.add(password)
    return prisma.user.create({ data: { email, passwordHash: await hashPassword(password), role, mustChangePassword } })
  }

  let adminCookie: string
  const ADMIN_PASSWORD = 'admin-initial-pw'

  it('AC-11 CLI 在空库建管理员并认领无主会话；重复执行不重复建号，而是重置密码并解锁', async () => {
    const orphan = await prisma.conversation.create({ data: { title: '存量会话' } })
    secrets.add(ADMIN_PASSWORD)
    const runScript = () => promisify(execFile)(process.execPath, ['--import', 'tsx', 'src/create-admin.ts'], {
      cwd: API_DIR,
      env: { ...process.env, DATABASE_URL: schemaUrl, ADMIN_EMAIL: ' Admin@Example.com ', ADMIN_PASSWORD },
    })

    const first = await runScript()
    await prisma.user.update({ where: { email: 'admin@example.com' }, data: { disabled: true, lockedUntil: new Date(Date.now() + 60_000) } })
    const second = await runScript()
    const admins = await prisma.user.findMany({ where: { email: 'admin@example.com' } })

    assert.match(first.stdout, /已创建管理员：admin@example\.com；归入无主会话 1 个/)
    assert.match(second.stdout, /账号已存在，已重置密码并设为启用中的管理员/)
    assert.equal(admins.length, 1)
    assert.equal(admins[0]!.role, 'ADMIN')
    assert.equal(admins[0]!.disabled, false)
    assert.equal(admins[0]!.lockedUntil, null)
    assert.equal((await prisma.conversation.findUniqueOrThrow({ where: { id: orphan.id } })).userId, admins[0]!.id)
    logs.push(first.stdout, first.stderr, second.stdout, second.stderr)
  })

  it('AC-08 库里只有哈希；Cookie 带 HttpOnly / SameSite=Lax，HTTPS 时带 Secure', async () => {
    const plain = await login('ADMIN@example.com', ADMIN_PASSWORD)
    const https = await login('admin@example.com', ADMIN_PASSWORD, { 'x-forwarded-proto': 'https' })
    const token = plain.cookie.split('=')[1]!
    const user = await prisma.user.findUniqueOrThrow({ where: { email: 'admin@example.com' } })
    const sessions = await prisma.session.findMany({ where: { userId: user.id } })

    adminCookie = plain.cookie
    assert.match(plain.result.setCookie!, /HttpOnly/)
    assert.match(plain.result.setCookie!, /SameSite=Lax/)
    assert.match(plain.result.setCookie!, /Max-Age=2592000/)
    assert.doesNotMatch(plain.result.setCookie!, /Secure/)
    assert.match(https.result.setCookie!, /; Secure/)
    assert.equal(token.length, 43)
    assert.ok(sessions.some(session => session.tokenHash === createHash('sha256').update(token).digest('hex')))
    assert.ok(sessions.every(session => !session.tokenHash.includes(token)))
    assert.match(user.passwordHash!, /^scrypt\$131072\$8\$1\$/)
    assert.ok(!user.passwordHash!.includes(ADMIN_PASSWORD))
    assert.ok(user.lastLoginAt)
  })

  it('AC-10 不能停用自己；不能降级或停用最后一个启用中的管理员', async () => {
    const me = await api('/auth/me', { cookie: adminCookie })
    const adminId = me.body.data.id as string
    const created = await api('/admin/users', { method: 'POST', cookie: adminCookie, body: { email: 'Second-Admin@example.com', password: 'second-admin-pw', role: 'ADMIN' } })
    secrets.add('second-admin-pw')

    assert.equal(created.status, 201)
    assert.equal(created.body.data.email, 'second-admin@example.com')
    assert.equal(created.body.data.mustChangePassword, true)
    assert.equal((await api('/admin/users', { method: 'POST', cookie: adminCookie, body: { email: 'second-admin@example.com', password: 'another-pw-1', role: 'MEMBER' } })).status, 409)
    // 第二个管理员停用后，自己就是最后一个启用中的管理员。
    assert.equal((await api(`/admin/users/${created.body.data.id}`, { method: 'PATCH', cookie: adminCookie, body: { status: 'DISABLED' } })).status, 200)

    const disableSelf = await api(`/admin/users/${adminId}`, { method: 'PATCH', cookie: adminCookie, body: { status: 'DISABLED' } })
    const demoteSelf = await api(`/admin/users/${adminId}`, { method: 'PATCH', cookie: adminCookie, body: { role: 'MEMBER' } })
    const after = await prisma.user.findUniqueOrThrow({ where: { id: adminId } })

    assert.equal(disableSelf.status, 400)
    assert.equal(disableSelf.body.message, '不能停用自己')
    assert.equal(demoteSelf.status, 400)
    assert.equal(demoteSelf.body.message, '至少要保留一个启用中的管理员')
    assert.equal(after.role, 'ADMIN')
    assert.equal(after.disabled, false)
    assert.equal((await api('/auth/me', { cookie: adminCookie })).status, 200)
  })

  it('AC-03 B 看不到也动不了 A 的会话，一律 404，A 的数据不变', async () => {
    await createUser('a@example.com', 'a-password-1')
    await createUser('b@example.com', 'b-password-1')
    const a = (await login('a@example.com', 'a-password-1')).cookie
    const b = (await login('b@example.com', 'b-password-1')).cookie
    const created = await api('/conversations', { method: 'POST', cookie: a, body: { title: 'A 的会话' } })
    const conversationId = created.body.data.id as string
    await prisma.message.create({ data: { conversationId, role: 'USER', content: 'A 的消息' } })

    assert.equal(created.status, 201)
    assert.equal((await api('/conversations', { cookie: b })).body.data.items.length, 0)
    assert.equal((await api(`/conversations?cursor=${conversationId}`, { cookie: b })).status, 404)
    assert.equal((await api(`/conversations/${conversationId}/messages`, { cookie: b })).status, 404)
    assert.equal((await api(`/conversations/${conversationId}`, { method: 'PATCH', cookie: b, body: { title: '被改了' } })).status, 404)
    assert.equal((await api(`/conversations/${conversationId}`, { method: 'DELETE', cookie: b })).status, 404)
    assert.equal((await api('/chat/stream', { method: 'POST', cookie: b, body: { conversationId, message: '偷看' } })).status, 404)
    assert.equal(runtimeCalls.length, 0)

    const stored = await prisma.conversation.findUniqueOrThrow({ where: { id: conversationId }, include: { messages: true } })
    assert.equal(stored.title, 'A 的会话')
    assert.equal(stored.messages.length, 1)
    assert.deepEqual((await api('/conversations', { cookie: a })).body.data.items.map((item: { id: string }) => item.id), [conversationId])
    assert.equal((await api(`/conversations/${conversationId}/messages`, { cookie: a })).body.data.length, 1)
    assert.equal((await api('/chat/stream', { method: 'POST', cookie: a, body: { conversationId, message: '继续' } })).status, 200)
    assert.deepEqual(runtimeCalls.map(call => call.conversationId), [conversationId])
  })

  it('#201 会话记录按用户与最近活跃时间筛选，与分页共存；非法参数 400，成员 403', async () => {
    const owner = await createUser('owner-201@example.com', 'owner-201-pw')
    const other = await createUser('other-201@example.com', 'other-201-pw')
    const at = (day: number) => new Date(`2026-08-${String(day).padStart(2, '0')}T04:00:00.000Z`)
    // 同一用户 5 个会话分布在 8 月 1～5 日，另一个用户与无主会话各 1 个落在同一窗口内。
    for (let day = 1; day <= 5; day++)
      await prisma.conversation.create({ data: { title: `owner-${day}`, userId: owner.id, createdAt: at(day), updatedAt: at(day) } })
    await prisma.conversation.create({ data: { title: 'other-3', userId: other.id, createdAt: at(3), updatedAt: at(3) } })
    await prisma.conversation.create({ data: { title: 'orphan-3', createdAt: at(3), updatedAt: at(3) } })
    const list = (query: string) => api(`/admin/conversations?${query}`, { cookie: adminCookie })
    const titles = (result: ApiResult) => result.body.data.items.map((item: { title: string }) => item.title)

    const byUser = await list(`userId=${owner.id}&pageSize=2&page=2`)
    assert.equal(byUser.status, 200)
    assert.deepEqual(titles(byUser), ['owner-3', 'owner-2'])
    assert.deepEqual(byUser.body.data.pagination, { page: 2, pageSize: 2, totalItems: 5, totalPages: 3 })
    assert.deepEqual(byUser.body.data.items[0].user, { id: owner.id, email: 'owner-201@example.com', name: null, avatarUrl: null })

    const window = 'dateFrom=2026-08-02T00:00:00%2B08:00&dateTo=2026-08-04T23:59:59.999%2B08:00'
    const byTime = await list(`${window}&pageSize=10`)
    // 同一 updatedAt 的三条按 id 排，顺序不固定，只核对集合与首尾。
    assert.deepEqual([...titles(byTime)].sort(), ['orphan-3', 'other-3', 'owner-2', 'owner-3', 'owner-4'])
    assert.equal(titles(byTime)[0], 'owner-4')
    assert.equal(titles(byTime)[4], 'owner-2')
    assert.equal(byTime.body.data.pagination.totalItems, 5)
    assert.equal(byTime.body.data.items.find((item: { title: string }) => item.title === 'orphan-3').user, null)

    const both = await list(`${window}&userId=${owner.id}&pageSize=2`)
    assert.deepEqual(titles(both), ['owner-4', 'owner-3'])
    assert.deepEqual(both.body.data.pagination, { page: 1, pageSize: 2, totalItems: 3, totalPages: 2 })

    const detail = await api(`/admin/conversations/${byUser.body.data.items[0].id}`, { cookie: adminCookie })
    assert.equal(detail.body.data.user.email, 'owner-201@example.com')

    const missingUser = await list('userId=no-such-user')
    assert.equal(missingUser.status, 200)
    assert.equal(missingUser.body.data.pagination.totalItems, 0)
    assert.equal((await list('dateFrom=2026-08-01')).status, 400)
    assert.equal((await list('dateFrom=not-a-date')).status, 400)
    assert.equal((await list('dateFrom=2026-08-05T00:00:00Z&dateTo=2026-08-01T00:00:00Z')).status, 400)

    const member = (await login('other-201@example.com', 'other-201-pw')).cookie
    assert.equal((await api('/admin/conversations', { cookie: member })).status, 403)
  })

  it('AC-05 / AC-09 停用、重置密码、改角色、改密码后旧 Session 立即 401（改密码保留当前）', async () => {
    const user = await createUser('c@example.com', 'c-password-1')
    const loginTwice = async (password: string) => [
      (await login('c@example.com', password)).cookie,
      (await login('c@example.com', password)).cookie,
    ]
    const statuses = async (cookies: string[]) => Promise.all(cookies.map(async cookie => (await api('/auth/me', { cookie })).status))

    // ① 停用
    let cookies = await loginTwice('c-password-1')
    assert.deepEqual(await statuses(cookies), [200, 200])
    assert.equal((await api(`/admin/users/${user.id}`, { method: 'PATCH', cookie: adminCookie, body: { status: 'DISABLED' } })).status, 200)
    assert.deepEqual(await statuses(cookies), [401, 401])
    assert.equal((await api(`/admin/users/${user.id}`, { method: 'PATCH', cookie: adminCookie, body: { status: 'ACTIVE' } })).status, 200)

    // ② 重置密码
    cookies = await loginTwice('c-password-1')
    secrets.add('c-temp-password')
    const reset = await api(`/admin/users/${user.id}/reset-password`, { method: 'POST', cookie: adminCookie, body: { password: 'c-temp-password' } })
    assert.equal(reset.status, 200)
    assert.equal(reset.body.data.mustChangePassword, true)
    assert.deepEqual(await statuses(cookies), [401, 401])

    // ③ 改角色
    cookies = await loginTwice('c-temp-password')
    assert.equal((await api(`/admin/users/${user.id}`, { method: 'PATCH', cookie: adminCookie, body: { role: 'ADMIN' } })).status, 200)
    assert.deepEqual(await statuses(cookies), [401, 401])
    assert.equal((await api(`/admin/users/${user.id}`, { method: 'PATCH', cookie: adminCookie, body: { role: 'MEMBER' } })).status, 200)

    // ④ 自己改密码：AC-09 先被 403 拦住，改完当前 Session 可用、另一处失效
    const [current, other] = await loginTwice('c-temp-password')
    const pending = await api('/conversations', { cookie: current! })
    assert.equal(pending.status, 403)
    assert.equal(pending.body.error?.error, 'PASSWORD_CHANGE_REQUIRED')
    assert.equal((await api('/auth/change-password', { method: 'POST', cookie: current!, body: { currentPassword: 'wrong-password', newPassword: 'c-final-password' } })).status, 400)
    secrets.add('c-final-password')
    const changed = await api('/auth/change-password', { method: 'POST', cookie: current!, body: { currentPassword: 'c-temp-password', newPassword: 'c-final-password' } })
    assert.equal(changed.status, 200)
    assert.equal(changed.body.data.mustChangePassword, false)
    assert.deepEqual(await statuses([current!, other!]), [200, 401])
    assert.equal((await api('/conversations', { cookie: current! })).status, 200)

    // 退出后当前 Session 也失效
    const logout = await api('/auth/logout', { method: 'POST', cookie: current! })
    assert.equal(logout.status, 200)
    assert.match(logout.setCookie!, /Max-Age=0/)
    assert.equal((await api('/auth/me', { cookie: current! })).status, 401)
  })

  it('AC-06 连续 5 次错误后正确密码也被拒，15 分钟后恢复；三种失败响应一致', async () => {
    const user = await createUser('d@example.com', 'd-password-1')
    const attempt = async (email: string, password: string) => {
      secrets.add(password)
      const result = await api('/auth/login', { method: 'POST', body: { email, password } })
      return { status: result.status, message: result.body.message, setCookie: result.setCookie }
    }
    const failure = { status: 401, message: LOGIN_FAILED_MESSAGE, setCookie: null }

    for (let index = 0; index < 5; index += 1)
      assert.deepEqual(await attempt('d@example.com', `wrong-password-${index}`), failure)

    assert.deepEqual(await attempt('d@example.com', 'd-password-1'), failure)
    const locked = await prisma.user.findUniqueOrThrow({ where: { id: user.id } })
    const lockMs = locked.lockedUntil!.getTime() - Date.now()
    assert.ok(lockMs > 14 * 60 * 1000 && lockMs <= 15 * 60 * 1000, `锁定时长 ${lockMs}ms`)

    // 模拟 15 分钟过去
    await prisma.user.update({ where: { id: user.id }, data: { lockedUntil: new Date(Date.now() - 1000) } })
    assert.equal((await attempt('d@example.com', 'd-password-1')).status, 200)

    await createUser('disabled@example.com', 'e-password-1')
    await prisma.user.update({ where: { email: 'disabled@example.com' }, data: { disabled: true } })
    assert.deepEqual(await attempt('nobody@example.com', 'whatever-pw'), failure)
    assert.deepEqual(await attempt('d@example.com', 'wrong-password'), failure)
    assert.deepEqual(await attempt('disabled@example.com', 'e-password-1'), failure)
  })

  it('AC-06 并发：scrypt 期间账号被锁，正确密码也拿不到 Session', async () => {
    const user = await createUser('race@example.com', 'race-password-1')
    // 模拟并发：本请求读到的是锁定前的快照，而库里其他请求已经把账号锁上。
    await prisma.user.update({ where: { id: user.id }, data: { lockedUntil: new Date(Date.now() + 60_000) } })
    const findUnique = vi.spyOn(prisma.user, 'findUnique').mockResolvedValueOnce(user as never)
    onTestFinished(() => findUnique.mockRestore())
    secrets.add('race-password-1')

    const result = await api('/auth/login', { method: 'POST', body: { email: 'race@example.com', password: 'race-password-1' } })

    assert.equal(result.status, 401)
    assert.equal(result.setCookie, null)
    assert.equal(await prisma.session.count({ where: { userId: user.id } }), 0)
  })

  it('并发登录超过上限时直接 429，不排队占满 scrypt 线程池', async () => {
    const attempts = await Promise.all(Array.from({ length: 4 }, (_, index) => {
      secrets.add(`flood-password-${index}`)
      return api('/auth/login', { method: 'POST', body: { email: 'nobody@example.com', password: `flood-password-${index}` } })
    }))
    const statuses = attempts.map(attempt => attempt.status).sort()

    assert.deepEqual(statuses, [401, 401, 429, 429])
    assert.ok(attempts.filter(attempt => attempt.status === 429).every(attempt => attempt.body.message === '登录繁忙，请稍后再试'))
  })

  it('改密码时原密码连错 5 次，该 Session 15 分钟内不再校验；外人触发的登录锁不影响本人改密码', async () => {
    const user = await createUser('f@example.com', 'f-password-1')
    const cookie = (await login('f@example.com', 'f-password-1')).cookie
    const change = (sessionCookie: string, currentPassword: string, newPassword: string) =>
      api('/auth/change-password', { method: 'POST', cookie: sessionCookie, body: { currentPassword, newPassword } })

    for (let index = 0; index < 5; index += 1)
      assert.equal((await change(cookie, `wrong-current-${index}`, 'f-password-2')).body.message, '当前密码错误')

    const blocked = await change(cookie, 'f-password-1', 'f-password-2')
    assert.equal(blocked.status, 400)
    assert.equal(blocked.body.message, '尝试次数过多，请 15 分钟后再试')
    // 改密码的失败不计入账号锁：换一个 Session 仍能登录、改密码
    assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).failedLoginCount, 0)

    const other = (await login('f@example.com', 'f-password-1')).cookie
    await prisma.user.update({ where: { id: user.id }, data: { lockedUntil: new Date(Date.now() + 60_000) } })
    secrets.add('f-password-2')
    assert.equal((await change(other, 'f-password-1', 'f-password-2')).status, 200)
  })

  it('AC-13 日志与全部响应体里搜不到明文密码与 token', () => {
    const haystack = [...logs, ...responseBodies].join('\n')

    assert.ok(secrets.size > 10)
    for (const secret of secrets)
      assert.ok(!haystack.includes(secret), `泄露：${secret.slice(0, 4)}…`)
  })
})

function withSearchPath(connectionString: string, schema: string): string {
  const url = new URL(connectionString)
  url.searchParams.set('schema', schema)
  url.searchParams.set('options', `-c search_path=${schema},public`)
  return url.toString()
}
