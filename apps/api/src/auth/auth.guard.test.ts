/* eslint-disable perfectionist/sort-imports */
import 'reflect-metadata'

import type { AuthUser } from '@agent/contracts'
import type { INestApplication } from '@nestjs/common'
import type { AuthContext } from './auth.decorators.js'
import assert from 'node:assert/strict'
import { afterAll, beforeAll, describe, it } from 'vitest'
import { Controller, Get, Module } from '@nestjs/common'
import { APP_GUARD, NestFactory } from '@nestjs/core'

import { AdminRunsController } from '../admin-runs/admin-runs.controller.js'
import { AdminRunsService } from '../admin-runs/admin-runs.service.js'
import { AppController } from '../app.controller.js'
import { ChatController } from '../chat/chat.controller.js'
import { ChatService } from '../chat/chat.service.js'
import { registerAppGlobals } from '../common/bootstrap/register-app-globals.js'
import { ConversationsController } from '../conversations/conversations.controller.js'
import { ConversationsService } from '../conversations/conversations.service.js'
import { LlmModelConfigService } from '../llm/llm-model-config.service.js'
import { LLMController } from '../llm/llm.controller.js'
import { LLMService } from '../llm/llm.service.js'
import { AuthController } from './auth.controller.js'
import { AuthGuard } from './auth.guard.js'
import { AuthService } from './auth.service.js'

// 没有任何标记的 Controller：证明是全局默认拦截，而不是逐个加 Guard。
@Controller('probe')
class ProbeController {
  @Get()
  get() {
    return { reached: true }
  }
}

@Controller('admin/probe')
class AdminProbeController {
  @Get()
  get() {
    return { reached: true }
  }
}

const ALLOWED_ORIGIN = 'http://localhost:5173'
const SESSIONS: Record<string, AuthUser> = {
  'member-token': { id: 'member', email: 'member@example.com', name: null, avatarUrl: null, role: 'MEMBER', mustChangePassword: false },
  'admin-token': { id: 'admin', email: 'admin@example.com', name: null, avatarUrl: null, role: 'ADMIN', mustChangePassword: false },
  'pending-token': { id: 'pending', email: 'pending@example.com', name: null, avatarUrl: null, role: 'MEMBER', mustChangePassword: true },
}

const authService = {
  async authenticate(token: string): Promise<AuthContext | null> {
    const user = SESSIONS[token]
    return user ? { user, sessionId: `session-${user.id}` } : null
  },
  async login() {
    return { user: SESSIONS['member-token'], token: 'member-token' }
  },
}

describe('AuthGuard（全局默认拦截）', () => {
  let app: INestApplication
  let baseUrl: string

  beforeAll(async () => {
    @Module({
      controllers: [
        AppController,
        AuthController,
        ProbeController,
        AdminProbeController,
        ConversationsController,
        ChatController,
        LLMController,
        AdminRunsController,
      ],
      providers: [
        { provide: APP_GUARD, useClass: AuthGuard },
        { provide: AuthService, useValue: authService },
        // 被拦下的请求到不了 service；放行的只用到 list。
        { provide: ConversationsService, useValue: {} },
        { provide: ChatService, useValue: {} },
        { provide: LLMService, useValue: {} },
        { provide: LlmModelConfigService, useValue: {} },
        { provide: AdminRunsService, useValue: { list: async () => ({ items: [] }) } },
      ],
    })
    class TestModule {}

    app = await NestFactory.create(TestModule, { logger: false })
    registerAppGlobals(app)
    await app.listen(0, '127.0.0.1')
    baseUrl = await app.getUrl()
  })

  afterAll(async () => {
    await app.close()
  })

  function request(path: string, options: { method?: string, token?: string, origin?: string, body?: unknown } = {}) {
    return fetch(`${baseUrl}/api${path}`, {
      method: options.method ?? 'GET',
      headers: {
        'content-type': 'application/json',
        ...(options.token ? { cookie: `agent_session=${options.token}` } : {}),
        ...(options.origin ? { origin: options.origin } : {}),
      },
      ...(options.body ? { body: JSON.stringify(options.body) } : {}),
    })
  }

  it('AC-01 未登录请求业务接口一律 401；health 与 login 可访问', async () => {
    const blocked = await Promise.all([
      request('/conversations'),
      request('/chat/stream', { method: 'POST', origin: ALLOWED_ORIGIN, body: { conversationId: 'c', message: 'hi' } }),
      request('/llm/models'),
      request('/admin/runs'),
      request('/auth/me'),
      request('/probe', { token: 'forged-token' }),
    ])

    assert.deepEqual(blocked.map(response => response.status), [401, 401, 401, 401, 401, 401])
    assert.equal((await request('/health')).status, 200)
    assert.equal((await request('/auth/login', {
      method: 'POST',
      origin: ALLOWED_ORIGIN,
      body: { email: 'member@example.com', password: 'whatever-password' },
    })).status, 200)
  })

  it('AC-02 新加的未标记 Controller 默认要求登录，登录后可访问', async () => {
    assert.equal((await request('/probe')).status, 401)
    assert.equal((await request('/probe', { token: 'member-token' })).status, 200)
  })

  it('AC-04 成员访问 admin/* 返回 403（含新加的 admin Controller），管理员放行', async () => {
    assert.equal((await request('/admin/runs', { token: 'member-token' })).status, 403)
    assert.equal((await request('/admin/probe', { token: 'member-token' })).status, 403)
    assert.equal((await request('/admin/runs', { token: 'admin-token' })).status, 200)
    assert.equal((await request('/admin/probe', { token: 'admin-token' })).status, 200)
  })

  it('AC-07 写请求的 Origin 不在白名单（含缺失）时 403，白名单内放行', async () => {
    const body = { email: 'member@example.com', password: 'whatever-password' }

    assert.equal((await request('/auth/login', { method: 'POST', origin: 'https://evil.example', body })).status, 403)
    assert.equal((await request('/auth/login', { method: 'POST', body })).status, 403)
    assert.equal((await request('/auth/login', { method: 'POST', origin: 'http://localhost:5174', body })).status, 200)
    // 已登录也挡：Origin 校验在登录判断之前。
    assert.equal((await request('/conversations', { method: 'POST', token: 'member-token', origin: 'https://evil.example', body: {} })).status, 403)
  })

  it('AC-09 必须改密码时，除 me / change-password / logout 外返回可识别的 403', async () => {
    const blocked = await request('/probe', { token: 'pending-token' })
    const payload = await blocked.json() as { error: { error: string } }

    assert.equal(blocked.status, 403)
    assert.equal(payload.error.error, 'PASSWORD_CHANGE_REQUIRED')
    assert.equal((await request('/auth/me', { token: 'pending-token' })).status, 200)
  })
})
