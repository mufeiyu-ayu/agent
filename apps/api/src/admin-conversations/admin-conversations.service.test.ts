import type { PrismaService } from '../prisma/prisma.service.js'
import assert from 'node:assert/strict'
// 项目使用 Node 原生测试运行器，不为 Admin 查询引入额外测试框架。
// eslint-disable-next-line test/no-import-node-test
import { describe, it } from 'node:test'
import { NotFoundException } from '@nestjs/common'

import { AdminConversationsService } from './admin-conversations.service.js'

const LONG_CONTENT = '长'.repeat(1_200)

describe('AdminConversationsService', () => {
  it('列表按 updatedAt DESC, id DESC 分页，并映射消息数 / run 数', async () => {
    const harness = createHarness()

    const response = await harness.service.list({ page: 2, pageSize: 5 })

    assert.deepEqual(harness.calls.findMany[0]?.orderBy, [
      { updatedAt: 'desc' },
      { id: 'desc' },
    ])
    assert.equal(harness.calls.findMany[0]?.skip, 5)
    assert.equal(harness.calls.findMany[0]?.take, 5)
    assert.deepEqual(response.items[0], {
      id: 'conv-1',
      title: '测试会话',
      messageCount: 2,
      runCount: 3,
      createdAt: '2026-08-22T08:00:00.000Z',
      updatedAt: '2026-08-22T09:00:00.000Z',
    })
    assert.deepEqual(response.pagination, {
      page: 2,
      pageSize: 5,
      totalItems: 6,
      totalPages: 2,
    })
  })

  it('详情按 createdAt ASC 返回完整消息内容，不做 500 字截断', async () => {
    const harness = createHarness()

    const detail = await harness.service.getDetail('conv-1')
    const orderBy = (harness.calls.findUnique[0]?.select as {
      messages?: { orderBy?: Array<Record<string, string>> }
    }).messages?.orderBy

    assert.deepEqual(orderBy, [
      { createdAt: 'asc' },
      { id: 'asc' },
    ])
    assert.equal(detail.runCount, 3)
    assert.equal(detail.messages.length, 2)
    assert.equal(detail.messages[1]?.content, LONG_CONTENT)
    assert.equal(detail.messages[1]?.content.length, 1_200)
  })

  it('详情查询只投影用户可见 Message 字段，不触碰 AgentStep / 工具数据', async () => {
    const harness = createHarness()

    await harness.service.getDetail('conv-1')

    const messageSelect = (harness.calls.findUnique[0]?.select as {
      messages?: { select?: Record<string, boolean> }
    }).messages?.select

    assert.deepEqual(Object.keys(messageSelect ?? {}).sort(), [
      'content',
      'createdAt',
      'id',
      'role',
      'status',
    ])
  })

  it('会话不存在时抛出 NotFoundException', async () => {
    const harness = createHarness({ detail: null })

    await assert.rejects(
      harness.service.getDetail('missing'),
      NotFoundException,
    )
  })
})

function createHarness(options: { detail?: null } = {}) {
  const calls = {
    findMany: [] as Array<Record<string, unknown>>,
    findUnique: [] as Array<Record<string, unknown>>,
  }
  const listRecord = {
    id: 'conv-1',
    title: '测试会话',
    createdAt: new Date('2026-08-22T08:00:00.000Z'),
    updatedAt: new Date('2026-08-22T09:00:00.000Z'),
    _count: { messages: 2, agentRuns: 3 },
  }
  const detailRecord = {
    ...listRecord,
    messages: [
      {
        id: 'msg-1',
        role: 'USER',
        status: 'COMPLETED',
        content: '你好',
        createdAt: new Date('2026-08-22T08:00:01.000Z'),
      },
      {
        id: 'msg-2',
        role: 'ASSISTANT',
        status: 'COMPLETED',
        content: LONG_CONTENT,
        createdAt: new Date('2026-08-22T08:00:02.000Z'),
      },
    ],
  }
  const prisma = {
    conversation: {
      async findMany(args: Record<string, unknown>) {
        calls.findMany.push(args)
        return [listRecord]
      },
      async count() {
        return 6
      },
      async findUnique(args: Record<string, unknown>) {
        calls.findUnique.push(args)
        return options.detail === undefined ? detailRecord : options.detail
      },
    },
  } as unknown as PrismaService

  return {
    calls,
    service: new AdminConversationsService(prisma),
  }
}
