import type { AttachmentStorageService } from '../attachments/attachment-storage.service.js'
import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { createHash, randomUUID } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import process from 'node:process'
import { serializeGroup } from '@agent/agent'
import { Module } from '@nestjs/common'
import { APP_GUARD, NestFactory } from '@nestjs/core'
import { afterAll, beforeAll, describe, it, vi } from 'vitest'
import { loadConversationHistory } from '../agent-runtime/context/conversation-history.js'
import { AuthGuard } from '../auth/auth.guard.js'
import { AuthService } from '../auth/auth.service.js'
import { registerAppGlobals } from '../common/bootstrap/register-app-globals.js'
import { DatabaseCommitOutcomeUnknownError, PrismaService } from '../prisma/prisma.service.js'
import { withSkillSelection } from './skill-selection.js'
import { SkillsController } from './skills.controller.js'
import { SkillsService } from './skills.service.js'

const url = process.env.TEST_DATABASE_URL?.trim()
if (!url || url === process.env.DATABASE_URL?.trim())
  throw new Error('技能真实库测试只允许独立 TEST_DATABASE_URL')
const { Pool } = createRequire(import.meta.url)('pg') as { Pool: new (options: { connectionString: string, max: number }) => { query: (sql: string) => Promise<unknown>, end: () => Promise<void> } }
const files = (text = '按技能步骤执行。') => [{ path: 'SKILL.md', encoding: 'utf8', content: `---\nname: test-skill\ndescription: 专用测试技能\n---\n${text}` }]
const deadline = () => ({ deadlineAt: Date.now() + 30_000, createTimeoutError: () => new Error('timeout'), signal: new AbortController().signal })

