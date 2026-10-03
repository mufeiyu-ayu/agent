import type { Prisma } from '../generated/prisma/client.js'
import type { WorkspaceCloudService } from './workspace-cloud.service.js'
import type { WorkspaceMonitoringService } from './workspace-monitoring.service.js'
import assert from 'node:assert/strict'
import { BadRequestException, Logger, ServiceUnavailableException } from '@nestjs/common'
import { describe, it, onTestFinished, vi } from 'vitest'
import { DatabaseCommitOutcomeUnknownError, PrismaService } from '../prisma/prisma.service.js'
import { workspaceDb } from './workspace-db.js'
import { WorkspaceService } from './workspace.service.js'

describe('工作区获取与恢复', () => {
  it('首次归属查询使用有限事务，停止不被迟到查询卡住实例收尾', async () => {
    let queryStarted!: () => void
    const started = new Promise<void>((resolve) => {
      queryStarted = resolve
    })
    let finishQuery!: () => void
    const query = new Promise<null>((resolve) => {
      finishQuery = () => resolve(null)
    })
    const conversation = { findFirst: async () => {
      queryStarted()
      return query
    } }
    const transaction = vi.fn(async (callback: (db: Prisma.TransactionClient) => Promise<unknown>) => callback({ conversation, $queryRaw: async () => [] } as unknown as Prisma.TransactionClient))
    const prisma = {
      withDeadlineTransaction: PrismaService.prototype.withDeadlineTransaction,
      $transaction: transaction,
      conversation,
    } as unknown as PrismaService
    const cloud = { configured: true, create: vi.fn() } as unknown as WorkspaceCloudService
    const service = new WorkspaceService(prisma, cloud, {} as WorkspaceMonitoringService)
    const controller = new AbortController()
    const pending = service.fileOperation({ userId: 'u', conversationId: 'c', runId: 'r', deadlineAt: Date.now() + 60_000 }, { action: 'read' }, controller.signal)
    try {
      await started
      assert.equal(transaction.mock.calls.length, 1)
      controller.abort(new Error('stop during owner query'))
      await assert.rejects(pending, /stop during owner query/)
      await service.releaseRun('r')
      assert.equal(vi.mocked(cloud.create).mock.calls.length, 0)
    }
    finally {
      finishQuery()
      await pending.catch(() => {})
    }
  })

  it('COMMIT 已开始后取消不能覆盖成功结果；未知提交仍向调用方暴露', async () => {
    const controller = new AbortController()
    const prisma = {
      withDeadlineTransaction: PrismaService.prototype.withDeadlineTransaction,
      $transaction: async (callback: (db: Prisma.TransactionClient) => Promise<unknown>) => {
        const result = await callback({ $queryRaw: async () => [] } as unknown as Prisma.TransactionClient)
        controller.abort(new Error('late abort'))
        await new Promise(resolve => setTimeout(resolve, 10))
        return result
      },
    } as unknown as PrismaService
    assert.equal(await workspaceDb(prisma, async () => 'committed', controller.signal), 'committed')
    const unknown = { withDeadlineTransaction: async () => {
      throw new DatabaseCommitOutcomeUnknownError()
    } } as unknown as PrismaService
    await assert.rejects(workspaceDb(unknown, async () => 'unused'), /事务结果未知/)
  })

  it('下载拒绝非法路径；云 SDK 错误不泄露到响应与全局 stack 日志', async () => {
    const warning = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {})
    onTestFinished(() => warning.mockRestore())
    const file = { path: 'a.txt', bytes: 1, sha256: 'a'.repeat(64), key: `users/u/conversations/c/objects/${'a'.repeat(64)}` }
    const prisma = { conversation: { findFirst: async () => ({ id: 'c' }) }, conversationWorkspace: { findUnique: async () => ({ revision: 1, files: [file] }) } } as unknown as PrismaService
    const cloud = { readFile: async () => {
      throw new Error('SECRET_IN_SDK_ERROR')
    } } as unknown as WorkspaceCloudService
    const service = new WorkspaceService(prisma, cloud, {} as WorkspaceMonitoringService)
    await assert.rejects(service.savedFile('u', 'c', '../escape'), BadRequestException)
    await assert.rejects(service.savedFile('u', 'c', 'a.txt'), (error: unknown) => {
      assert.ok(error instanceof ServiceUnavailableException)
      assert.equal(`${error.message} ${error.stack}`.includes('SECRET_IN_SDK_ERROR'), false)
      return true
    })
    assert.equal(JSON.stringify(warning.mock.calls).includes('SECRET_IN_SDK_ERROR'), false)
  })

  it('临时占用解除后同一 Run 可以重试，不复用已拒绝的 Promise', async () => {
    let claims = 0
    let created = 0
    const row = { conversationId: 'c', userId: 'u', revision: 0, files: [] }
    const prisma = {
      withDeadlineTransaction: async (_deadline: unknown, callback: (transaction: { execute: (operation: (db: PrismaService) => Promise<unknown>) => Promise<unknown> }) => Promise<unknown>) => callback({ execute: operation => operation(prisma) }),
      conversation: { findFirst: async () => ({ id: 'c', title: '工作区' }) },
      conversationWorkspace: {
        upsert: async () => row,
        updateMany: async (input: { data: { state?: string } }) => ({ count: input.data.state === 'creating' && ++claims === 1 ? 0 : 1 }),
        findUniqueOrThrow: async () => row,
      },
    } as unknown as PrismaService
    const cloud = {
      configured: true,
      create: async () => {
        created++
        return { sandboxId: 'sandbox', kill: async () => true }
      },
      request: async () => ({ written: true }),
    } as unknown as WorkspaceCloudService
    const monitoring = { begin: async () => ({ id: 'history' }), created: async () => {}, released: async () => {}, unknown: async () => {} } as unknown as WorkspaceMonitoringService
    const service = new WorkspaceService(prisma, cloud, monitoring)
    const execution = { userId: 'u', conversationId: 'c', runId: 'r', deadlineAt: Date.now() + 10000 }
    const signal = new AbortController().signal
    await assert.rejects(service.fileOperation(execution, { action: 'write' }, signal), /正在执行另一项任务/)
    await service.fileOperation(execution, { action: 'write' }, signal)
    assert.equal(claims, 2)
    assert.equal(created, 1)
    await service.releaseRun('r')
  })
})
