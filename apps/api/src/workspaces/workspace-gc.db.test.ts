import type { WorkspaceCloudService } from './workspace-cloud.service.js'
import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { randomUUID } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import process from 'node:process'
import { afterAll, beforeAll, describe, it, onTestFinished, vi } from 'vitest'
import { AgentRunRecorderService } from '../agent-runtime/lifecycle/agent-run-recorder.service.js'
import { ConversationsService } from '../conversations/conversations.service.js'
import { DatabaseCommitOutcomeUnknownError, PrismaService } from '../prisma/prisma.service.js'
import { WorkspaceDeleteOutcomeUnknownError, WorkspaceUploadOutcomeUnknownError } from './workspace-cloud.service.js'
import { lockWorkspaceStorage, workspaceDb } from './workspace-db.js'
import { fileHash, WorkspaceOperationError } from './workspace-files.js'
import { WorkspaceGcService } from './workspace-gc.service.js'
import { WorkspaceMonitoringService } from './workspace-monitoring.service.js'
import { WorkspacePreviewService } from './workspace-preview.service.js'
import { WorkspaceService } from './workspace.service.js'

const url = process.env.TEST_DATABASE_URL?.trim()
if (!url || url === process.env.DATABASE_URL?.trim())
  throw new Error('GC 故障验证仅允许独立 TEST_DATABASE_URL')
const { Pool } = createRequire(import.meta.url)('pg') as { Pool: new (options: { connectionString: string }) => {
  query: (sql: string, values?: unknown[]) => Promise<unknown>
  connect: () => Promise<{ query: (sql: string, values?: unknown[]) => Promise<unknown>, release: () => void }>
  end: () => Promise<void>
} }

