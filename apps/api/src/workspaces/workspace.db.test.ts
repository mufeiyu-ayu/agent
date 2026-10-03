import type { WorkspaceCloudService } from './workspace-cloud.service.js'
import type { WorkspaceCommit } from './workspace-files.js'
import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { randomUUID } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import process from 'node:process'
import { afterAll, beforeAll, describe, it, vi } from 'vitest'
import { AgentRunRecorderService } from '../agent-runtime/lifecycle/agent-run-recorder.service.js'
import { AgentStepStatus } from '../generated/prisma/client.js'
import { DatabaseCommitOutcomeUnknownError, PrismaService } from '../prisma/prisma.service.js'
import { WorkspaceOperationError } from './workspace-files.js'
import { WorkspaceMonitoringService } from './workspace-monitoring.service.js'
import { WorkspaceService } from './workspace.service.js'

const url = process.env.TEST_DATABASE_URL?.trim()
if (!url || url === process.env.DATABASE_URL?.trim())
  throw new Error('工作区真实库验收只允许独立 TEST_DATABASE_URL')

const { Pool } = createRequire(import.meta.url)('pg') as {
  Pool: new (options: { connectionString: string }) => {
    query: (sql: string, values?: unknown[]) => Promise<unknown>
    connect: () => Promise<{ query: (sql: string, values?: unknown[]) => Promise<unknown>, release: () => void }>
    end: () => Promise<void>
  }
}

