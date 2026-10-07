import type { Prisma } from '../generated/prisma/client.js'
import type { WorkspaceCloudService } from './workspace-cloud.service.js'
import type { WorkspaceGcService } from './workspace-gc.service.js'
import type { WorkspaceMonitoringService } from './workspace-monitoring.service.js'
import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { BadRequestException, Logger, ServiceUnavailableException } from '@nestjs/common'
import { describe, it, onTestFinished, vi } from 'vitest'
import { DatabaseCommitOutcomeUnknownError, PrismaService } from '../prisma/prisma.service.js'
import { sourceZip } from './workspace-archive.js'
import { workspaceDb } from './workspace-db.js'
import { fileHash } from './workspace-files.js'
import { WorkspaceService } from './workspace.service.js'

describe('工作区获取与恢复', () => {
  it('旧已确认的百分号、tmp 和 dist HTML 不使整份清单失效，未配置沙箱仍能读取/归档', async () => {
    const content = Buffer.from('<html><body>legacy</body></html>')
    const files = ['report%.html', 'tmp/page.html', 'dist/index.html'].map(path => ({ path, bytes: content.length, sha256: 'a'.repeat(64), key: `users/u/conversations/c/objects/${'a'.repeat(64)}` }))
    const row = { revision: 1, files, updatedAt: new Date(), state: 'idle' }
    const prisma = { conversation: { findFirst: async () => ({ id: 'c' }) }, conversationWorkspace: { findUnique: async () => row } } as unknown as PrismaService
    const cloud = { configured: false, readFile: async () => content, create: () => {
      throw new Error('只读不能创建沙箱')
    } } as unknown as WorkspaceCloudService
    const service = new WorkspaceService(prisma, cloud, {} as WorkspaceMonitoringService)
    assert.deepEqual((await service.snapshot('u', 'c')).files.map(file => file.path), files.map(file => file.path))
    for (const path of files.map(file => file.path))
      assert.deepEqual(await service.savedFile('u', 'c', path, 1), content)
    assert.ok((await service.archive('u', 'c', 1, new AbortController().signal)).length > content.length)
    await assert.rejects(service.savedFile('u', 'c', '../other/index.html'))
  })

  it('完整 ZIP 有界并发读取但保持固定清单顺序；一个读取失败取消剩余任务', async () => {
    const source = Array.from({ length: 8 }, (_, index) => ({ path: `${index}.txt`, content: Buffer.from(`file ${index}`) }))
    const files = source.map(file => ({ path: file.path, bytes: file.content.length, sha256: fileHash(file.content), key: `users/u/conversations/c/objects/${fileHash(file.content)}` }))
    const prisma = { conversation: { findFirst: async () => ({ id: 'c' }) }, conversationWorkspace: { findUnique: async () => ({ revision: 1, files }) } } as unknown as PrismaService
    let active = 0
    let maximum = 0
    const read = vi.fn(async (file: { path: string }, signal: AbortSignal) => {
      active++
      maximum = Math.max(maximum, active)
      await new Promise(resolve => setTimeout(resolve, file.path === '0.txt' ? 10 : 1))
      active--
      signal.throwIfAborted()
      return source.find(item => item.path === file.path)!.content
    })
    const cloud = { readFile: read } as unknown as WorkspaceCloudService
    const service = new WorkspaceService(prisma, cloud, {} as WorkspaceMonitoringService)
    assert.deepEqual(await service.archive('u', 'c', 1, new AbortController().signal), sourceZip(source))
    assert.equal(maximum, 4)
    read.mockImplementation(async (_file, signal) => {
      if (_file.path === '1.txt')
        throw new Error('injected storage failure')
      await new Promise(resolve => setTimeout(resolve, 5))
      signal.throwIfAborted()
      return Buffer.from('unused')
    })
    await assert.rejects(service.archive('u', 'c', 1, new AbortController().signal), /源码归档读取失败/)
    assert.ok(read.mock.calls.slice(8).every(call => call[1].aborted))
  })

  it('OSS 恢复采用四路读取、同 SHA 去重并保持顺序；失败/取消不发送半份 restore', async () => {
    const source = Array.from({ length: 8 }, (_, index) => ({ path: `${index}.txt`, content: Buffer.from(`source ${index}`) }))
    source.push({ path: 'duplicate.txt', content: source[0]!.content })
    const files = source.map(file => ({ path: file.path, bytes: file.content.length, sha256: fileHash(file.content), key: `users/u/conversations/c/objects/${fileHash(file.content)}` }))
    const row = { conversationId: 'c', userId: 'u', revision: 1, files }
    const prisma = {
      $executeRaw: async () => 1,
      workspaceGcTarget: { findUnique: async () => null },
      withDeadlineTransaction: async (_deadline: unknown, callback: (transaction: { execute: (operation: (db: PrismaService) => Promise<unknown>) => Promise<unknown> }) => Promise<unknown>) => callback({ execute: operation => operation(prisma) }),
      conversation: { findFirst: async () => ({ id: 'c', title: 'OSS 恢复' }) },
      conversationWorkspace: { upsert: async () => row, updateMany: async () => ({ count: 1 }), findUniqueOrThrow: async () => row },
    } as unknown as PrismaService
    let active = 0
    let maximum = 0
    const read = vi.fn(async (file: { path: string }, signal: AbortSignal) => {
      active++
      maximum = Math.max(maximum, active)
      try {
        await new Promise(resolve => setTimeout(resolve, 20))
        signal.throwIfAborted()
        return source.find(item => item.path === file.path)!.content
      }
      finally { active-- }
    })
    const request = vi.fn(async (_sandbox: unknown, _script: string, input: { action: string }) => input)
    const kill = vi.fn(async () => true)
    const cloud = { configured: true, readFile: read, create: async () => ({ sandboxId: 'sandbox', kill }), request } as unknown as WorkspaceCloudService
    const monitoring = { begin: async () => ({}), created: async () => {}, released: async () => {}, unknown: async () => {} } as unknown as WorkspaceMonitoringService
    const service = new WorkspaceService(prisma, cloud, monitoring)
    const execution = { userId: 'u', conversationId: 'c', runId: 'r', deadlineAt: Date.now() + 60000 }
    const serialStart = performance.now()
    for (const file of files.slice(0, 8))
      await read(file, new AbortController().signal)
    const serialMs = performance.now() - serialStart
    read.mockClear()
    maximum = 0
    const parallelStart = performance.now()
    await service.fileOperation(execution, { action: 'read' }, new AbortController().signal)
    console.log('OSS restore controlled latency:', JSON.stringify({ uniqueObjects: 8, latencyPerGetMs: 20, serialMs: Math.round(serialMs), restoreMs: Math.round(performance.now() - parallelStart), peakReads: maximum, getCount: read.mock.calls.length }))
    assert.equal(maximum, 4, '8 个独立对象从 8 个串行等待改为 2 批，最多四路')
    assert.equal(read.mock.calls.length, 8, '9 条路径的重复 SHA 不增加 GET')
    const restored = request.mock.calls[0]![2] as unknown as { files: Array<{ path: string, content: string }> }
    assert.deepEqual(restored.files, source.map(file => ({ path: file.path, content: file.content.toString('base64') })))
    await service.releaseRun('r')
    const restores = request.mock.calls.filter(call => call[2].action === 'restore').length
    read.mockImplementation(async (file, signal) => {
      if (file.path === '1.txt')
        throw new Error('injected OSS read failure')
      await new Promise(resolve => setTimeout(resolve, 20))
      signal.throwIfAborted()
      return Buffer.from('unused')
    })
    await assert.rejects(service.fileOperation(execution, { action: 'read' }, new AbortController().signal), /injected OSS read failure/)
    assert.equal(request.mock.calls.filter(call => call[2].action === 'restore').length, restores)
    assert.ok(read.mock.calls.slice(8).every(call => call[1].aborted))
    const controller = new AbortController()
    read.mockImplementation(async (_file, signal) => {
      controller.abort(new Error('cancel restore'))
      signal.throwIfAborted()
      return Buffer.from('unused')
    })
    await assert.rejects(service.fileOperation(execution, { action: 'read' }, controller.signal), /cancel restore/)
    assert.equal(request.mock.calls.filter(call => call[2].action === 'restore').length, restores)
    assert.ok(kill.mock.calls.length >= 3)
    await service.onModuleDestroy()
  })

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

  it('D1：Artifact 查询在途取消不阻塞 prepareCommit，上传登记仍收尾且不启动 PUT', async () => {
    const row = { files: [], revision: 0, artifactId: 'current-artifact' }
    let started!: () => void
    const querying = new Promise<void>(resolve => started = resolve)
    let finish!: () => void
    const hold = new Promise<null>(resolve => finish = () => resolve(null))
    const prisma = {
      withDeadlineTransaction: PrismaService.prototype.withDeadlineTransaction,
      $transaction: async (callback: (db: Prisma.TransactionClient) => Promise<unknown>) => callback(prisma),
      $queryRaw: async () => [],
      $executeRaw: async () => 1,
      workspaceGcTarget: { findUnique: async () => null },
      conversation: { findFirst: async () => ({ id: 'c', title: 'fixture' }) },
      conversationWorkspace: { upsert: async () => row, updateMany: async () => ({ count: 1 }), findUniqueOrThrow: async () => row },
      workspaceArtifact: { findFirst: async () => {
        started()
        return hold
      } },
    } as unknown as PrismaService
    const cloud = { configured: true, create: async () => ({ sandboxId: 'sandbox', kill: async () => true }), request: async () => ({}), putFile: vi.fn() } as unknown as WorkspaceCloudService
    const finishUpload = vi.fn(async () => {})
    const gc = { waitForDeletion: async () => {}, beginUpload: async () => 'upload', finishUpload, afterRun: async () => {} } as unknown as WorkspaceGcService
    const monitoring = { begin: async () => ({}), created: async () => {}, released: async () => {}, unknown: async () => {} } as unknown as WorkspaceMonitoringService
    const service = new WorkspaceService(prisma, cloud, monitoring, gc)
    const execution = { userId: 'u', conversationId: 'c', runId: 'r', deadlineAt: Date.now() + 60000 }
    const controller = new AbortController()
    await service.fileOperation(execution, { action: 'read' }, controller.signal)
    const pending = service.prepareCommit(execution, controller.signal)
    try {
      await querying
      controller.abort(new Error('stop Artifact query'))
      await assert.rejects(pending, /stop Artifact query/)
      assert.deepEqual(finishUpload.mock.calls, [['upload', false]])
      assert.equal(vi.mocked(cloud.putFile).mock.calls.length, 0)
    }
    finally {
      finish()
      await service.releaseRun('r')
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
      $executeRaw: async () => 1,
      workspaceGcTarget: { findUnique: async () => null },
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
