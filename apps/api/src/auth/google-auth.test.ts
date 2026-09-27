/* eslint-disable perfectionist/sort-imports */
import 'reflect-metadata'

import type { INestApplication } from '@nestjs/common'
import assert from 'node:assert/strict'
import process from 'node:process'
import { afterAll, beforeAll, describe, it } from 'vitest'
import { Module } from '@nestjs/common'
import { APP_GUARD, NestFactory } from '@nestjs/core'

import { registerAppGlobals } from '../common/bootstrap/register-app-globals.js'
import { PrismaService } from '../prisma/prisma.service.js'
import { AuthGuard } from './auth.guard.js'
import { AuthService } from './auth.service.js'
import { GoogleAuthController } from './google-auth.controller.js'
import { GoogleAuthService } from './google-auth.service.js'

describe('Google 登录未配置时整体关闭（AC-08）', () => {
  const env = { ...process.env }
  let app: INestApplication
  let baseUrl: string

  beforeAll(async () => {
    delete process.env.GOOGLE_OAUTH_CLIENT_ID
    process.env.GOOGLE_OAUTH_CLIENT_SECRET = 'only-secret-is-not-enough'

    @Module({
      controllers: [GoogleAuthController],
      providers: [
        { provide: APP_GUARD, useClass: AuthGuard },
        // 关闭时到不了库与 Session。
        { provide: PrismaService, useValue: {} },
        { provide: AuthService, useValue: {} },
        GoogleAuthService,
      ],
    })
    class TestModule {}

    app = await NestFactory.create(TestModule, { logger: false })
    registerAppGlobals(app)
    await app.listen(0, '127.0.0.1')
    baseUrl = await app.getUrl()
  })

  afterAll(async () => {
    process.env = env
    await app.close()
  })

  it('config 返回 null，/api/auth/google/* 一律 404', async () => {
    const post = { method: 'POST', headers: { 'content-type': 'application/json', 'origin': 'http://localhost:5173' } }
    const config = await (await fetch(`${baseUrl}/api/auth/config`)).json() as { data: unknown }
    const statuses = await Promise.all([
      fetch(`${baseUrl}/api/auth/google/start`, { redirect: 'manual' }),
      fetch(`${baseUrl}/api/auth/google/callback?code=c&state=s`, { redirect: 'manual' }),
      fetch(`${baseUrl}/api/auth/google/one-tap/nonce`, post),
      fetch(`${baseUrl}/api/auth/google/one-tap`, { ...post, body: JSON.stringify({ credential: 'x' }) }),
    ].map(async response => (await response).status))

    assert.deepEqual(config.data, { googleClientId: null })
    assert.deepEqual(statuses, [404, 404, 404, 404])
  })
})