describe('工作文件 PostgreSQL 确认边界', () => {
  const schema = `workspace_test_${randomUUID().replaceAll('-', '')}`
  const pool = new Pool({ connectionString: url })
  let prisma: PrismaService
  let recorder: AgentRunRecorderService

  beforeAll(async () => {
    const client = await pool.connect()
    try {
      await client.query(`CREATE SCHEMA "${schema}"`)
      await client.query('SELECT set_config(\'search_path\', $1, false)', [`${schema},public`])
      const directory = new URL('../../../../prisma/migrations/', import.meta.url)
      for (const migration of (await readdir(directory)).sort()) {
        if (migration !== 'migration_lock.toml')
          await client.query(await readFile(new URL(`${migration}/migration.sql`, directory), 'utf8'))
      }
    }
    finally { client.release() }
    const scoped = new URL(url)
    scoped.searchParams.set('schema', schema)
    scoped.searchParams.set('options', `-c search_path=${schema},public`)
    prisma = new PrismaService(scoped.toString())
    await prisma.$connect()
    recorder = new AgentRunRecorderService(prisma)
  })

  afterAll(async () => {
    await prisma?.$disconnect()
    await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
    await pool.end()
  })

  async function seed() {
    const user = await prisma.user.create({ data: { email: `${randomUUID()}@example.test` } })
    const conversation = await prisma.conversation.create({ data: { title: '工作文件确认测试', userId: user.id } })
    const message = await prisma.message.create({ data: { conversationId: conversation.id, role: 'USER', content: '生成文件' } })
    const run = await prisma.agentRun.create({ data: { conversationId: conversation.id, userMessageId: message.id } })
    const step = await prisma.agentStep.create({ data: { runId: run.id, sequence: 1, type: 'tool_execution', title: '执行工具', status: AgentStepStatus.RUNNING } })
    await prisma.conversationWorkspace.create({ data: { conversationId: conversation.id, userId: user.id, ownerRunId: run.id, leaseExpiresAt: new Date(Date.now() + 60000) } })
    const commit: WorkspaceCommit = { conversationId: conversation.id, runId: run.id, expectedRevision: 0, files: [{ path: 'index.html', bytes: 1, sha256: 'a'.repeat(64), key: `users/${user.id}/conversations/${conversation.id}/objects/${'a'.repeat(64)}` }] }
    return { user, conversation, run, step, commit }
  }

  const deadline = () => ({ deadlineAt: Date.now() + 5000, signal: new AbortController().signal, createTimeoutError: () => new Error('测试超时') })

  it('最新文件引用和工具结果同事务确认', async () => {
    const fixture = await seed()
    await recorder.completeStep(fixture.step.id, deadline(), { workspaceCommit: fixture.commit, output: { ok: true, observation: '已保存' } })
    const row = await prisma.conversationWorkspace.findUniqueOrThrow({ where: { conversationId: fixture.conversation.id } })
    assert.equal(row.revision, 1)
    assert.deepEqual(row.files, fixture.commit.files)
    const step = await prisma.agentStep.findUniqueOrThrow({ where: { id: fixture.step.id } })
    assert.equal(step.status, AgentStepStatus.COMPLETED)
  })

  it('文件事务开始 COMMIT 后保留真实确认；晚到停止不伪装成回滚，丢失响应仍暴露未知', async () => {
    for (const loseResponse of [false, true]) {
      const fixture = await seed()
      const controller = new AbortController()
      const transaction = prisma.$transaction.bind(prisma)
      // 数据库真实提交成功，模拟驱动延迟或丢失响应；停止发生在 COMMIT 开始之后。
      const delayedResponse = vi.spyOn(prisma, '$transaction').mockImplementationOnce(async (callback, options) => {
        const result = await transaction(callback, options)
        controller.abort(new Error('late abort after COMMIT'))
        await new Promise(resolve => setTimeout(resolve, 10))
        if (loseResponse)
          throw Object.assign(new Error('COMMIT response lost'), { code: 'ECONNRESET' })
        return result
      })
      try {
        const completion = recorder.completeStep(fixture.step.id, { ...deadline(), signal: controller.signal }, { workspaceCommit: fixture.commit, output: { ok: true, observation: '已保存' } })
        if (loseResponse)
          await assert.rejects(completion, DatabaseCommitOutcomeUnknownError)
        else
          await completion
        assert.equal((await prisma.conversationWorkspace.findUniqueOrThrow({ where: { conversationId: fixture.conversation.id } })).revision, 1)
        assert.equal((await prisma.agentStep.findUniqueOrThrow({ where: { id: fixture.step.id } })).status, AgentStepStatus.COMPLETED)
      }
      finally { delayedResponse.mockRestore() }
    }
  })

  it('工具记录无法确认时文件引用回滚', async () => {
    const fixture = await seed()
    await prisma.agentStep.update({ where: { id: fixture.step.id }, data: { status: AgentStepStatus.COMPLETED } })
    await assert.rejects(recorder.completeStep(fixture.step.id, deadline(), { workspaceCommit: fixture.commit }))
    assert.equal((await prisma.conversationWorkspace.findUniqueOrThrow({ where: { conversationId: fixture.conversation.id } })).revision, 0)
  })

  it('旧执行者或过期租约不能发布迟到文件', async () => {
    const fixture = await seed()
    await prisma.conversationWorkspace.update({ where: { conversationId: fixture.conversation.id }, data: { ownerRunId: 'new-owner' } })
    await assert.rejects(recorder.completeStep(fixture.step.id, deadline(), { workspaceCommit: fixture.commit }))
    await prisma.conversationWorkspace.update({ where: { conversationId: fixture.conversation.id }, data: { ownerRunId: fixture.run.id, leaseExpiresAt: new Date(0) } })
    await assert.rejects(recorder.completeStep(fixture.step.id, deadline(), { workspaceCommit: fixture.commit }))
    assert.equal((await prisma.conversationWorkspace.findUniqueOrThrow({ where: { conversationId: fixture.conversation.id } })).revision, 0)
  })

  it('同版本的并发发布只确认一次', async () => {
    const fixture = await seed()
    const other = await prisma.agentStep.create({ data: { runId: fixture.run.id, sequence: 2, type: 'tool_execution', title: '执行工具', status: AgentStepStatus.RUNNING } })
    const results = await Promise.allSettled([fixture.step.id, other.id].map(id => recorder.completeStep(id, deadline(), { workspaceCommit: fixture.commit })))
    assert.equal(results.filter(item => item.status === 'fulfilled').length, 1)
    assert.equal((await prisma.conversationWorkspace.findUniqueOrThrow({ where: { conversationId: fixture.conversation.id } })).revision, 1)
  })

  it('同一内容只上传和恢复一次，两条文件引用仍一起确认', async () => {
    const fixture = await seed()
    await prisma.conversationWorkspace.update({ where: { conversationId: fixture.conversation.id }, data: { ownerRunId: null, leaseExpiresAt: null } })
    let uploads = 0
    let downloads = 0
    let creates = 0
    const cloud = {
      configured: true,
      sandboxConfiguration: { template: 'test', apiHost: 'test.invalid' },
      create: async () => ({ sandboxId: `s-${fixture.run.id}-${++creates}`, kill: async () => true }),
      request: async (_sandbox: unknown, _script: unknown, request: { action: string }) => request.action === 'snapshot' ? { files: [{ path: 'a.txt', content: 'b2s=' }, { path: 'b.txt', content: 'b2s=' }] } : {},
      putFile: async () => {
        uploads++
      },
      readFile: async () => {
        downloads++
        return Buffer.from('ok')
      },
    } as unknown as WorkspaceCloudService
    const service = new WorkspaceService(prisma, cloud, new WorkspaceMonitoringService(prisma, cloud))
    try {
      const commit = await service.prepareCommit({ userId: fixture.user.id, conversationId: fixture.conversation.id, runId: fixture.run.id, deadlineAt: Date.now() + 60000 }, new AbortController().signal)
      assert.ok(commit)
      assert.equal(uploads, 1)
      assert.equal(commit.files.length, 2)
      assert.equal(commit.files[0]!.key, commit.files[1]!.key)
      await recorder.completeStep(fixture.step.id, deadline(), { workspaceCommit: commit, output: { ok: true, observation: '已保存' } })
      const row = await prisma.conversationWorkspace.findUniqueOrThrow({ where: { conversationId: fixture.conversation.id } })
      assert.equal(row.revision, 1)
      assert.deepEqual(row.files, commit.files)
      await service.releaseRun(fixture.run.id)
      await service.fileOperation({ userId: fixture.user.id, conversationId: fixture.conversation.id, runId: fixture.run.id, deadlineAt: Date.now() + 60000 }, { action: 'read' }, new AbortController().signal)
      assert.equal(downloads, 1)
    }
    finally { await service.releaseRun(fixture.run.id) }
  })

  it('其他用户和已删除会话无法获取工作文件，删除后不能再发布', async () => {
    const fixture = await seed()
    let read = false
    const cloud = { configured: true, readFile: async () => {
      read = true
    } } as unknown as WorkspaceCloudService
    const service = new WorkspaceService(prisma, cloud, new WorkspaceMonitoringService(prisma, cloud))
    await assert.rejects(service.snapshot('other-user', fixture.conversation.id))
    await assert.rejects(service.savedFile('other-user', fixture.conversation.id, 'index.html'))
    assert.equal(read, false)
    await prisma.conversation.delete({ where: { id: fixture.conversation.id } })
    await assert.rejects(service.snapshot(fixture.user.id, fixture.conversation.id))
    await assert.rejects(recorder.completeStep(fixture.step.id, deadline(), { workspaceCommit: fixture.commit }))
    assert.equal(await prisma.conversationWorkspace.findUnique({ where: { conversationId: fixture.conversation.id } }), null)
  })

  it('收尾遇到持续行锁时按独立预算返回，数据库实际等待被取消', async () => {
    const fixture = await seed()
    await prisma.conversationWorkspace.update({ where: { conversationId: fixture.conversation.id }, data: { ownerRunId: null, leaseExpiresAt: null } })
    let killed = false
    const cloud = { configured: true, sandboxConfiguration: { template: 'test', apiHost: 'test.invalid' }, create: async () => ({ sandboxId: 'cleanup-test', kill: async () => {
      killed = true
      return true
    } }), request: async () => ({}) } as unknown as WorkspaceCloudService
    const service = new WorkspaceService(prisma, cloud, new WorkspaceMonitoringService(prisma, cloud))
    await service.fileOperation({ userId: fixture.user.id, conversationId: fixture.conversation.id, runId: fixture.run.id, deadlineAt: Date.now() + 30000 }, { action: 'read' }, new AbortController().signal)
    const locker = await pool.connect()
    await locker.query('BEGIN')
    await locker.query('SELECT set_config(\'search_path\', $1, true)', [`${schema},public`])
    await locker.query('UPDATE "ConversationWorkspace" SET "state" = "state" WHERE "conversationId" = $1', [fixture.conversation.id])
    try {
      const started = Date.now()
      await service.releaseRun(fixture.run.id)
      assert.equal(killed, true)
      assert.ok(Date.now() - started < 11000)
    }
    finally {
      await locker.query('ROLLBACK')
      locker.release()
    }
  }, 20000)

  it('真实任务复用一条实例历史，重复释放不改结束时间，删除会话后历史仍在', async () => {
    const fixture = await seed()
    await prisma.conversationWorkspace.update({ where: { conversationId: fixture.conversation.id }, data: { ownerRunId: null, leaseExpiresAt: null } })
    let creates = 0
    let kills = 0
    const cloud = { configured: true, sandboxConfiguration: { template: 'test', apiHost: 'test.invalid' }, create: async (_run: string, _timeout: number, historyId: string) => {
      assert.ok(historyId)
      creates++
      return { sandboxId: `s-${fixture.run.id}`, kill: async () => {
        kills++
        return true
      } }
    }, request: async () => ({}) } as unknown as WorkspaceCloudService
    const monitoring = new WorkspaceMonitoringService(prisma, cloud)
    const service = new WorkspaceService(prisma, cloud, monitoring)
    const execution = { userId: fixture.user.id, conversationId: fixture.conversation.id, runId: fixture.run.id, deadlineAt: Date.now() + 60000 }
    await service.fileOperation(execution, { action: 'read' }, new AbortController().signal)
    await service.fileOperation(execution, { action: 'read' }, new AbortController().signal)
    await service.releaseRun(fixture.run.id)
    const row = await prisma.sandboxExecution.findFirstOrThrow({ where: { runId: fixture.run.id } })
    await service.releaseRun(fixture.run.id)
    assert.equal(creates, 1)
    assert.equal(kills, 1)
    assert.equal(row.state, 'released')
    assert.ok(row.releasedAt && row.durationMs !== null)
    await prisma.conversation.delete({ where: { id: fixture.conversation.id } })
    const retained = await prisma.sandboxExecution.findUniqueOrThrow({ where: { id: row.id } })
    assert.equal(retained.releasedAt?.getTime(), row.releasedAt.getTime())
    await monitoring.unknown(row.id, 'cleanup_pending')
    assert.equal((await prisma.sandboxExecution.findUniqueOrThrow({ where: { id: row.id } })).state, 'released')
    assert.ok((await monitoring.monitor()).summary.confirmedDurationMs >= Number(row.durationMs))
  })

  it('同一 Run 在旧实例释放完成前不能重开；重复释放等待同一收尾', async () => {
    const fixture = await seed()
    await prisma.conversationWorkspace.update({ where: { conversationId: fixture.conversation.id }, data: { ownerRunId: null, leaseExpiresAt: null } })
    let finishKill!: () => void
    const killed = new Promise<void>((resolve) => {
      finishKill = resolve
    })
    let creates = 0
    let kills = 0
    const cloud = { configured: true, sandboxConfiguration: { template: 'test', apiHost: 'test.invalid' }, create: async () => {
      const index = ++creates
      return { sandboxId: `s-${fixture.run.id}-${index}`, kill: async () => {
        kills++
        if (index === 1)
          await killed
        return true
      } }
    }, request: async () => ({}) } as unknown as WorkspaceCloudService
    const service = new WorkspaceService(prisma, cloud, new WorkspaceMonitoringService(prisma, cloud))
    const execution = { userId: fixture.user.id, conversationId: fixture.conversation.id, runId: fixture.run.id, deadlineAt: Date.now() + 60000 }
    const signal = new AbortController().signal
    await service.fileOperation(execution, { action: 'read' }, signal)
    const releasing = service.releaseRun(fixture.run.id)
    let duplicateFinished = false
    const duplicate = service.releaseRun(fixture.run.id).then(() => {
      duplicateFinished = true
    })
    const retry = service.fileOperation(execution, { action: 'read' }, signal).then(() => null, error => error)
    try {
      await new Promise(resolve => setTimeout(resolve, 50))
      assert.equal(duplicateFinished, false)
      assert.equal(creates, 1)
      assert.equal((await prisma.conversationWorkspace.findUniqueOrThrow({ where: { conversationId: fixture.conversation.id } })).ownerRunId, fixture.run.id)
    }
    finally { finishKill() }
    await Promise.all([releasing, duplicate])
    assert.equal(await retry, null)
    const current = await prisma.conversationWorkspace.findUniqueOrThrow({ where: { conversationId: fixture.conversation.id } })
    assert.equal(current.ownerRunId, fixture.run.id)
    assert.equal(current.sandboxId, `s-${fixture.run.id}-2`)
    await service.releaseRun(fixture.run.id)
    assert.equal(kills, 2)
  })

  it('抢占失败不能清除已经属于同一 Run 的租约或实例', async () => {
    const fixture = await seed()
    await prisma.conversationWorkspace.update({ where: { conversationId: fixture.conversation.id }, data: { sandboxId: 'existing-instance', state: 'running' } })
    const cloud = { configured: true } as WorkspaceCloudService
    const service = new WorkspaceService(prisma, cloud, new WorkspaceMonitoringService(prisma, cloud))
    await assert.rejects(service.fileOperation({ userId: fixture.user.id, conversationId: fixture.conversation.id, runId: fixture.run.id, deadlineAt: Date.now() + 60000 }, { action: 'read' }, new AbortController().signal), /正在执行另一项任务/)
    const row = await prisma.conversationWorkspace.findUniqueOrThrow({ where: { conversationId: fixture.conversation.id } })
    assert.equal(row.ownerRunId, fixture.run.id)
    assert.equal(row.sandboxId, 'existing-instance')
    assert.equal(row.state, 'running')
  })

  it('服务重启后过期租约只显示待核查，不把旧 running 状态当成正在运行', async () => {
    const fixture = await seed()
    await prisma.conversationWorkspace.update({ where: { conversationId: fixture.conversation.id }, data: { state: 'running', leaseExpiresAt: new Date(0) } })
    const cloud = { configured: true } as WorkspaceCloudService
    const service = new WorkspaceService(prisma, cloud, new WorkspaceMonitoringService(prisma, cloud))
    const snapshot = await service.snapshot(fixture.user.id, fixture.conversation.id)
    assert.equal(snapshot.state, 'cleanup_pending')
    assert.match(snapshot.lastError!, /租约已过期/)
    assert.equal((await prisma.conversationWorkspace.findUniqueOrThrow({ where: { conversationId: fixture.conversation.id } })).state, 'running')
  })

  it('命令超时立即释放实例，运行历史保留已确认时长', async () => {
    const fixture = await seed()
    await prisma.conversationWorkspace.update({ where: { conversationId: fixture.conversation.id }, data: { ownerRunId: null, leaseExpiresAt: null } })
    const cloud = {
      configured: true,
      sandboxConfiguration: { template: 'test', apiHost: 'test.invalid' },
      create: async () => ({ sandboxId: `s-${fixture.run.id}`, kill: async () => true }),
      request: async (_sandbox: unknown, _script: unknown, request: Record<string, unknown>) => 'command' in request
        ? { stdout: '', stderr: '', exitCode: 124, timedOut: true, truncated: false }
        : {},
    } as unknown as WorkspaceCloudService
    const service = new WorkspaceService(prisma, cloud, new WorkspaceMonitoringService(prisma, cloud))
    const result = await service.bash({ userId: fixture.user.id, conversationId: fixture.conversation.id, runId: fixture.run.id, deadlineAt: Date.now() + 60000 }, 'sleep 30', 1, new AbortController().signal)
    assert.equal(result.timedOut, true)
    const row = await prisma.sandboxExecution.findFirstOrThrow({ where: { runId: fixture.run.id } })
    assert.equal(row.state, 'released')
    assert.ok(row.releasedAt && row.durationMs !== null)
    assert.equal((await prisma.conversationWorkspace.findUniqueOrThrow({ where: { conversationId: fixture.conversation.id } })).sandboxId, null)
  })

  it('历史写入失败时不启动未登记的云实例', async () => {
    const fixture = await seed()
    await prisma.conversationWorkspace.update({ where: { conversationId: fixture.conversation.id }, data: { ownerRunId: null, leaseExpiresAt: null } })
    let created = false
    const cloud = { configured: true, sandboxConfiguration: { template: 'test', apiHost: 'test.invalid' }, create: async () => {
      created = true
    } } as unknown as WorkspaceCloudService
    const service = new WorkspaceService(prisma, cloud, new WorkspaceMonitoringService(prisma, cloud))
    await prisma.$executeRawUnsafe('ALTER TABLE "SandboxExecution" ADD CONSTRAINT reject_new_history CHECK (false) NOT VALID')
    try {
      await assert.rejects(service.fileOperation({ userId: fixture.user.id, conversationId: fixture.conversation.id, runId: fixture.run.id, deadlineAt: Date.now() + 60000 }, { action: 'read' }, new AbortController().signal))
      assert.equal(created, false)
      assert.equal((await prisma.conversationWorkspace.findUniqueOrThrow({ where: { conversationId: fixture.conversation.id } })).ownerRunId, null)
    }
    finally { await prisma.$executeRawUnsafe('ALTER TABLE "SandboxExecution" DROP CONSTRAINT reject_new_history') }
  })

  it('历史 COMMIT 响应未知时保留预先确定的 ID，不启动云实例并清理租约', async () => {
    const fixture = await seed()
    await prisma.conversationWorkspace.update({ where: { conversationId: fixture.conversation.id }, data: { ownerRunId: null, leaseExpiresAt: null } })
    let created = false
    const cloud = { configured: true, sandboxConfiguration: { template: 'test', apiHost: 'test.invalid' }, create: async () => {
      created = true
    } } as unknown as WorkspaceCloudService
    const monitoring = new WorkspaceMonitoringService(prisma, cloud)
    const begin = monitoring.begin.bind(monitoring)
    monitoring.begin = async (...args) => {
      await begin(...args)
      throw new WorkspaceOperationError('工作区状态事务结果未知', true)
    }
    const service = new WorkspaceService(prisma, cloud, monitoring)
    await assert.rejects(service.fileOperation({ userId: fixture.user.id, conversationId: fixture.conversation.id, runId: fixture.run.id, deadlineAt: Date.now() + 60000 }, { action: 'read' }, new AbortController().signal), /事务结果未知/)
    assert.equal(created, false)
    assert.equal((await prisma.sandboxExecution.findFirstOrThrow({ where: { runId: fixture.run.id } })).state, 'create_failed')
    assert.equal((await prisma.conversationWorkspace.findUniqueOrThrow({ where: { conversationId: fixture.conversation.id } })).ownerRunId, null)
  })

  it('主表按工作区聚合并分页，已删除会话仍能查询独立分页历史', async () => {
    const cloud = { configured: true, sandboxConfiguration: { template: 'test', apiHost: 'test.invalid' } } as unknown as WorkspaceCloudService
    const monitoring = new WorkspaceMonitoringService(prisma, cloud)
    await seed()
    const before = (await monitoring.monitor()).pagination.total
    const fixture = await seed()
    for (const [index, durationMs] of [1000, 2000, null].entries()) {
      await prisma.sandboxExecution.create({ data: { userId: fixture.user.id, conversationId: fixture.conversation.id, runId: fixture.run.id, title: fixture.conversation.title, template: 'test', apiHost: 'test.invalid', sandboxId: `group-${fixture.run.id}-${index}`, requestedAt: new Date(1791000000000 + index * 1000), state: durationMs === null ? 'not_listed' : 'released', startedAt: new Date(1791000000000), releasedAt: durationMs === null ? null : new Date(1791000000000 + durationMs), durationMs } })
    }
    const main = await monitoring.monitor(1, 50)
    const rows = main.items.filter(row => row.conversationId === fixture.conversation.id)
    assert.equal(main.pagination.total, before + 1)
    assert.equal(rows.length, 1)
    assert.equal(rows[0]!.sandboxCount, 3)
    assert.equal(rows[0]!.confirmedDurationMs, 3000)
    assert.equal(rows[0]!.state, 'not_listed')
    assert.equal(rows[0]!.deleted, false)
    const first = await monitoring.monitor(1, 1)
    const second = await monitoring.monitor(2, 1)
    assert.notEqual(first.items[0]!.conversationId, second.items[0]!.conversationId)
    const history = await monitoring.history(fixture.conversation.id, 1, 1)
    const next = await monitoring.history(fixture.conversation.id, 2, 1)
    assert.equal(history.pagination.total, 3)
    assert.notEqual(history.items[0]!.id, next.items[0]!.id)
    assert.equal(history.items[0]!.runAvailable, true)
    await prisma.conversation.delete({ where: { id: fixture.conversation.id } })
    const archived = await monitoring.history(fixture.conversation.id, 1, 20)
    assert.equal(archived.workspace.deleted, true)
    assert.equal(archived.workspace.title, fixture.conversation.title)
    assert.equal(archived.workspace.fileCount, null)
    assert.equal(archived.workspace.fileBytes, null)
    assert.equal(archived.workspace.revision, null)
    assert.equal(archived.items.length, 3)
    assert.ok(archived.items.every(row => row.conversationId === fixture.conversation.id && !row.runAvailable))
    assert.equal((await monitoring.monitor()).pagination.total, before + 1)
    await assert.rejects(monitoring.history('missing-workspace'), /工作区不存在/)
  })

  it('单次刷新先核对状态，再返回当前分页和云概况', async () => {
    let forced = false
    const cloud = {
      configured: true,
      sandboxConfiguration: { template: 'test', apiHost: 'test.invalid' },
      inspectSandboxes: async (force: boolean) => {
        forced = force
        return { checkedAt: new Date().toISOString(), instances: [], error: null }
      },
      inspectStorage: async () => ({ bucket: 'test', measuredAt: null, checkedAt: null, storageBytes: 123, objectCount: 3, error: null }),
    } as unknown as WorkspaceCloudService
    const monitoring = new WorkspaceMonitoringService(prisma, cloud)
    const fixture = await seed()
    const record = await monitoring.begin({ userId: fixture.user.id, conversationId: fixture.conversation.id, runId: fixture.run.id, deadlineAt: Date.now() + 60_000 }, '刷新核查')
    await monitoring.created(record.id, `s-${fixture.run.id}`, new Date())
    await monitoring.unknown(record.id, 'cleanup_pending')
    const result = await monitoring.refresh(1, 1)
    assert.equal(forced, true)
    assert.equal(result.pagination.page, 1)
    assert.equal(result.items.length, 1)
    assert.equal(result.cloud.oss.storageBytes, 123)
    assert.deepEqual(result.cloud.sandbox.instances, [])
    assert.equal(result.items[0]!.conversationId, fixture.conversation.id)
    assert.equal(result.items[0]!.state, 'not_listed')
    const [entry] = (await monitoring.history(fixture.conversation.id)).items
    assert.equal(entry!.id, record.id)
    assert.equal(entry!.releasedAt, null)
    assert.equal(entry!.durationMs, null)
  })

  it('管理员主表和历史把到期实例投影为待核查，保留数据库事实', async () => {
    const fixture = await seed()
    const monitoring = new WorkspaceMonitoringService(prisma, { configured: true } as WorkspaceCloudService)
    const row = await prisma.sandboxExecution.create({ data: {
      userId: fixture.user.id,
      conversationId: fixture.conversation.id,
      runId: fixture.run.id,
      title: '到期实例',
      template: 'test',
      apiHost: 'test.invalid',
      state: 'running',
      expiresAt: new Date(0),
    } })
    assert.equal((await monitoring.monitor(1, 50)).items.find(item => item.conversationId === fixture.conversation.id)?.state, 'cleanup_pending')
    const history = await monitoring.history(fixture.conversation.id)
    assert.equal(history.workspace.state, 'cleanup_pending')
    assert.equal(history.items[0]!.state, 'cleanup_pending')
    const stored = await prisma.sandboxExecution.findUniqueOrThrow({ where: { id: row.id } })
    assert.equal(stored.state, 'running')
    assert.equal(stored.releasedAt, null)
  })

  it('大量未确认历史可在核查预算内更新，迟到核查不覆盖已释放记录', async () => {
    const fixture = await seed()
    const apiHost = `${randomUUID()}.test.invalid`
    const rows = Array.from({ length: 2000 }, (_, index) => ({
      id: randomUUID(),
      userId: fixture.user.id,
      conversationId: fixture.conversation.id,
      runId: fixture.run.id,
      title: '批量核查',
      template: 'test',
      apiHost,
      sandboxId: `bulk-${fixture.run.id}-${index}`,
      state: 'running',
    }))
    await prisma.sandboxExecution.createMany({ data: rows })
    const checkedAt = new Date().toISOString()
    await prisma.sandboxExecution.update({ where: { id: rows[0]!.id }, data: { state: 'released', releasedAt: new Date(), durationMs: 10 } })
    const cloud = { sandboxConfiguration: { template: 'test', apiHost }, inspectSandboxes: async () => ({ checkedAt, instances: [], error: null }) } as unknown as WorkspaceCloudService
    const monitoring = new WorkspaceMonitoringService(prisma, cloud)
    assert.equal((await monitoring.reconcile()).updated, 1999)
    assert.equal(await prisma.sandboxExecution.count({ where: { apiHost, state: 'not_listed', releasedAt: null, durationMs: null } }), 1999)
    assert.equal((await prisma.sandboxExecution.findUniqueOrThrow({ where: { id: rows[0]!.id } })).state, 'released')
    assert.equal((await monitoring.reconcile()).updated, 0)
    await prisma.sandboxExecution.deleteMany({ where: { apiHost } })
  })

  it('创建途中取消或恢复失败，已分配实例会释放并留下确认记录', async () => {
    for (const cancel of [true, false]) {
      const fixture = await seed()
      await prisma.conversationWorkspace.update({ where: { conversationId: fixture.conversation.id }, data: { ownerRunId: null, leaseExpiresAt: null } })
      const controller = new AbortController()
      let killed = false
      const cloud = { configured: true, sandboxConfiguration: { template: 'test', apiHost: 'test.invalid' }, create: async () => {
        if (cancel)
          controller.abort()
        return { sandboxId: `s-${fixture.run.id}`, kill: async () => {
          killed = true
          return true
        } }
      }, request: async () => {
        throw new Error('恢复失败')
      } } as unknown as WorkspaceCloudService
      const service = new WorkspaceService(prisma, cloud, new WorkspaceMonitoringService(prisma, cloud))
      await assert.rejects(service.fileOperation({ userId: fixture.user.id, conversationId: fixture.conversation.id, runId: fixture.run.id, deadlineAt: Date.now() + 60000 }, { action: 'read' }, controller.signal))
      const row = await prisma.sandboxExecution.findFirstOrThrow({ where: { runId: fixture.run.id } })
      assert.equal(killed, true)
      assert.equal(row.state, 'released')
      assert.ok(row.releasedAt)
    }
  })

  it('释放失败与重启后未列出实例不伪造结束时间；云查询失败不改变记录', async () => {
    const fixture = await seed()
    await prisma.conversationWorkspace.update({ where: { conversationId: fixture.conversation.id }, data: { ownerRunId: null, leaseExpiresAt: null } })
    let unavailable = true
    const cloud = { configured: true, sandboxConfiguration: { template: 'test', apiHost: 'test.invalid' }, create: async () => ({ sandboxId: `s-${fixture.run.id}`, kill: async () => {
      throw new Error('网络中断')
    } }), request: async () => ({}), inspectSandboxes: async () => ({ checkedAt: new Date().toISOString(), instances: unavailable ? null : [], error: unavailable ? '查询失败' : null }) } as unknown as WorkspaceCloudService
    const monitoring = new WorkspaceMonitoringService(prisma, cloud)
    const service = new WorkspaceService(prisma, cloud, monitoring)
    await service.fileOperation({ userId: fixture.user.id, conversationId: fixture.conversation.id, runId: fixture.run.id, deadlineAt: Date.now() + 60000 }, { action: 'read' }, new AbortController().signal)
    await service.releaseRun(fixture.run.id)
    const row = await prisma.sandboxExecution.findFirstOrThrow({ where: { runId: fixture.run.id } })
    assert.equal(row.state, 'cleanup_pending')
    const restarted = new WorkspaceMonitoringService(prisma, cloud)
    await restarted.reconcile()
    assert.equal((await prisma.sandboxExecution.findUniqueOrThrow({ where: { id: row.id } })).state, 'cleanup_pending')
    unavailable = false
    await restarted.reconcile()
    const gone = await prisma.sandboxExecution.findUniqueOrThrow({ where: { id: row.id } })
    assert.equal(gone.state, 'not_listed')
    assert.equal(gone.releasedAt, null)
    assert.equal(gone.durationMs, null)
  })

  it('创建结果未知凭元数据核对；核查不抢正在创建的记录，到期时间不是销毁时间', async () => {
    const fixture = await seed()
    const execution = { userId: fixture.user.id, conversationId: fixture.conversation.id, runId: fixture.run.id, deadlineAt: Date.now() + 60000 }
    let recordId = ''
    const cloud = { configured: true, sandboxConfiguration: { template: 'test', apiHost: 'test.invalid' }, inspectSandboxes: async () => ({ checkedAt: new Date().toISOString(), error: null, instances: [{ sandboxId: `s-${fixture.run.id}`, executionId: recordId, runId: fixture.run.id, state: 'running', startedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60000).toISOString() }] }) } as unknown as WorkspaceCloudService
    const monitoring = new WorkspaceMonitoringService(prisma, cloud)
    const row = await monitoring.begin(execution, '创建核查')
    recordId = row.id
    await monitoring.reconcile()
    assert.equal((await prisma.sandboxExecution.findUniqueOrThrow({ where: { id: row.id } })).state, 'creating')
    await monitoring.unknown(row.id, 'creation_unknown')
    await monitoring.reconcile()
    const found = await prisma.sandboxExecution.findUniqueOrThrow({ where: { id: row.id } })
    assert.equal(found.sandboxId, `s-${fixture.run.id}`)
    assert.equal(found.releasedAt, null)
    await monitoring.released(row.id, found.sandboxId!, found.startedAt!, false)
    assert.equal((await prisma.sandboxExecution.findUniqueOrThrow({ where: { id: row.id } })).durationMs, null)
  })
})