describe('OSS GC PostgreSQL 引用与故障边界（内存 OSS，不访问业务 Bucket）', () => {
  const schema = `gc_test_${randomUUID().replaceAll('-', '')}`
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
    prisma = new PrismaService(scoped.href)
    await prisma.$connect()
    recorder = new AgentRunRecorderService(prisma)
  })
  afterAll(async () => {
    await prisma?.$disconnect()
    await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
    await pool.end()
  })
  const deadline = () => ({ deadlineAt: Date.now() + 5_000, signal: new AbortController().signal, createTimeoutError: () => new Error('测试超时') })

  async function fixture() {
    vi.stubEnv('OSS_WORKSPACE_GC_ENABLED', 'false')
    vi.stubEnv('APP_ORIGINS', 'http://127.0.0.1:5173')
    onTestFinished(() => {
      vi.unstubAllEnvs()
      vi.restoreAllMocks()
    })
    const user = await prisma.user.create({ data: { email: `${randomUUID()}@gc.test` } })
    const conversation = await prisma.conversation.create({ data: { userId: user.id, title: '隔离 GC' } })
    await prisma.conversationWorkspace.create({ data: { userId: user.id, conversationId: conversation.id } })
    const prefix = `users/${user.id}/conversations/${conversation.id}/`
    const objects = new Map<string, Buffer>()
    const source: Array<{ path: string, content: Buffer }> = []
    const dist: Array<{ path: string, content: Buffer }> = []
    let restored: Array<{ path: string, content: string }> = []
    const put = vi.fn(async (file: { key: string }, content: Buffer) => {
      const previous = objects.get(file.key)
      if (previous)
        assert.deepEqual(previous, content)
      objects.set(file.key, content)
    })
    const remove = vi.fn(async (key: string) => {
      objects.delete(key)
    })
    const list = vi.fn(async (p: string, marker?: string) => {
      const keys = [...objects.keys()].filter(key => key.startsWith(p) && (!marker || key > marker)).sort()
      return { keys: keys.slice(0, 2), ...(keys.length > 2 ? { nextMarker: keys[1]! } : {}) }
    })
    const cloud = { configured: true, storageBucket: 'gc-isolated-fixture', sandboxConfiguration: { template: 'fixture', apiHost: 'fixture.invalid' }, create: async () => ({ sandboxId: randomUUID(), kill: async () => true }), putFile: put, deleteFile: remove, listFiles: list, readFile: async (file: { key: string, bytes: number, sha256: string }) => {
      const content = objects.get(file.key)
      assert.ok(content, `缺少仍引用对象 ${file.key}`)
      assert.equal(content.length, file.bytes)
      assert.equal(fileHash(content), file.sha256)
      return content
    }, request: async (_sandbox: unknown, _script: string, request: { action?: string, artifact?: boolean, files?: typeof restored }) => {
      if (request.action === 'restore')
        restored = request.files ?? []
      if (request.action === 'snapshot')
        return { files: (request.artifact ? dist : source).map(file => ({ path: file.path, content: file.content.toString('base64') })) }
      return request.action ? {} : { stdout: '', stderr: '', exitCode: 0, timedOut: false, truncated: false }
    } } as unknown as WorkspaceCloudService
    const gc = new WorkspaceGcService(prisma, cloud)
    const service = new WorkspaceService(prisma, cloud, new WorkspaceMonitoringService(prisma, cloud), gc)
    const previews = new WorkspacePreviewService(prisma, cloud)
    async function newRun() {
      const message = await prisma.message.create({ data: { conversationId: conversation.id, role: 'USER', content: '修改' } })
      const run = await prisma.agentRun.create({ data: { conversationId: conversation.id, userMessageId: message.id } })
      const execution = { runId: run.id, conversationId: conversation.id, userId: user.id, deadlineAt: Date.now() + 60_000 }
      return execution
    }
    async function confirm(execution: Awaited<ReturnType<typeof newRun>>, build = false) {
      const signal = new AbortController().signal
      if (build)
        await service.bash(execution, 'pnpm build', 60, signal, true)
      const commit = await service.prepareCommit(execution, signal)
      assert.ok(commit)
      const step = await prisma.agentStep.create({ data: { runId: execution.runId, sequence: await prisma.agentStep.count({ where: { runId: execution.runId } }) + 1, type: 'tool_execution', title: '保存', status: 'RUNNING' } })
      await recorder.completeStep(step.id, deadline(), { workspaceCommit: commit })
      return { commit, step }
    }
    async function end(execution: Awaited<ReturnType<typeof newRun>>) {
      await prisma.agentRun.update({ where: { id: execution.runId }, data: { status: 'COMPLETED' } })
      await service.releaseRun(execution.runId)
    }
    onTestFinished(() => service.onModuleDestroy())
    return { user, conversation, prefix, objects, source, dist, put, remove, list, cloud, gc, service, previews, newRun, confirm, end, restored: () => restored, key: (content: string) => `${prefix}objects/${fileHash(Buffer.from(content))}` }
  }

  it('F1：会话删除的新清理需求不能被旧扫描吞掉，启动恢复自动排空前缀', async () => {
    const f = await fixture()
    const run = await f.newRun()
    const a = 'Source A'
    let o = 'orphan O'
    while (f.key(o) < f.key(a))
      o += 'x'
    f.source.push({ path: 'a.txt', content: Buffer.from(a) })
    await f.confirm(run)
    await f.end(run)
    f.objects.set(f.key(o), Buffer.from(o))
    const other = 'users/other/conversations/other/objects/preserved'
    f.objects.set(other, Buffer.from('other'))
    let deleting = false
    let release!: () => void
    const hold = new Promise<void>(resolve => release = resolve)
    f.remove.mockImplementationOnce(async (key) => {
      assert.equal(key, f.key(o))
      deleting = true
      await hold
      f.objects.delete(key)
    })
    const first = f.gc.collect(f.conversation.id, true)
    await vi.waitFor(() => assert.equal(deleting, true))
    const secondGc = new WorkspaceGcService(prisma, f.cloud)
    const collect = secondGc.collect.bind(secondGc)
    let secondFinished = false
    vi.spyOn(secondGc, 'collect').mockImplementation(async (...args) => {
      const result = await collect(...args)
      assert.match(result.blocked!, /活动\/未知删除/)
      secondFinished = true
      return result
    })
    vi.stubEnv('OSS_WORKSPACE_GC_ENABLED', 'true')
    let firstReport
    try {
      await new ConversationsService(prisma, secondGc).delete(f.user.id, f.conversation.id)
      await vi.waitFor(() => assert.equal(secondFinished, true))
    }
    finally {
      release()
      firstReport = await first
      await secondGc.onModuleDestroy()
    }
    assert.deepEqual(firstReport.retained, [f.key(a)], '旧扫描先保留 A，再等待 O 的 DELETE')
    assert.ok(f.objects.has(f.key(a)))
    const restarted = new WorkspaceGcService(prisma, f.cloud)
    restarted.onModuleInit()
    try {
      await vi.waitFor(async () => {
        assert.equal([...f.objects.keys()].filter(key => key.startsWith(f.prefix)).length, 0)
        const target = await prisma.workspaceGcTarget.findUniqueOrThrow({ where: { conversationId: f.conversation.id } })
        assert.equal(target.pending, false, '只有自动恢复完整扫描后才能取消 pending')
      })
      assert.ok(f.objects.has(other))
    }
    finally {
      await restarted.onModuleDestroy()
      vi.stubEnv('OSS_WORKSPACE_GC_ENABLED', 'false')
    }
  })

  it('AC-01/02/03/12：A→B→C 收尾回收，完整 Source 与共享内容保护；删除不会恢复，分页不漏目标', async () => {
    const f = await fixture()
    const run = await f.newRun()
    for (const content of ['A', 'B', 'C']) {
      f.source.splice(0, f.source.length, { path: 'a.txt', content: Buffer.from(content) }, { path: 'README.md', content: Buffer.from('C') }, { path: 'tests/check.ts', content: Buffer.from('license') })
      await f.confirm(run)
      const mid = await f.gc.collect(f.conversation.id, true)
      assert.match(mid.blocked!, /运行\/提交/)
      assert.equal(mid.deleted.length, 0)
    }
    await f.end(run)
    const beforeDryRun = [...f.objects.keys()].sort()
    const dry = await f.gc.collect(f.conversation.id)
    assert.deepEqual(dry.candidates.sort(), [f.key('A'), f.key('B')].sort())
    assert.deepEqual([...f.objects.keys()].sort(), beforeDryRun)
    assert.equal(f.remove.mock.calls.length, 0, '默认对账不删除')
    const result = await f.gc.collect(f.conversation.id, true)
    assert.deepEqual(result.deleted.sort(), [f.key('A'), f.key('B')].sort())
    assert.ok(f.list.mock.calls.length > 1)
    assert.deepEqual([...f.objects.keys()].sort(), [f.key('C'), f.key('license')].sort())
    const next = await f.newRun()
    f.source.splice(0, f.source.length, { path: 'README.md', content: Buffer.from('C') }, { path: 'tests/check.ts', content: Buffer.from('license') })
    await f.confirm(next)
    await f.end(next)
    await f.gc.collect(f.conversation.id, true)
    assert.ok(f.objects.has(f.key('C')), '删除 a.txt 不能删除 README 的同内容引用')
    const restored = await f.newRun()
    await f.service.fileOperation(restored, { action: 'read', path: 'README.md' }, new AbortController().signal)
    assert.deepEqual(f.restored().map(file => file.path), ['README.md', 'tests/check.ts'])
    assert.ok((await f.service.archive(f.user.id, f.conversation.id, 4, new AbortController().signal)).includes(Buffer.from('tests/check.ts')))
    await f.end(restored)
  })

  it('AC-02/04/05/08：当前 Artifact 复用跳过重复 PUT；旧预览持久保护、禁续期、到期淘汰独占对象', async () => {
    const f = await fixture()
    f.source.push({ path: 'index.html', content: Buffer.from('<html>shared</html>') })
    f.dist.push(...f.source, { path: 'old.txt', content: Buffer.from('old resource') })
    const first = await f.newRun()
    const a = await f.confirm(first, true)
    await f.end(first)
    const grant = await f.previews.open(f.user.id, f.conversation.id, a.commit.artifact!.id, 'http://127.0.0.1:5173')
    const token = grant.url.split('/')[3]!
    const laterIssuedExpiry = new Date(Date.now() + 600_000 + 1_234)
    await prisma.workspaceArtifact.update({ where: { id: a.commit.artifact!.id }, data: { previewExpiresAt: laterIssuedExpiry } })
    await f.previews.open(f.user.id, f.conversation.id, a.commit.artifact!.id, 'http://127.0.0.1:5173')
    assert.equal((await prisma.workspaceArtifact.findUniqueOrThrow({ where: { id: a.commit.artifact!.id } })).previewExpiresAt!.getTime(), laterIssuedExpiry.getTime(), '迟到授权不能缩短另一有效能力的保护期')
    const puts = f.put.mock.calls.length
    const repeated = await f.newRun()
    const b = await f.confirm(repeated, true)
    await f.end(repeated)
    assert.equal(f.put.mock.calls.length, puts, '已确认当前 Artifact SHA 受保护，可跳过 PUT')
    await assert.rejects(f.previews.open(f.user.id, f.conversation.id, a.commit.artifact!.id, 'http://127.0.0.1:5173'), /旧构建已退役/)
    assert.equal((await f.previews.resource(token, 'old.txt', new AbortController().signal)).content.toString(), 'old resource')
    f.dist.splice(1, 1)
    const third = await f.newRun()
    await f.confirm(third, true)
    await f.end(third)
    const restarted = new WorkspaceGcService(prisma, f.cloud)
    await restarted.collect(f.conversation.id, true)
    assert.ok(f.objects.has(f.key('old resource')), '新 GC 实例也能看到旧预览保护，不依赖 API Map')
    assert.equal(await prisma.workspaceArtifact.count({ where: { conversationId: f.conversation.id } }), 2, '无预览的中间构建已淘汰')
    await prisma.workspaceArtifact.update({ where: { id: a.commit.artifact!.id }, data: { previewExpiresAt: new Date(Date.now() - 1) } })
    await restarted.collect(f.conversation.id, true)
    assert.equal(f.objects.has(f.key('old resource')), false)
    assert.ok(f.objects.has(f.key('<html>shared</html>')))
    assert.equal(await prisma.workspaceArtifact.count({ where: { conversationId: f.conversation.id } }), 1)
    await assert.rejects(f.previews.resource(token, 'old.txt', new AbortController().signal), /构建不存在|旧预览已过期/)
    assert.notEqual(a.commit.artifact!.id, b.commit.artifact!.id)
  })

  it('AC-07：上传后事务回滚与 COMMIT 响应丢失，互斥核查实际指针而不猜测回滚', async () => {
    const f = await fixture()
    const run = await f.newRun()
    f.source.push({ path: 'a.txt', content: Buffer.from('A') })
    const a = await f.confirm(run)
    f.source[0]!.content = Buffer.from('B')
    const b = await f.service.prepareCommit(run, new AbortController().signal)
    assert.ok(b)
    await assert.rejects(recorder.completeStep(a.step.id, deadline(), { workspaceCommit: b }), /已进入终态/)
    await f.end(run)
    await f.gc.collect(f.conversation.id, true)
    assert.ok(f.objects.has(f.key('A')))
    assert.equal(f.objects.has(f.key('B')), false)
    const next = await f.newRun()
    f.source[0]!.content = Buffer.from('C')
    const c = await f.service.prepareCommit(next, new AbortController().signal)
    assert.ok(c)
    const step = await prisma.agentStep.create({ data: { runId: next.runId, sequence: 1, type: 'tool_execution', title: '保存', status: 'RUNNING' } })
    const original = prisma.withDeadlineTransaction.bind(prisma)
    const spy = vi.spyOn(prisma, 'withDeadlineTransaction').mockImplementation(async (...args) => {
      await original(...args)
      throw new DatabaseCommitOutcomeUnknownError()
    })
    await assert.rejects(recorder.completeStep(step.id, deadline(), { workspaceCommit: c }), DatabaseCommitOutcomeUnknownError)
    spy.mockRestore()
    await f.end(next)
    await f.gc.collect(f.conversation.id, true)
    assert.deepEqual([...f.objects.keys()], [f.key('C')], '实际 COMMIT 已确认的引用不因响应丢失被误删')
  })

  it('AC-06/08：删会话与在途 PUT 竞态，目标 survives cascade，迟到对象再次对账清空而不碰其他前缀', async () => {
    const f = await fixture()
    const run = await f.newRun()
    f.source.push({ path: 'a.txt', content: Buffer.from('current') })
    f.dist.push({ path: 'index.html', content: Buffer.from('<html>old artifact</html>') })
    await f.confirm(run, true)
    f.objects.set(f.key('old source'), Buffer.from('old source'))
    f.objects.set(f.key('orphan'), Buffer.from('orphan'))
    const otherKey = 'users/other/conversations/other/objects/untouched'
    f.objects.set(otherKey, Buffer.from('other'))
    let complete!: () => void
    const hold = new Promise<void>(resolve => complete = resolve)
    f.put.mockImplementationOnce(async (file, content) => {
      await hold
      f.objects.set(file.key, content)
    })
    f.source[0]!.content = Buffer.from('late')
    const controller = new AbortController()
    const pending = f.service.prepareCommit(run, controller.signal)
    const rejected = assert.rejects(pending)
    await vi.waitFor(async () => assert.equal(await prisma.workspaceUpload.count({ where: { conversationId: f.conversation.id, state: 'active' } }), 1))
    await vi.waitFor(() => assert.ok(f.put.mock.calls.at(-1)?.[0].key === f.key('late')))
    await new ConversationsService(prisma, f.gc).delete(f.user.id, f.conversation.id)
    await assert.rejects(f.service.snapshot(f.user.id, f.conversation.id), /会话不存在/)
    assert.ok((await prisma.workspaceGcTarget.findUnique({ where: { conversationId: f.conversation.id } }))?.deletedAt)
    assert.match((await f.gc.collect(f.conversation.id, true)).blocked!, /活动\/未知上传/)
    controller.abort()
    complete()
    await rejected
    await f.service.releaseRun(run.runId)
    const result = await new WorkspaceGcService(prisma, f.cloud).collect(f.conversation.id, true)
    assert.equal(result.failed.length, 0)
    assert.equal([...f.objects.keys()].filter(key => key.startsWith(f.prefix)).length, 0)
    assert.ok(f.objects.has(otherKey))
    assert.ok(result.deleted.includes(f.key('late')))
    assert.equal(await prisma.workspaceArtifact.count({ where: { conversationId: f.conversation.id } }), 0)
  })

  it('AC-08：GC 持久删除屏障与新 Run 取得 owner/复用旧 SHA 竞态，删除后重新 PUT 再确认，不出现悬空引用', async () => {
    const f = await fixture()
    const content = 'old SHA reused'
    f.objects.set(f.key(content), Buffer.from(content))
    await workspaceDb(prisma, db => f.gc.register(db, f.user.id, f.conversation.id))
    let release!: () => void
    let deleting = false
    const hold = new Promise<void>(resolve => release = resolve)
    f.remove.mockImplementationOnce(async (key) => {
      deleting = true
      await hold
      f.objects.delete(key)
    })
    const collecting = f.gc.collect(f.conversation.id, true)
    await vi.waitFor(() => assert.equal(deleting, true))
    const run = await f.newRun()
    f.source.push({ path: 'reuse.txt', content: Buffer.from(content) })
    let owned = false
    const opening = f.service.fileOperation(run, { action: 'read', path: 'reuse.txt' }, new AbortController().signal).then(() => {
      owned = true
    })
    await new Promise(resolve => setTimeout(resolve, 100))
    const persistedDeletion = await prisma.workspaceGcTarget.findUniqueOrThrow({ where: { conversationId: f.conversation.id } })
    const persistedOwner = await prisma.conversationWorkspace.findUniqueOrThrow({ where: { conversationId: f.conversation.id } })
    const ownedBeforeDeletionFinished = owned
    release()
    await Promise.all([collecting, opening])
    assert.equal(persistedOwner.ownerRunId, null, '删除尚未结束，不得取得新 owner')
    assert.equal(persistedDeletion.deletingKey, f.key(content), '网络删除期间必须有跨进程可见的屏障')
    assert.equal(ownedBeforeDeletionFinished, false, '真实 PostgreSQL 中的持久屏障阻止 owner 与未结束删除穿插')
    await f.confirm(run)
    assert.equal(f.put.mock.calls.length, 1)
    assert.equal((await f.service.savedFile(f.user.id, f.conversation.id, 'reuse.txt', 1)).toString(), content)
    await f.end(run)
  })

  it('AC-08/09：删除响应未知后的迟到 DELETE 不能与新 owner/旧 SHA 发布竞态；重启保留写入屏障', async () => {
    const f = await fixture()
    const first = await f.newRun()
    f.source.push({ path: 'a.txt', content: Buffer.from('confirmed A') })
    await f.confirm(first)
    await f.end(first)
    const orphan = f.key('reuse after delete')
    f.objects.set(orphan, Buffer.from('reuse after delete'))
    f.remove.mockRejectedValueOnce(new WorkspaceDeleteOutcomeUnknownError())
    const failed = await f.gc.collect(f.conversation.id, true)
    assert.equal(failed.failed.length, 1)
    const target = await prisma.workspaceGcTarget.findUniqueOrThrow({ where: { conversationId: f.conversation.id } })
    assert.equal(target.deletingKey, orphan)
    assert.equal(target.deleteState, 'unknown')
    const restarted = new WorkspaceGcService(prisma, f.cloud)
    assert.match((await restarted.collect(f.conversation.id, true)).blocked!, /活动\/未知删除/)
    const next = await f.newRun()
    f.source[0]!.content = Buffer.from('reuse after delete')
    await assert.rejects(f.service.prepareCommit(next, new AbortController().signal), /回收结局尚未确认/)
    assert.equal(f.put.mock.calls.length, 1, '删除未知期间不能复用或 PUT 后发布同 SHA')
    await prisma.agentRun.update({ where: { id: next.runId }, data: { status: 'FAILED' } })
    // fake transport 在客户端超时后才执行真实删除；取得权威结束依据后模拟维护入口。
    f.objects.delete(orphan)
    await workspaceDb(prisma, async (db) => {
      await lockWorkspaceStorage(db, f.conversation.id)
      await db.workspaceGcTarget.update({ where: { conversationId: f.conversation.id }, data: { deletingKey: null, deleteId: null, deleteState: null, pending: true } })
    })
    const recovered = await f.newRun()
    await f.confirm(recovered)
    await f.end(recovered)
    await restarted.collect(f.conversation.id, true)
    assert.deepEqual([...f.objects.keys()], [orphan])
    assert.equal((await f.service.savedFile(f.user.id, f.conversation.id, 'a.txt', 2)).toString(), 'reuse after delete')
  })

  it('AC-07/09：上传结局未知不按超时或过期租约删除；重启保留目标，权威核查后与部分删除失败可重试', async () => {
    const f = await fixture()
    const run = await f.newRun()
    f.source.push({ path: 'a.txt', content: Buffer.from('confirmed') })
    await f.confirm(run)
    f.source[0]!.content = Buffer.from('unknown put')
    f.put.mockImplementationOnce(async (file, content) => {
      f.objects.set(file.key, content)
      throw new WorkspaceUploadOutcomeUnknownError()
    })
    await assert.rejects(f.service.prepareCommit(run, new AbortController().signal), /上传结果未知/)
    await f.end(run)
    const restarted = new WorkspaceGcService(prisma, f.cloud)
    const blocked = await restarted.collect(f.conversation.id, true)
    assert.match(blocked.blocked!, /活动\/未知上传/)
    assert.equal(blocked.deleted.length, 0)
    const upload = await prisma.workspaceUpload.findFirstOrThrow({ where: { conversationId: f.conversation.id, state: 'unknown' } })
    assert.deepEqual(upload.keys, [f.key('unknown put')])
    // 测试已取得 fake transport 的权威结局；模拟维护入口的显式核查，不以年龄推断。
    await workspaceDb(prisma, async (db) => {
      await lockWorkspaceStorage(db, f.conversation.id)
      await db.workspaceUpload.update({ where: { id: upload.id }, data: { state: 'settled' } })
    })
    f.objects.set(f.key('another orphan'), Buffer.from('another orphan'))
    f.remove.mockRejectedValueOnce(new WorkspaceOperationError('AccessDenied SECRET_NEVER_LOG'))
    const partial = await restarted.collect(f.conversation.id, true)
    assert.equal(partial.failed.length, 1)
    assert.equal(partial.deleted.length, 1)
    assert.equal(JSON.stringify(partial).includes('SECRET_NEVER_LOG'), false)
    const deletingBeforeRestart = f.remove.mock.calls.length
    const recovery = new WorkspaceGcService(prisma, f.cloud)
    vi.stubEnv('OSS_WORKSPACE_GC_ENABLED', 'true')
    recovery.onModuleInit()
    try {
      await vi.waitFor(async () => {
        assert.deepEqual([...f.objects.keys()], [f.key('confirmed')])
        assert.equal((await prisma.workspaceGcTarget.findUniqueOrThrow({ where: { conversationId: f.conversation.id } })).pending, false)
      })
      assert.equal(f.remove.mock.calls.length - deletingBeforeRestart, 1, '启动恢复只重试剩余失败对象')
    }
    finally {
      await recovery.onModuleDestroy()
      vi.stubEnv('OSS_WORKSPACE_GC_ENABLED', 'false')
    }
    assert.equal((await f.service.snapshot(f.user.id, f.conversation.id)).revision, 1)
    assert.equal((await f.gc.collect(f.conversation.id, true)).deleted.length, 0)
  })
})