describe('技能草稿与发布：隔离 PostgreSQL', { timeout: 60_000 }, () => {
  const schema = `skills_test_${randomUUID().replaceAll('-', '')}`
  const pool = new Pool({ connectionString: url, max: 1 })
  const objects = new Map<string, Buffer>()
  const storage = {
    bucket: 'isolated-test',
    async put(key: string, data: Buffer) { objects.set(key, data) },
    async read(key: string) {
      const value = objects.get(key)
      if (!value)
        throw new Error('object missing')
      return value
    },
  }
  let prisma: PrismaService
  let service: SkillsService
  let conversationId: string
  let userId: string
  beforeAll(async () => {
    await pool.query(`CREATE SCHEMA "${schema}"`)
    await pool.query(`SET search_path TO "${schema}", public`)
    const directory = new URL('../../../../prisma/migrations/', import.meta.url)
    for (const entry of (await readdir(directory)).filter(name => name !== 'migration_lock.toml').sort())
      await pool.query(await readFile(new URL(`${entry}/migration.sql`, directory), 'utf8'))
    const connection = new URL(url)
    connection.searchParams.set('schema', schema)
    connection.searchParams.set('options', `-c search_path=${schema},public`)
    prisma = new PrismaService(connection.toString())
    await prisma.$connect()
    userId = (await prisma.user.create({ data: { email: `${schema}@example.test` } })).id
    conversationId = (await prisma.conversation.create({ data: { title: '技能测试', userId } })).id
    service = new SkillsService(prisma, storage as unknown as AttachmentStorageService)
  })
  afterAll(async () => {
    await prisma?.$disconnect()
    await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
    await pool.end()
  })

  it('草稿不可发现，过期预览拒绝，重复发布幂等，修改确认前继续使用旧包', async () => {
    const draft = await service.saveDraft(userId, conversationId, { files: files() }, deadline())
    assert.equal((await service.snapshot(userId)).entries.some(item => item.id === draft.id), false)
    const edited = await service.saveDraft(userId, conversationId, { id: draft.id, expectedFingerprint: draft.fingerprint, files: files('修改') }, deadline())
    await assert.rejects(service.publish(userId, draft.id, draft.fingerprint), /预览已过期/)
    await Promise.all([service.publish(userId, draft.id, edited.fingerprint), service.publish(userId, draft.id, edited.fingerprint)])
    assert.equal(await prisma.skill.count({ where: { id: draft.id } }), 1)
    const snapshot = await service.snapshot(userId, [draft.id])
    const another = await service.saveDraft(userId, conversationId, { id: draft.id, expectedFingerprint: edited.fingerprint, files: files('再次修改') }, deadline())
    assert.equal((await service.preview(userId, draft.id)).fingerprint, edited.fingerprint)
    await service.publish(userId, draft.id, another.fingerprint)
    assert.match((await service.readPackage(userId, snapshot.entries.find(item => item.id === draft.id)!.contentId)).files[0]!.content, /修改$/)
    await service.setEnabled(userId, draft.id, false)
    await assert.rejects(service.snapshot(userId, [draft.id]), /不可用/)
    await service.remove(userId, draft.id)
    await assert.rejects(service.preview(userId, draft.id))
    assert.ok(await service.readPackage(userId, snapshot.entries.find(item => item.id === draft.id)!.contentId))
  })

  it('跨用户所有入口均拒绝，内置名称不能覆盖，非法文件与会话归属拒绝', async () => {
    const draft = await service.saveDraft(userId, conversationId, { files: files() }, deadline())
    for (const operation of [() => service.preview('other', draft.id, true), () => service.publish('other', draft.id, draft.fingerprint), () => service.setEnabled('other', draft.id, false), () => service.remove('other', draft.id), () => service.saveDraft('other', conversationId, { files: files() }, deadline()), () => service.readPackage('other', draft.fingerprint)])
      await assert.rejects(operation(), /不存在/)
    await assert.rejects(service.saveDraft(userId, conversationId, { files: [{ ...files()[0], content: files()[0]!.content.replace('test-skill', 'skill-creator') }] }, deadline()), /内置/)
    await assert.rejects(service.saveDraft(userId, conversationId, { files: [{ ...files()[0], path: '../SKILL.md' }] }, deadline()), /相对路径/)
  })

  it('并发编辑只有一份获确认；发布与编辑竞争不发布未经预览的内容', async () => {
    const original = await service.saveDraft(userId, conversationId, { files: files() }, deadline())
    const edits = await Promise.allSettled(['A', 'B'].map(text => service.saveDraft(userId, conversationId, { id: original.id, expectedFingerprint: original.fingerprint, files: files(text) }, deadline())))
    assert.equal(edits.filter(result => result.status === 'fulfilled').length, 1)
    const current = await service.preview(userId, original.id, true)
    await Promise.allSettled([service.publish(userId, original.id, current.fingerprint), service.saveDraft(userId, conversationId, { id: original.id, expectedFingerprint: current.fingerprint, files: files('C') }, deadline())])
    const row = await prisma.skill.findUniqueOrThrow({ where: { id: original.id } })
    assert.ok(row.publishedId === null || row.publishedId === current.fingerprint)
  })

  it('OSS 保存/读取与 DB 提交失败保持原草稿；取消不绑定新内容', async () => {
    const original = await service.saveDraft(userId, conversationId, { files: files() }, deadline())
    const put = vi.spyOn(storage, 'put').mockRejectedValueOnce(new Error('storage down'))
    await assert.rejects(service.saveDraft(userId, conversationId, { id: original.id, expectedFingerprint: original.fingerprint, files: files('bad') }, deadline()))
    put.mockRestore()
    const read = vi.spyOn(storage, 'read').mockRejectedValueOnce(new Error('storage down'))
    await assert.rejects(service.publish(userId, original.id, original.fingerprint))
    read.mockRestore()
    const transaction = vi.spyOn(prisma, 'withDeadlineTransaction').mockRejectedValueOnce(new Error('database down'))
    await assert.rejects(service.saveDraft(userId, conversationId, { id: original.id, expectedFingerprint: original.fingerprint, files: files('bad') }, deadline()))
    transaction.mockRestore()
    const publish = vi.spyOn(prisma, '$transaction').mockRejectedValueOnce(new Error('database down'))
    await assert.rejects(service.publish(userId, original.id, original.fingerprint))
    publish.mockRestore()
    const cancelled = { ...deadline(), signal: AbortSignal.abort() }
    await assert.rejects(service.saveDraft(userId, conversationId, { id: original.id, expectedFingerprint: original.fingerprint, files: files('bad') }, cancelled))
    const row = await prisma.skill.findUniqueOrThrow({ where: { id: original.id } })
    assert.equal(row.publishedId, null)
    assert.equal(row.draftId, original.fingerprint)
    assert.equal((await service.preview(userId, original.id, true)).fingerprint, original.fingerprint)
  })
  it('真实 SQL 约束故障回滚草稿指针与发布状态，不仅模拟数据库方法失败', async () => {
    const original = await service.saveDraft(userId, conversationId, { files: files() }, deadline())
    await prisma.$executeRawUnsafe('ALTER TABLE "SkillContent" ADD CONSTRAINT "skills_test_reject_adoption" CHECK (NOT "adopted") NOT VALID')
    try {
      await assert.rejects(service.saveDraft(userId, conversationId, { id: original.id, expectedFingerprint: original.fingerprint, files: files('事务中途失败') }, deadline()))
      const row = await prisma.skill.findUniqueOrThrow({ where: { id: original.id } })
      assert.equal(row.draftId, original.fingerprint)
      assert.equal(await prisma.skillContent.count({ where: { skillId: original.id, adopted: false } }), 1)
    }
    finally {
      await prisma.$executeRawUnsafe('ALTER TABLE "SkillContent" DROP CONSTRAINT "skills_test_reject_adoption"')
    }
    await prisma.$executeRawUnsafe('ALTER TABLE "Skill" ADD CONSTRAINT "skills_test_reject_publish" CHECK ("publishedId" IS NULL) NOT VALID')
    try {
      await assert.rejects(service.publish(userId, original.id, original.fingerprint))
      const row = await prisma.skill.findUniqueOrThrow({ where: { id: original.id } })
      assert.equal(row.publishedId, null)
      assert.equal(row.draftId, original.fingerprint)
    }
    finally {
      await prisma.$executeRawUnsafe('ALTER TABLE "Skill" DROP CONSTRAINT "skills_test_reject_publish"')
    }
  })

  it('二进制草稿资源可以按原文件引用保留，修改说明不丢失资产', async () => {
    const asset = { path: 'assets/chart.png', encoding: 'base64', content: Buffer.from([137, 80, 78, 71, 1, 2, 3]).toString('base64') }
    const original = await service.saveDraft(userId, conversationId, { files: [...files('使用 [图表](assets/chart.png)。'), asset] }, deadline())
    const edited = await service.saveDraft(userId, conversationId, { id: original.id, expectedFingerprint: original.fingerprint, files: files('新的说明。使用 [图表](assets/chart.png)。'), preservePaths: ['assets/chart.png'] }, deadline())
    assert.deepEqual(edited.files.find(file => file.path === asset.path), asset)
    assert.deepEqual((await service.preview(userId, original.id, true)).files.find(file => file.path === asset.path), asset)
    await assert.rejects(service.saveDraft(userId, conversationId, { id: original.id, expectedFingerprint: edited.fingerprint, files: files(), preservePaths: ['assets/missing.png'] }, deadline()), /不在当前草稿/)
  })

  it('草稿事务已提交但连接响应丢失时暴露 COMMIT unknown，草稿仍可找回', async () => {
    const transaction = prisma.$transaction.bind(prisma)
    const spy = vi.spyOn(prisma, '$transaction').mockImplementationOnce((async (callback: any, options: any) => {
      await transaction(callback, options)
      throw Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' })
    }) as typeof prisma.$transaction)
    const before = await prisma.skill.count()
    try {
      await assert.rejects(service.saveDraft(userId, conversationId, { files: files() }, deadline()), error => error instanceof DatabaseCommitOutcomeUnknownError)
    }
    finally { spy.mockRestore() }
    assert.equal(await prisma.skill.count(), before + 1)
    const saved = await prisma.skill.findFirstOrThrow({ orderBy: { createdAt: 'desc' } })
    assert.equal(saved.publishedId, null)
    assert.ok((await service.preview(userId, saved.id, true)).files.length)
  })

  it('纯文本显式技能选择不依赖 read_skill 工具，刷新历史和摘要输入仍有选择身份', async () => {
    const selectedIds = ['builtin:skill-creator']
    const question = await prisma.message.create({ data: { conversationId, role: 'USER', content: '按所选技能处理。', status: 'COMPLETED' } })
    const answer = await prisma.message.create({ data: { conversationId, role: 'ASSISTANT', content: '已处理。', status: 'COMPLETED' } })
    const run = await prisma.agentRun.create({ data: { conversationId, userMessageId: question.id, assistantMessageId: answer.id, status: 'COMPLETED' } })
    await prisma.agentStep.create({ data: { runId: run.id, sequence: 1, type: 'model_sampling', title: '模型采样', status: 'COMPLETED', input: { samplingAttemptId: 'selected-test', skills: { selectedIds } }, output: { toolCallCount: 0 } } })
    const { history } = await loadConversationHistory(prisma, conversationId, undefined, deadline())
    const group = history.groups.find(group => group.key === question.id)!
    assert.equal(group.question?.content, withSkillSelection(question.content, selectedIds))
    assert.match(serializeGroup(group, false), /builtin:skill-creator/)
    assert.equal((await prisma.message.findUniqueOrThrow({ where: { id: question.id } })).content, question.content)
  })

  it('停止和失败的问答仍从用户问题所属 Run 恢复显式选择', async () => {
    for (const status of ['ABORTED', 'FAILED'] as const) {
      const question = await prisma.message.create({ data: { conversationId, role: 'USER', content: `先前${status}的问题`, status: 'COMPLETED' } })
      const answer = await prisma.message.create({ data: { conversationId, role: 'ASSISTANT', content: '', status } })
      const run = await prisma.agentRun.create({ data: { conversationId, userMessageId: question.id, assistantMessageId: answer.id, status } })
      await prisma.agentStep.create({ data: { runId: run.id, sequence: 1, type: 'model_sampling', title: '模型采样', status, input: { skills: { selectedIds: ['selected-before-stop'] } } } })
      const { history } = await loadConversationHistory(prisma, conversationId, undefined, deadline())
      const group = history.groups.find(group => group.key === question.id)!
      assert.match(group.question!.content, /selected-before-stop/)
      assert.match(serializeGroup(group, false), /selected-before-stop/)
      assert.equal(group.answered, false)
    }
  })

  it('实际 HTTP 鉴权、CSRF、归属和 DTO 校验；用户确认才能发布', async () => {
    const draft = await service.saveDraft(userId, conversationId, { files: files() }, deadline())
    const other = await prisma.user.create({ data: { email: `${randomUUID()}@example.test`, mustChangePassword: false } })
    await prisma.user.update({ where: { id: userId }, data: { mustChangePassword: false } })
    const tokens = [randomUUID(), randomUUID()]
    for (const [index, id] of [userId, other.id].entries())
      await prisma.session.create({ data: { userId: id, tokenHash: createHash('sha256').update(tokens[index]!).digest('hex'), expiresAt: new Date(Date.now() + 60000) } })
    @Module({ controllers: [SkillsController], providers: [{ provide: SkillsService, useValue: service }, { provide: PrismaService, useValue: prisma }, AuthService, { provide: APP_GUARD, useClass: AuthGuard }] })
    class TestApp {}
    const app = await NestFactory.create(TestApp, { logger: false })
    registerAppGlobals(app)
    await app.listen(0, '127.0.0.1')
    const base = await app.getUrl()
    const request = (path: string, token: string | undefined, method = 'GET', body?: unknown, origin = 'http://localhost:5173') => fetch(`${base}/api/skills${path}`, { method, headers: { origin, 'content-type': 'application/json', ...(token ? { cookie: `agent_session=${token}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) })
    try {
      assert.equal((await request('', undefined)).status, 401)
      assert.equal((await request(`/${draft.id}?draft=true`, tokens[1])).status, 404)
      assert.equal((await request(`/${draft.id}/publish`, tokens[1], 'POST', { fingerprint: draft.fingerprint })).status, 404)
      assert.equal((await request(`/${draft.id}`, tokens[1], 'PATCH', { enabled: false })).status, 404)
      assert.equal((await request(`/${draft.id}`, tokens[1], 'DELETE')).status, 404)
      assert.equal((await request(`/${draft.id}/publish`, tokens[0], 'POST', { fingerprint: draft.fingerprint }, 'https://evil.example')).status, 403)
      assert.equal((await request(`/${draft.id}/publish`, tokens[0], 'POST', { fingerprint: null })).status, 400)
      assert.equal((await request(`/${draft.id}/publish`, tokens[0], 'POST', { fingerprint: 'stale' })).status, 409)
      assert.equal((await request(`/${draft.id}/publish`, tokens[0], 'POST', { fingerprint: draft.fingerprint })).status, 201)
      assert.equal((await prisma.skill.findUniqueOrThrow({ where: { id: draft.id } })).publishedId, draft.fingerprint)
    }
    finally {
      // app.close 会调用同一个 Prisma 实例的 disconnect；后续用例会自动重连。
      await app.close()
    }
  })
})
