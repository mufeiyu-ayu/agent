import type { StoredWorkspaceFile, WorkspaceCommit } from './workspace-files.js'
import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { randomUUID } from 'node:crypto'
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import process from 'node:process'
import OSS from 'ali-oss'
import { AgentRunRecorderService } from '../agent-runtime/lifecycle/agent-run-recorder.service.js'
import { ConversationsService } from '../conversations/conversations.service.js'
import { PrismaService } from '../prisma/prisma.service.js'
import { WorkspaceCloudService, WorkspaceUploadOutcomeUnknownError } from './workspace-cloud.service.js'
import { lockWorkspaceStorage, workspaceDb } from './workspace-db.js'
import { fileHash } from './workspace-files.js'
import { WorkspaceGcService } from './workspace-gc.service.js'
import { WorkspaceMonitoringService } from './workspace-monitoring.service.js'
import { validateArtifact } from './workspace-preview.js'
import { WorkspacePreviewService } from './workspace-preview.service.js'
import { WorkspaceService } from './workspace.service.js'
import 'reflect-metadata'

/** 手动真实 OSS + 隔离 PostgreSQL；固定输入，不调用模型、不创建沙箱、不碰既有对象。 */
async function main() {
  const url = new URL(process.env.TEST_DATABASE_URL!)
  assert.notEqual(url.href, process.env.DATABASE_URL)
  assert.equal(url.hostname, '127.0.0.1')
  assert.equal(url.port, '5433')
  assert.equal(url.pathname, '/agent_integration')
  assert.equal(process.env.OSS_BUCKET, 'kuro-dev-files-ayu')
  assert.equal(process.env.OSS_REGION, 'oss-cn-hongkong')
  // 只影响此 smoke 进程，不修改私人 .env，不启动全环境自动 GC。
  process.env.OSS_WORKSPACE_GC_ENABLED = 'false'
  process.env.APP_ORIGINS = 'http://127.0.0.1:5173'
  const storageOptions = { region: process.env.OSS_REGION!, bucket: process.env.OSS_BUCKET!, accessKeyId: process.env.OSS_ACCESS_KEY_ID!, accessKeySecret: process.env.OSS_ACCESS_KEY_SECRET!, authorizationV4: true, secure: true, enableProxy: false, timeout: 15_000 }
  const storage = new OSS(storageOptions)
  assert.equal((await storage.getBucketACL(process.env.OSS_BUCKET!)).acl, 'private')
  const version = await (storage as OSS & { getBucketVersioning: (bucket: string) => Promise<{ versionStatus?: string }> }).getBucketVersioning(process.env.OSS_BUCKET!)
  assert.ok(!version.versionStatus, '仅允许未启用/未暂停版本控制的开发 Bucket')
  const id = randomUUID().replaceAll('-', '')
  const schema = `gc_cloud_${id}`
  const userId = `gc_check_${id}`
  const conversationId = `gc-check-${id}`
  const prefix = `users/${userId}/conversations/${conversationId}/`
  const directory = `/tmp/agent-gc-cloud-${id}`
  await mkdir(directory)
  const { Pool } = createRequire(import.meta.url)('pg') as { Pool: new (options: { connectionString: string }) => {
    query: (sql: string, values?: unknown[]) => Promise<unknown>
    connect: () => Promise<{ query: (sql: string, values?: unknown[]) => Promise<unknown>, release: () => void }>
    end: () => Promise<void>
  } }
  const pool = new Pool({ connectionString: url.href })
  let prisma: PrismaService | undefined
  let cleaned = false
  const report: Record<string, unknown> = { id, bucket: process.env.OSS_BUCKET, region: process.env.OSS_REGION, database: `${url.hostname}:${url.port}${url.pathname}`, schema, prefix, directory, kind: '真实 OSS/隔离 DB，固定输入，不是 Agent 云案例', acl: 'private', versionStatus: version.versionStatus ?? 'Unset', checks: [], cleaned: false }
  try {
    const client = await pool.connect()
    try {
      await client.query(`CREATE SCHEMA "${schema}"`)
      await client.query('SELECT set_config(\'search_path\', $1, false)', [`${schema},public`])
      const migrations = new URL('../../../../prisma/migrations/', import.meta.url)
      for (const migration of (await readdir(migrations)).sort()) {
        if (migration !== 'migration_lock.toml')
          await client.query(await readFile(new URL(`${migration}/migration.sql`, migrations), 'utf8'))
      }
    }
    finally { client.release() }
    url.searchParams.set('schema', schema)
    url.searchParams.set('options', `-c search_path=${schema},public`)
    prisma = new PrismaService(url.href)
    await prisma.$connect()
    await prisma.user.create({ data: { id: userId, email: `${id}@gc-check.invalid` } })
    await prisma.conversation.create({ data: { id: conversationId, userId, title: '本轮隔离 OSS GC' } })
    await prisma.conversationWorkspace.create({ data: { conversationId, userId } })
    const cloud = new WorkspaceCloudService()
    const gc = new WorkspaceGcService(prisma, cloud)
    const recorder = new AgentRunRecorderService(prisma)
    const previews = new WorkspacePreviewService(prisma, cloud)
    const workspaces = new WorkspaceService(prisma, cloud, new WorkspaceMonitoringService(prisma, cloud), gc)
    const signal = () => AbortSignal.timeout(30_000)
    const checks = report.checks as string[]
    async function save(source: Array<{ path: string, text: string }>, dist?: Array<{ path: string, text: string }>) {
      const message = await prisma!.message.create({ data: { conversationId, role: 'USER', content: 'GC 隔离输入' } })
      const run = await prisma!.agentRun.create({ data: { conversationId, userMessageId: message.id } })
      const previous = await workspaceDb(prisma!, async (db) => {
        await lockWorkspaceStorage(db, conversationId)
        await db.conversationWorkspace.update({ where: { conversationId }, data: { ownerRunId: run.id, leaseExpiresAt: new Date(Date.now() + 60_000) } })
        return db.conversationWorkspace.findUniqueOrThrow({ where: { conversationId } })
      })
      const execution = { userId, conversationId, runId: run.id, deadlineAt: Date.now() + 60_000 }
      const upload = await gc.beginUpload(execution)
      let unknown = false
      const stored = async (input: Array<{ path: string, text: string }>): Promise<StoredWorkspaceFile[]> => {
        const files: StoredWorkspaceFile[] = []
        for (const file of input) {
          const content = Buffer.from(file.text)
          const sha256 = fileHash(content)
          const record = { path: file.path, bytes: content.length, sha256, key: `${prefix}objects/${sha256}` }
          await gc.uploading(upload, record.key)
          await cloud.putFile(record, content, signal())
          files.push(record)
        }
        return files
      }
      try {
        const files = await stored(source)
        if (dist)
          validateArtifact(dist.map(file => ({ path: file.path, content: Buffer.from(file.text) })))
        const artifact = dist ? { id: randomUUID(), userId, sourceRevision: previous.revision + 1, command: 'GC fixture (no build executed)', createdAt: new Date().toISOString(), files: await stored(dist) } : undefined
        const commit: WorkspaceCommit = { conversationId, runId: run.id, expectedRevision: previous.revision, expectedArtifactId: previous.artifactId, sourceChanged: true, files, webProject: !!artifact || previous.webProject, ...(artifact ? { artifact } : {}) }
        const step = await prisma!.agentStep.create({ data: { runId: run.id, sequence: 1, type: 'tool_execution', title: '隔离保存', status: 'RUNNING' } })
        await recorder.completeStep(step.id, { deadlineAt: Date.now() + 5_000, createTimeoutError: () => new Error('隔离确认超时') }, { workspaceCommit: commit })
        await prisma!.agentRun.update({ where: { id: run.id }, data: { status: 'COMPLETED' } })
        await prisma!.conversationWorkspace.update({ where: { conversationId }, data: { ownerRunId: null, leaseExpiresAt: null } })
        return commit
      }
      catch (error) {
        unknown = error instanceof WorkspaceUploadOutcomeUnknownError
        throw error
      }
      finally { await gc.finishUpload(upload, unknown) }
    }
    const license = { path: 'SHADCN-LICENSE.md', text: 'isolated license' }
    const oldHtml = '<!doctype html><link rel="stylesheet" href="./assets/main.css"><h1>旧隔离构建</h1>'
    const newHtml = '<!doctype html><link rel="stylesheet" href="./assets/main.css"><h1>新隔离构建</h1>'
    const oldCss = 'body{color:red}'
    const a = await save([{ path: 'a.txt', text: 'A' }, license, { path: 'README.md', text: oldHtml }], [{ path: 'index.html', text: oldHtml }, { path: 'assets/main.css', text: oldCss }])
    const grant = await previews.open(userId, conversationId, a.artifact!.id, 'http://127.0.0.1:5173')
    const token = grant.url.split('/')[3]!
    await save([{ path: 'a.txt', text: 'B' }, license])
    const first = await gc.collect(conversationId, true)
    assert.ok(first.deleted.includes(`${prefix}objects/${fileHash(Buffer.from('A'))}`))
    assert.equal((await previews.resource(token, 'assets/main.css', signal())).content.toString(), oldCss)
    checks.push('A→B 的旧 Source 回收；Source 与 Artifact 共用 HTML 保留；未构建时旧 Preview 可读')
    const c = await save([{ path: 'a.txt', text: 'C' }, license], [{ path: 'index.html', text: newHtml }, { path: 'assets/main.css', text: 'body{color:blue}' }])
    const dry = await gc.collect(conversationId)
    assert.equal(dry.deleted.length, 0)
    await new WorkspaceGcService(prisma, cloud).collect(conversationId, true)
    assert.equal((await previews.resource(token, 'assets/main.css', signal())).content.toString(), oldCss)
    await assert.rejects(previews.open(userId, conversationId, a.artifact!.id, 'http://127.0.0.1:5173'))
    const zip = await workspaces.archive(userId, conversationId, c.expectedRevision + 1, signal())
    assert.ok(zip.includes(Buffer.from('SHADCN-LICENSE.md')))
    await writeFile(`${directory}/source.zip`, zip)
    checks.push('新构建确认后旧 token 固定旧 CSS、禁历史重开；独立 GC 实例读取持久保护；隐藏许可仍在 ZIP')
    // 有界保护到期故障注入，不等待十分钟，不将此称为真实 Agent 生成/浏览器验收。
    await prisma.workspaceArtifact.update({ where: { id: a.artifact!.id }, data: { previewExpiresAt: new Date(Date.now() - 1) } })
    const retired = await gc.collect(conversationId, true)
    assert.ok(retired.deleted.includes(`${prefix}objects/${fileHash(Buffer.from(oldCss))}`))
    assert.equal(await prisma.workspaceArtifact.count({ where: { conversationId } }), 1)
    assert.equal((await workspaces.savedFile(userId, conversationId, 'a.txt', c.expectedRevision + 1, signal())).toString(), 'C')
    checks.push('保护到期淘汰旧 Artifact/独占 CSS；当前 Source/Artifact 未受误删')
    report.dryRun = dry
    report.retired = retired
    report.pass = true
  }
  catch {
    report.pass = false
    report.error = '本轮隔离验证未完成；不输出 SDK 异常或凭据，检查持久目标与真实请求结局'
    process.exitCode = 1
  }
  finally {
    if (prisma) {
      try {
        await prisma.agentRun.updateMany({ where: { conversationId, status: 'RUNNING' }, data: { status: 'FAILED' } })
        const cloud = new WorkspaceCloudService()
        const gc = new WorkspaceGcService(prisma, cloud)
        if (await prisma.conversation.findUnique({ where: { id: conversationId } }))
          await new ConversationsService(prisma, gc).delete(userId, conversationId)
        report.cleanup = await gc.collect(conversationId, true)
        const remaining = await cloud.listFiles(prefix)
        const target = await prisma.workspaceGcTarget.findUnique({ where: { conversationId } })
        cleaned = remaining.keys.length === 0 && !remaining.nextMarker && !target?.deletingKey && (await prisma.workspaceUpload.count({ where: { conversationId, state: { not: 'settled' } } })) === 0
      }
      catch { cleaned = false }
      await prisma.$disconnect()
    }
    report.cleaned = cleaned
    if (cleaned) {
      await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
    }
    else {
      report.recovery = '保留本轮 schema/持久目标与报告供核查；不能丢弃未知上传/删除目标'
      process.exitCode = 1
    }
    await pool.end()
    await writeFile(`${directory}/report.json`, JSON.stringify(report, null, 2))
    console.log(JSON.stringify({ pass: report.pass, cleaned, directory, prefix, schema, checks: report.checks }))
  }
}

void main().catch(() => {
  console.error('环境/Bucket/权限核定失败，未开始云写入；不输出凭据。')
  process.exitCode = 1
})
