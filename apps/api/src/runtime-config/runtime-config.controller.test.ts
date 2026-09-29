/* eslint-disable perfectionist/sort-imports */
import 'reflect-metadata'

import type { AdminRuntimeConfig } from '@agent/contracts'
import type { INestApplication } from '@nestjs/common'
import type { UpdateRuntimeConfigDto } from './dto/update-runtime-config.dto.js'
import assert from 'node:assert/strict'
import { describe, it } from 'vitest'
import { Module } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'

import { registerAppGlobals } from '../common/bootstrap/register-app-globals.js'
import { RuntimeConfigController } from './runtime-config.controller.js'
import { RuntimeConfigService } from './runtime-config.service.js'

describe('PATCH /api/admin/runtime-config', () => {
  it('范围内的值原样交给 service；Key 去首尾空白', async () => {
    const service = createService()

    await withApp(service, async (baseUrl) => {
      const response = await patch(baseUrl, {
        maxSamplingRounds: 1,
        maxToolCalls: 0,
        runDeadlineMs: 2_147_483_647,
        historyCandidateHardLimit: 50,
        debugCaptureModelIo: true,
        serperApiKey: '  sk-serper  ',
      })

      assert.equal(response.status, 200)
    })
    assert.deepEqual(service.updates, [{
      maxSamplingRounds: 1,
      maxToolCalls: 0,
      runDeadlineMs: 2_147_483_647,
      historyCandidateHardLimit: 50,
      debugCaptureModelIo: true,
      serperApiKey: 'sk-serper',
    }])
  })

  it('超出范围、非整数、null、字符串形式的数字与开关、Key 过长或多出字段时返回 400，不进 service', async () => {
    const service = createService()
    const invalidBodies = [
      { maxSamplingRounds: 0 },
      { maxSamplingRounds: 2_147_483_648 },
      { maxToolCalls: -1 },
      { runDeadlineMs: 0 },
      { runDeadlineMs: 2_147_483_648 },
      { historyCandidateHardLimit: 49 },
      { historyCandidateHardLimit: 1_001 },
      { maxSamplingRounds: 1.5 },
      { serperApiKey: 'x'.repeat(513) },
      // 列都是 NOT NULL；隐式转换会把这些字符串变成 true / 0 / 3，必须按原值拒掉。
      { maxToolCalls: null },
      { debugCaptureModelIo: null },
      { debugCaptureModelIo: 'false' },
      { maxToolCalls: '' },
      { maxToolCalls: '3' },
      { serperApiKey: true },
      { serperApiKey: 12345 },
      { serperApiKeyLast4: 'abcd' },
    ]

    await withApp(service, async (baseUrl) => {
      for (const body of invalidBodies) {
        const response = await patch(baseUrl, body)

        assert.equal(response.status, 400, JSON.stringify(body))
      }
    })
    assert.deepEqual(service.updates, [])
  })
})

const CONFIG: AdminRuntimeConfig = {
  maxSamplingRounds: 10,
  maxToolCalls: 8,
  runDeadlineMs: 600_000,
  historyCandidateHardLimit: 1_000,
  debugCaptureModelIo: false,
  serperApiKeyLast4: null,
  updatedAt: '2026-09-29T00:00:00.000Z',
}

function createService() {
  const updates: UpdateRuntimeConfigDto[] = []

  return {
    updates,
    getForAdmin: async () => CONFIG,
    update: async (input: UpdateRuntimeConfigDto) => {
      updates.push({ ...input })
      return CONFIG
    },
  }
}

function patch(baseUrl: string, body: unknown): Promise<Response> {
  return fetch(`${baseUrl}/api/admin/runtime-config`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

async function withApp(
  service: Pick<RuntimeConfigService, 'getForAdmin' | 'update'>,
  run: (baseUrl: string) => Promise<void>,
): Promise<void> {
  @Module({
    controllers: [RuntimeConfigController],
    providers: [{ provide: RuntimeConfigService, useValue: service }],
  })
  class TestRuntimeConfigModule {}

  const app: INestApplication = await NestFactory.create(TestRuntimeConfigModule, { logger: false })
  registerAppGlobals(app)
  await app.listen(0, '127.0.0.1')

  try {
    await run(await app.getUrl())
  }
  finally {
    await app.close()
  }
}
