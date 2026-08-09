/* eslint-disable perfectionist/sort-imports */
import 'reflect-metadata'

import type { INestApplication } from '@nestjs/common'
import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test
import { describe, it } from 'node:test'
import { Module, NotFoundException } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'

import { registerAppGlobals } from '../common/bootstrap/register-app-globals.js'
import { AdminRunsController } from './admin-runs.controller.js'
import { AdminRunsService } from './admin-runs.service.js'

describe('Admin Runs API', () => {
  it('GET /api/admin/runs 转换 query 并返回统一成功响应', async () => {
    let receivedQuery: unknown
    const service = {
      async list(query: unknown) {
        receivedQuery = query
        return {
          items: [],
          pagination: {
            page: 2,
            pageSize: 10,
            totalItems: 0,
            totalPages: 0,
          },
          summary: {
            totalRuns: 0,
            statusCounts: {
              RUNNING: 0,
              COMPLETED: 0,
              FAILED: 0,
              ABORTED: 0,
            },
          },
        }
      },
      async getDetail() {
        throw new Error('本测试不应读取详情')
      },
    }

    await withAdminRunsApp(service, async (baseUrl) => {
      const search = new URLSearchParams({
        page: '2',
        pageSize: '10',
        status: 'FAILED',
        query: '  audit  ',
        dateFrom: '2026-08-01T00:00:00.000Z',
        dateTo: '2026-08-09T08:00:00+08:00',
      })
      const response = await fetch(`${baseUrl}/api/admin/runs?${search}`)
      const payload = await response.json() as {
        success: boolean
        data: { pagination: { page: number } }
      }

      assert.equal(response.status, 200)
      assert.equal(payload.success, true)
      assert.equal(payload.data.pagination.page, 2)
      assert.equal((receivedQuery as { page?: number }).page, 2)
      assert.equal((receivedQuery as { pageSize?: number }).pageSize, 10)
      assert.equal((receivedQuery as { status?: string }).status, 'FAILED')
      assert.equal((receivedQuery as { query?: string }).query, 'audit')
      assert.equal(
        (receivedQuery as { dateFrom?: string }).dateFrom,
        '2026-08-01T00:00:00.000Z',
      )
      assert.equal(
        (receivedQuery as { dateTo?: string }).dateTo,
        '2026-08-09T08:00:00+08:00',
      )
    })
  })

  it('非法 status / page / pageSize / timestamp / 额外参数返回 400', async () => {
    const service = {
      async list() {
        throw new Error('非法 query 不应进入 service')
      },
      async getDetail() {
        throw new Error('本测试不应读取详情')
      },
    }

    await withAdminRunsApp(service, async (baseUrl) => {
      const invalidQueries = [
        'status=PENDING',
        'page=0',
        'page=1.5',
        'page=1000001',
        'pageSize=51',
        'query=%20%20',
        'dateFrom=2026-08-01',
        'dateFrom=2026-02-31T00:00:00Z',
        'dateFrom=2026-12-31T23:59:60Z',
        'sort=createdAt',
      ]

      for (const query of invalidQueries) {
        const response = await fetch(`${baseUrl}/api/admin/runs?${query}`)
        const payload = await response.json() as { code: number, success: boolean }

        assert.equal(response.status, 400, query)
        assert.equal(payload.success, false, query)
        assert.equal(payload.code, 400, query)
      }
    })
  })

  it('GET /api/admin/runs/:runId 保留标准 404', async () => {
    const service = {
      async list() {
        throw new Error('本测试不应读取列表')
      },
      async getDetail() {
        throw new NotFoundException('Agent Run 不存在或已被删除')
      },
    }

    await withAdminRunsApp(service, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/admin/runs/missing-run`)
      const payload = await response.json() as { code: number, success: boolean }

      assert.equal(response.status, 404)
      assert.equal(payload.success, false)
      assert.equal(payload.code, 404)
    })
  })
})

async function withAdminRunsApp(
  service: Pick<AdminRunsService, 'getDetail' | 'list'>,
  run: (baseUrl: string) => Promise<void>,
): Promise<void> {
  @Module({
    controllers: [AdminRunsController],
    providers: [
      {
        provide: AdminRunsService,
        useValue: service,
      },
    ],
  })
  class TestAdminRunsModule {}

  const app: INestApplication = await NestFactory.create(TestAdminRunsModule, {
    logger: false,
  })
  registerAppGlobals(app)
  await app.listen(0, '127.0.0.1')

  try {
    await run(await app.getUrl())
  }
  finally {
    await app.close()
  }
}
