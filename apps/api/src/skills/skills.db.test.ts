import type { AttachmentStorageService } from '../attachments/attachment-storage.service.js'
import type { AttachmentsService } from '../attachments/attachments.service.js'
import type { WorkspaceGcService } from '../workspaces/workspace-gc.service.js'
import type { SkillExamplesService } from './skill-examples.service.js'
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
import { createRuntimeHost } from '../agent-runtime/agent-runtime-host.js'
import { loadConversationHistory } from '../agent-runtime/context/conversation-history.js'
import { AuthGuard } from '../auth/auth.guard.js'
import { AuthService } from '../auth/auth.service.js'
import { registerAppGlobals } from '../common/bootstrap/register-app-globals.js'
import { ConversationsService } from '../conversations/conversations.service.js'
import { MessagesService } from '../conversations/messages.service.js'
import { DatabaseCommitOutcomeUnknownError, PrismaService } from '../prisma/prisma.service.js'
import { ToolInvocationService } from '../tools/core/tool-invocation.service.js'
import { ToolRegistryService } from '../tools/core/tool-registry.service.js'
import { readSkillDefinition, readSkillDraftDefinition, ReadSkillDraftTool, ReadSkillTool } from '../tools/skill-tools.js'
import { AdminSkillsController } from './admin-skills.controller.js'
import { withSkillSelection } from './skill-selection.js'
import { SkillsController } from './skills.controller.js'
import { CREATOR_ID, SkillsService } from './skills.service.js'

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
    configured: false,
    bucket: 'isolated-test',
    async put(key: string, data: Buffer) { objects.set(key, data) },
    async delete(key: string) { objects.delete(key) },
    async read(key: string) {
      const value = objects.get(key)
      if (!value)
        throw new Error('object missing')
      return value
    },
  }
  const examples = { generate: vi.fn(async () => ['请使用这个技能帮我处理一份工作材料。', '请使用这个技能检查已有内容并提出改进建议。', '请按照这个技能整理一份可复用的工作清单。']) }
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
    service = new SkillsService(prisma, storage as unknown as AttachmentStorageService, examples as unknown as SkillExamplesService)
  })
  afterAll(async () => {
    await prisma?.$disconnect()
    await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
    await pool.end()
  })

  it('草稿不可发现，过期预览拒绝，重复发布幂等；更新只维护一个当前技能', async () => {
    const draft = await service.saveDraft(userId, conversationId, { files: files('原说明') }, deadline())
    assert.equal((await service.snapshot(userId)).entries.some(item => item.id === draft.id), false)
    const edited = await service.saveDraft(userId, conversationId, { id: draft.id, expectedFingerprint: draft.fingerprint, files: files('确认说明') }, deadline())
    await assert.rejects(service.publish(userId, draft.id, draft.fingerprint), /预览已过期/)
    await Promise.all([service.publish(userId, draft.id, edited.fingerprint), service.publish(userId, draft.id, edited.fingerprint)])
    const another = await service.saveDraft(userId, conversationId, { id: draft.id, expectedFingerprint: edited.fingerprint, files: files('再次修改') }, deadline())
    assert.equal((await service.preview(userId, draft.id)).fingerprint, edited.fingerprint)
    await service.publish(userId, draft.id, another.fingerprint)
    assert.equal((await service.list(userId)).filter(item => item.id === draft.id).length, 1)
    assert.match((await service.preview(userId, draft.id)).files[0]!.content, /再次修改$/)
    await service.setEnabled(userId, draft.id, false)
    await assert.rejects(service.snapshot(userId, [draft.id]), /不可用/)
    await service.remove(userId, draft.id)
    await assert.rejects(service.preview(userId, draft.id), /不存在/)
  })

  it('同内容保存转移草稿来源会话且复用对象，删除旧会话不影响新入口', async () => {
    const first = await prisma.conversation.create({ data: { userId, title: '原会话' } })
    const second = await prisma.conversation.create({ data: { userId, title: '当前会话' } })
    const draft = await service.saveDraft(userId, first.id, { files: files() }, deadline())
    const before = await prisma.skill.findUniqueOrThrow({ where: { id: draft.id } })
    const put = vi.spyOn(storage, 'put')
    try {
      const saved = await service.saveDraft(userId, second.id, { id: draft.id, files: files(), expectedFingerprint: draft.fingerprint }, deadline())
      assert.equal(saved.conversationId, second.id)
      assert.equal((await prisma.skill.findUniqueOrThrow({ where: { id: draft.id } })).draftId, before.draftId)
      assert.equal(put.mock.calls.length, 0)
      assert.deepEqual(await service.listConversationDrafts(userId, first.id), [])
      assert.equal((await service.listConversationDrafts(userId, second.id))[0]?.id, draft.id)
      const gc = { register: vi.fn(async () => {}), kick: vi.fn() } as unknown as WorkspaceGcService
      const attachments = { markConversationDeleted: vi.fn(async () => {}), kickSweep: vi.fn() } as unknown as AttachmentsService
      await new ConversationsService(prisma, gc, attachments, service).delete(userId, first.id)
      assert.equal((await service.preview(userId, draft.id, true)).conversationId, second.id)
      assert.equal(await prisma.skillContent.count({ where: { skillId: draft.id, adopted: true } }), 1)
    }
    finally { put.mockRestore() }
  })

  it('跨用户所有入口均拒绝，内置名称不能覆盖，非法文件与会话归属拒绝', async () => {
    const draft = await service.saveDraft(userId, conversationId, { files: files() }, deadline())
    const row = await prisma.skill.findUniqueOrThrow({ where: { id: draft.id } })
    for (const operation of [() => service.preview('other', draft.id, true), () => service.publish('other', draft.id, draft.fingerprint), () => service.setEnabled('other', draft.id, false), () => service.remove('other', draft.id), () => service.saveDraft('other', conversationId, { files: files() }, deadline()), () => service.readPackage('other', row.draftId!)])
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
    if (row.publishedId)
      assert.equal((await prisma.skillContent.findUniqueOrThrow({ where: { id: row.publishedId } })).fingerprint, current.fingerprint)
  })

  it('OSS 保存/读取与 DB 提交失败保持原草稿；取消不绑定新内容', async () => {
    const original = await service.saveDraft(userId, conversationId, { files: files() }, deadline())
    const put = vi.spyOn(storage, 'put').mockRejectedValueOnce(Object.assign(new Error('AccessDenied'), { status: 403 }))
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
    assert.equal((await prisma.skillContent.findUniqueOrThrow({ where: { id: row.draftId! } })).fingerprint, original.fingerprint)
    assert.equal((await service.preview(userId, original.id, true)).fingerprint, original.fingerprint)
  })
  it('真实 SQL 约束故障回滚草稿指针与发布状态，不仅模拟数据库方法失败', async () => {
    const original = await service.saveDraft(userId, conversationId, { files: files() }, deadline())
    await prisma.$executeRawUnsafe('ALTER TABLE "SkillContent" ADD CONSTRAINT "skills_test_reject_adoption" CHECK (NOT "adopted") NOT VALID')
    try {
      await assert.rejects(service.saveDraft(userId, conversationId, { id: original.id, expectedFingerprint: original.fingerprint, files: files('事务中途失败') }, deadline()))
      const row = await prisma.skill.findUniqueOrThrow({ where: { id: original.id } })
      assert.equal((await prisma.skillContent.findUniqueOrThrow({ where: { id: row.draftId! } })).fingerprint, original.fingerprint)
      assert.equal((await service.preview(userId, original.id, true)).fingerprint, original.fingerprint)
    }
    finally {
      await prisma.$executeRawUnsafe('ALTER TABLE "SkillContent" DROP CONSTRAINT "skills_test_reject_adoption"')
    }
    await prisma.$executeRawUnsafe('ALTER TABLE "Skill" ADD CONSTRAINT "skills_test_reject_publish" CHECK ("publishedId" IS NULL) NOT VALID')
    try {
      await assert.rejects(service.publish(userId, original.id, original.fingerprint))
      const row = await prisma.skill.findUniqueOrThrow({ where: { id: original.id } })
      assert.equal(row.publishedId, null)
      assert.equal((await prisma.skillContent.findUniqueOrThrow({ where: { id: row.draftId! } })).fingerprint, original.fingerprint)
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

  it('PUT 结果未知保留身份，后续保存和 sweep 不能绕过；迟到 A 不覆盖已确认 B', async () => {
    const original = await service.saveDraft(userId, conversationId, { files: files('原文') }, deadline())
    let latePut!: () => void
    let key = ''
    const put = vi.spyOn(storage, 'put').mockImplementationOnce(async (objectKey, data) => {
      key = objectKey
      latePut = () => objects.set(objectKey, data)
      throw Object.assign(new Error('connection timeout'), { code: 'ConnectionTimeoutError' })
    })
    try {
      await assert.rejects(service.saveDraft(userId, conversationId, { id: original.id, expectedFingerprint: original.fingerprint, files: files('A') }, deadline()), /结果未知/)
      const reserved = await prisma.skillContent.findFirstOrThrow({ where: { objectKey: key } })
      assert.ok(reserved.uploadId)
      await assert.rejects(service.saveDraft(userId, conversationId, { id: original.id, expectedFingerprint: original.fingerprint, files: files('B') }, deadline()), /尚未确认/)
      storage.configured = true
      await service.sweep()
      assert.equal((await prisma.skillContent.findUniqueOrThrow({ where: { id: reserved.id } })).uploadId, reserved.uploadId)
      latePut()
      await service.sweep()
      assert.equal(objects.has(key), true)
      assert.equal((await service.preview(userId, original.id, true)).fingerprint, original.fingerprint)
      // 故障模拟器确认迟到 PUT 已结束；相当于管理员核查确切上传身份后解锁。
      await prisma.skillContent.updateMany({ where: { id: reserved.id, uploadId: reserved.uploadId }, data: { uploadId: null } })
      const saved = await service.saveDraft(userId, conversationId, { id: original.id, expectedFingerprint: original.fingerprint, files: files('B') }, deadline())
      latePut()
      assert.equal((await service.preview(userId, original.id, true)).fingerprint, saved.fingerprint)
      assert.match((await service.preview(userId, original.id, true)).files[0]!.content, /B$/)
    }
    finally {
      put.mockRestore()
      storage.configured = false
    }
  })

  it('首次 PUT 期间取消仍有持久登记，上传结束后才清理对象', async () => {
    const controller = new AbortController()
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    let key = ''
    const put = vi.spyOn(storage, 'put').mockImplementationOnce(async (objectKey, data) => {
      key = objectKey
      objects.set(objectKey, data)
      await gate
    })
    const saving = service.saveDraft(userId, conversationId, { files: files('取消上传') }, { ...deadline(), signal: controller.signal })
    const rejected = assert.rejects(saving)
    try {
      await vi.waitFor(() => assert.ok(key))
      controller.abort()
      await rejected
      const reserved = await prisma.skillContent.findFirstOrThrow({ where: { objectKey: key } })
      assert.ok(reserved.uploadId)
      storage.configured = true
      await service.sweep()
      assert.equal(objects.has(key), true)
      release()
      await vi.waitFor(async () => {
        assert.equal(objects.has(key), false)
        assert.equal(await prisma.skillContent.findUnique({ where: { id: reserved.id } }), null)
      })
    }
    finally {
      release()
      storage.configured = false
      put.mockRestore()
    }
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
    const drafts = await service.listConversationDrafts(userId, conversationId)
    const saved = drafts.at(-1)!
    assert.equal(saved.published, false)
    assert.ok((await service.preview(userId, saved.id, true)).files.length)
    await assert.rejects(service.listConversationDrafts('other', conversationId), /不存在/)
  })

  it('只发技能不依赖用户文字和 read_skill 工具，刷新历史和摘要输入仍有选择身份', async () => {
    const selectedIds = ['builtin:skill-creator']
    const question = await prisma.message.create({ data: { conversationId, role: 'USER', content: '', status: 'COMPLETED', skills: [{ id: 'builtin:skill-creator', name: 'skill-creator' }] } })
    const answer = await prisma.message.create({ data: { conversationId, role: 'ASSISTANT', content: '已处理。', status: 'COMPLETED' } })
    const run = await prisma.agentRun.create({ data: { conversationId, userMessageId: question.id, assistantMessageId: answer.id, status: 'COMPLETED' } })
    await prisma.agentStep.create({ data: { runId: run.id, sequence: 1, type: 'model_sampling', title: '模型采样', status: 'COMPLETED', input: { samplingAttemptId: 'selected-test', skills: { selectedIds, entries: [{ id: 'builtin:skill-creator', name: 'skill-creator' }, { id: 'unselected', name: 'other-skill' }] } }, output: { toolCallCount: 0 } } })
    const { history } = await loadConversationHistory(prisma, conversationId, undefined, deadline())
    const group = history.groups.find(group => group.key === question.id)!
    assert.equal(group.question?.content, withSkillSelection(question.content, selectedIds))
    assert.match(serializeGroup(group, false), /builtin:skill-creator/)
    assert.equal((await prisma.message.findUniqueOrThrow({ where: { id: question.id } })).content, question.content)
    const messages = await new MessagesService(prisma, new ConversationsService(prisma)).listMessages(userId, conversationId)
    assert.deepEqual(messages.find(message => message.id === question.id)?.skills, [{ id: 'builtin:skill-creator', name: 'skill-creator' }])
    assert.equal(messages.find(message => message.id === answer.id)?.skills, undefined)
    await prisma.agentStep.create({ data: { runId: run.id, sequence: 2, type: 'tool_execution', title: '保存技能', status: 'COMPLETED', input: { toolName: 'save_skill_draft', callId: 'legacy-save' }, output: { ok: true, observation: JSON.stringify({ id: 'legacy-skill-id', name: 'legacy-skill', draft: true }) } } })
    const restored = await new MessagesService(prisma, new ConversationsService(prisma)).listMessages(userId, conversationId)
    const tool = restored.find(message => message.id === answer.id)?.activity?.items.find(item => item.kind === 'tool')
    assert.deepEqual(tool?.kind === 'tool' && tool.skill, { id: 'legacy-skill-id', name: 'legacy-skill' })
  })

  it('停止和失败的问答仍从用户问题所属 Run 恢复显式选择', async () => {
    for (const status of ['ABORTED', 'FAILED'] as const) {
      const question = await prisma.message.create({ data: { conversationId, role: 'USER', content: `先前${status}的问题`, status: 'COMPLETED', skills: [{ id: 'selected-before-stop', name: 'selected-skill' }] } })
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
  it('只保留当前草稿/发布内容；替换后的旧对象直接清理', async () => {
    let draft = await service.saveDraft(userId, conversationId, { files: files('初稿') }, deadline())
    storage.configured = true
    try {
      for (let index = 0; index < 3; index++) {
        draft = await service.saveDraft(userId, conversationId, { id: draft.id, expectedFingerprint: draft.fingerprint, files: files(`草稿 ${index}`) }, deadline())
        await service.sweep()
        assert.equal(await prisma.skillContent.count({ where: { skillId: draft.id } }), 1)
      }
      const unchanged = vi.spyOn(storage, 'put')
      await service.saveDraft(userId, conversationId, { id: draft.id, expectedFingerprint: draft.fingerprint, files: draft.files }, deadline())
      assert.equal(unchanged.mock.calls.length, 0)
      unchanged.mockRestore()
      await service.publish(userId, draft.id, draft.fingerprint)
      // 旧实现发布后留着 adopted=true 的备用草稿槽，升级后也须清理。
      const current = await prisma.skillContent.findFirstOrThrow({ where: { skillId: draft.id, adopted: true } })
      const legacyKey = `users/${userId}/skills/${draft.id}/legacy-draft.json`
      await prisma.skillContent.create({ data: { ...current, id: randomUUID(), objectKey: legacyKey } })
      objects.set(legacyKey, Buffer.from(JSON.stringify(draft.files)))
      const noPut = vi.spyOn(storage, 'put')
      const noChange = await service.saveManualDraft(userId, draft.id, draft.files, draft.fingerprint)
      assert.equal(noChange.draft, true)
      assert.equal(noPut.mock.calls.length, 0)
      noPut.mockRestore()
      await service.sweep()
      assert.equal(objects.has(legacyKey), false)
      await service.publish(userId, draft.id, noChange.fingerprint)
      await service.sweep()
      assert.equal(objects.has(legacyKey), false)
      assert.equal(await prisma.skillContent.count({ where: { skillId: draft.id } }), 1)
      for (let index = 0; index < 3; index++) {
        const before = await service.preview(userId, draft.id)
        draft = await service.saveDraft(userId, conversationId, { id: draft.id, expectedFingerprint: before.fingerprint, files: files(`发布修改 ${index}`) }, deadline())
        assert.equal((await service.preview(userId, draft.id)).fingerprint, before.fingerprint)
        await service.publish(userId, draft.id, draft.fingerprint)
        await service.sweep()
        assert.equal(await prisma.skillContent.count({ where: { skillId: draft.id } }), 1)
      }
    }
    finally { storage.configured = false }
  })

  it('用户选择与 Message 同事务落库；无 Run/首采样也能恢复仅技能消息，附件失败不抹掉选择', async () => {
    const snapshot = await service.snapshot(userId, ['builtin:skill-creator'])
    const host = createRuntimeHost({ userId, skills: snapshot } as Parameters<typeof createRuntimeHost>[0], {
      prisma,
      recorder: {},
      attachments: { bind: async () => [], modelInput: async () => { throw new Error('before sampling failed') } },
    } as unknown as Parameters<typeof createRuntimeHost>[1])
    {
      const question = await host.createUserMessage(conversationId, '', [])
      await assert.rejects(host.loadUserMessage!(question), /before sampling failed/)
      assert.equal(await prisma.agentRun.count({ where: { userMessageId: question.id } }), 0)
      const messages = await new MessagesService(prisma, new ConversationsService(prisma)).listMessages(userId, conversationId)
      assert.deepEqual(messages.find(message => message.id === question.id)?.skills, [{ id: 'builtin:skill-creator', name: 'skill-creator' }])
      const { history } = await loadConversationHistory(prisma, conversationId, undefined, deadline())
      assert.match(history.groups.find(group => group.key === question.id)!.question!.content, /builtin:skill-creator/)
    }
  })

  it('PUT 成功后真实 COMMIT 约束失败，列表/预览/发布保持原内容，孤立对象可回收', async () => {
    const original = await service.createManualSkill(userId, files('已确认'))
    await prisma.$executeRawUnsafe(`CREATE FUNCTION reject_skill_commit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."draftId" IS NOT NULL THEN RAISE EXCEPTION 'reject deferred skill commit'; END IF; RETURN NEW; END $$`)
    await prisma.$executeRawUnsafe('CREATE CONSTRAINT TRIGGER reject_skill_commit AFTER UPDATE ON "Skill" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION reject_skill_commit()')
    const put = vi.spyOn(storage, 'put')
    try {
      await assert.rejects(service.saveManualDraft(userId, original.id, files('未确认'), original.fingerprint))
      assert.equal(put.mock.calls.length, 1)
      assert.ok(objects.has(put.mock.calls[0]![0]))
      assert.equal((await service.list(userId)).find(row => row.id === original.id)?.name, original.name)
      assert.equal((await service.preview(userId, original.id, true)).fingerprint, original.fingerprint)
      assert.equal((await service.preview(userId, original.id)).draft, false)
      await vi.waitFor(async () => assert.equal((await prisma.skillContent.findFirstOrThrow({ where: { objectKey: put.mock.calls[0]![0] } })).uploadId, null))
      storage.configured = true
      await service.sweep()
      assert.equal(objects.has(put.mock.calls[0]![0]), false)
    }
    finally {
      storage.configured = false
      put.mockRestore()
      await prisma.$executeRawUnsafe('DROP TRIGGER reject_skill_commit ON "Skill"')
      await prisma.$executeRawUnsafe('DROP FUNCTION reject_skill_commit()')
    }
  })

  it('删除对话清理草稿和 OSS，保留已发布及其他对话技能；失败能重试', async () => {
    const conversation = await prisma.conversation.create({ data: { userId, title: '删除技能草稿' } })
    const unpublished = await service.saveDraft(userId, conversation.id, { files: files('待删除') }, deadline())
    const released = await service.saveDraft(userId, conversation.id, { files: files('已发布') }, deadline())
    await service.publish(userId, released.id, released.fingerprint)
    // 已发布技能在这个对话里再次产生未发布修改。
    const pending = await service.saveDraft(userId, conversation.id, { id: released.id, expectedFingerprint: released.fingerprint, files: files('不发布的修改') }, deadline())
    const unrelated = await service.saveDraft(userId, conversationId, { files: files('其他对话') }, deadline())
    const releasedKey = (await prisma.skillContent.findUniqueOrThrow({ where: { id: (await prisma.skill.findUniqueOrThrow({ where: { id: released.id } })).publishedId! } })).objectKey
    assert.equal((await service.list(userId)).some(skill => skill.id === unpublished.id), false)
    const gc = { register: vi.fn(async () => {}), kick: vi.fn() } as unknown as WorkspaceGcService
    const attachments = { markConversationDeleted: vi.fn(async () => {}), kickSweep: vi.fn() } as unknown as AttachmentsService
    const conversations = new ConversationsService(prisma, gc, attachments, service)
    await assert.rejects(conversations.delete('other-user', conversation.id), /不存在/)
    await conversations.delete(userId, conversation.id)
    assert.equal(await prisma.conversation.findUnique({ where: { id: conversation.id } }), null)
    await assert.rejects(service.preview(userId, unpublished.id, true), /不存在/)
    await assert.rejects(service.saveDraft(userId, conversation.id, { files: files('迟到保存') }, deadline()), /会话不存在/)
    assert.equal((await service.preview(userId, released.id)).fingerprint, released.fingerprint)
    assert.equal((await service.preview(userId, released.id)).conversationId, null)
    assert.notEqual(pending.fingerprint, released.fingerprint)
    const doomed = await prisma.skillContent.findMany({ where: { skillId: { in: [unpublished.id, released.id] }, adopted: false } })
    assert.equal(doomed.length, 2)
    const failDelete = vi.spyOn(storage, 'delete').mockImplementation(async (key) => {
      if (doomed.some(row => row.objectKey === key))
        throw new Error('OSS unavailable')
      objects.delete(key)
    })
    storage.configured = true
    try {
      await service.sweep()
      assert.equal(await prisma.skillContent.count({ where: { id: { in: doomed.map(row => row.id) } } }), 2)
      failDelete.mockRestore()
      await new SkillsService(prisma, storage as unknown as AttachmentStorageService, examples as unknown as SkillExamplesService).sweep()
      for (const row of doomed)
        assert.equal(objects.has(row.objectKey), false)
      assert.equal(await prisma.skill.findUnique({ where: { id: unpublished.id } }), null)
      assert.equal(await prisma.skillContent.count({ where: { id: { in: doomed.map(row => row.id) } } }), 0)
      assert.equal(objects.has(releasedKey), true)
      assert.ok(await service.preview(userId, unrelated.id, true))
      assert.equal((await service.list(userId)).some(skill => skill.id === released.id), true)
    }
    finally {
      storage.configured = false
      failDelete.mockRestore()
    }
  })

  it('列表两次查询间内容被删除时跳过缺失项，仍返回剩余技能', async () => {
    const skill = await service.createManualSkill(userId, files())
    const find = prisma.skillContent.findMany.bind(prisma.skillContent)
    const spy = vi.spyOn(prisma.skillContent, 'findMany').mockImplementationOnce((async (args: Parameters<typeof find>[0]) => {
      await service.remove(userId, skill.id)
      storage.configured = true
      await service.sweep()
      return find(args)
    }) as typeof find)
    try {
      const items = await service.list(userId)
      assert.equal(items.some(item => item.id === skill.id), false)
      assert.ok(items.some(item => item.builtin))
    }
    finally {
      spy.mockRestore()
      storage.configured = false
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
      const realWrite = prisma.withDeadlineTransaction.bind(prisma)
      const unknown = vi.spyOn(prisma, 'withDeadlineTransaction').mockImplementationOnce((async (...args: Parameters<typeof realWrite>) => {
        await realWrite(...args)
        throw new DatabaseCommitOutcomeUnknownError('INTERNAL_CONNECTION_SECRET')
      }) as typeof realWrite)
      try {
        const response = await request('', tokens[0], 'POST', { files: files('已提交但返回未知') })
        assert.equal(response.status, 500)
        const body = await response.json()
        assert.match(body.message, /结果未知.*刷新核对/)
        assert.equal(body.error.error, 'DatabaseCommitOutcomeUnknown')
        assert.equal(JSON.stringify(body).includes('INTERNAL_CONNECTION_SECRET'), false)
        assert.ok((await service.list(userId)).some(item => item.published))
      }
      finally { unknown.mockRestore() }
      const smallRoute = await fetch(`${base}/api/unrelated`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ data: 'x'.repeat(160 * 1024) }) })
      assert.equal(smallRoute.status, 413)
      assert.equal((await request('', undefined)).status, 401)
      assert.equal((await request('', undefined, 'POST', { files: files() })).status, 401)
      assert.equal((await request('', tokens[0], 'POST', { files: files() }, 'https://evil.example')).status, 403)
      assert.equal((await request('', tokens[0], 'POST', { files: 'invalid' })).status, 400)
      assert.equal((await request('', tokens[0], 'POST', { files: files('x'.repeat(160 * 1024)) })).status, 201)
      assert.equal((await request('', tokens[0], 'POST', { files: files('x'.repeat(512 * 1024)) })).status, 400)
      const conversationsBefore = await prisma.conversation.count({ where: { userId } })
      const createdResponse = await request('', tokens[0], 'POST', { files: files('手动创建') })
      assert.equal(createdResponse.status, 201)
      const manual = (await createdResponse.json()).data
      assert.equal(manual.conversationId, null)
      assert.equal(manual.published, true)
      assert.equal(manual.draft, false)
      assert.equal(await prisma.conversation.count({ where: { userId } }), conversationsBefore)
      assert.equal((await request(`/${manual.id}?draft=true`, tokens[1])).status, 404)
      const editedManual = await request(`/${manual.id}/draft`, tokens[0], 'PUT', { files: files('手动创建后编辑'), expectedFingerprint: manual.fingerprint })
      assert.equal(editedManual.status, 200)
      const editedManualBody = (await editedManual.json()).data
      assert.equal((await request(`/${manual.id}/publish`, tokens[0], 'POST', { fingerprint: editedManualBody.fingerprint })).status, 201)
      assert.equal(await prisma.skillContent.count({ where: { skillId: manual.id } }), 2)
      assert.equal((await service.preview(userId, manual.id)).conversationId, null)
      assert.equal((await request(`/${draft.id}?draft=true`, tokens[1])).status, 404)
      assert.equal((await request(`/${draft.id}/publish`, tokens[1], 'POST', { fingerprint: draft.fingerprint })).status, 404)
      assert.equal((await request(`/${draft.id}`, tokens[1], 'PATCH', { enabled: false })).status, 404)
      assert.equal((await request(`/${draft.id}`, tokens[1], 'DELETE')).status, 404)
      assert.equal((await request(`/${draft.id}/publish`, tokens[0], 'POST', { fingerprint: draft.fingerprint }, 'https://evil.example')).status, 403)
      assert.equal((await request(`/${draft.id}/publish`, tokens[0], 'POST', { fingerprint: null })).status, 400)
      assert.equal((await request(`/${draft.id}/publish`, tokens[0], 'POST', { fingerprint: 'stale' })).status, 409)
      assert.equal((await request(`/${draft.id}/draft`, tokens[0], 'PUT', { files: files() })).status, 400)
      assert.equal((await request(`/${draft.id}/draft`, tokens[1], 'PUT', { files: files(), expectedFingerprint: draft.fingerprint })).status, 404)
      const initialSave = await request(`/${draft.id}/draft`, tokens[0], 'PUT', { files: files(), expectedFingerprint: draft.fingerprint })
      assert.equal(initialSave.status, 200, await initialSave.text())
      assert.equal((await request(`/${draft.id}/publish`, tokens[0], 'POST', { fingerprint: draft.fingerprint })).status, 201)
      assert.equal((await service.preview(userId, draft.id)).fingerprint, draft.fingerprint)
      const saved = await request(`/${draft.id}/draft`, tokens[0], 'PUT', { files: files('手动更新'), expectedFingerprint: draft.fingerprint })
      assert.equal(saved.status, 200)
      const updated = (await saved.json()).data
      assert.notEqual(updated.fingerprint, draft.fingerprint)
      assert.equal((await request(`/${draft.id}/draft`, tokens[0], 'PUT', { files: files('旧编辑器覆盖'), expectedFingerprint: draft.fingerprint })).status, 409)
      assert.equal((await request(`/${draft.id}/publish`, tokens[0], 'POST', { fingerprint: updated.fingerprint })).status, 201)
      assert.match((await service.preview(userId, draft.id)).files[0]!.content, /手动更新$/)
    }
    finally {
      // app.close 会调用同一个 Prisma 实例的 disconnect；后续用例会自动重连。
      await app.close()
    }
  })
  it('公共技能只由系统作用域写入，两个用户共享读取，更新与回收不影响私人内容', async () => {
    const other = (await prisma.user.create({ data: { email: `${randomUUID()}@example.test` } })).id
    const personal = await service.createManualSkill(userId, files('私人内容'))
    const resources = [...files('读取 `references/check.md`。'), { path: 'references/check.md', encoding: 'utf8', content: '系统参考资料' }, { path: 'assets/a.woff', encoding: 'base64', content: 'AQID' }]
    const system = await service.createManualSkill(null, resources)
    assert.equal(system.builtin, true)
    assert.equal(system.draft, false)
    assert.equal((await service.list(null)).some(item => item.id === personal.id), false)
    for (const id of [userId, other]) {
      assert.ok((await service.list(id)).some(item => item.id === system.id))
      const snapshot = await service.snapshot(id, [system.id])
      assert.deepEqual(snapshot.selected[0]?.package.files, [...resources].sort((a, b) => a.path.localeCompare(b.path)))
      assert.deepEqual((await service.preview(id, system.id, true)).files, [...resources].sort((a, b) => a.path.localeCompare(b.path)))
      await assert.rejects(service.saveManualDraft(id, system.id, resources, system.fingerprint), /不存在/)
      await assert.rejects(service.publish(id, system.id, system.fingerprint), /不存在/)
      await assert.rejects(service.setEnabled(id, system.id, false), /不存在/)
      await assert.rejects(service.remove(id, system.id), /不存在/)
    }
    await assert.rejects(service.preview(other, personal.id), /不存在/)
    await assert.rejects(service.preview(null, personal.id), /不存在/)
    await assert.rejects(service.saveSystemSkill(personal.id, files(), personal.fingerprint), /不存在/)
    await assert.rejects(service.remove(null, personal.id), /不存在/)
    const results = await Promise.allSettled(['A', 'B'].map(text => service.saveSystemSkill(system.id, files(text), system.fingerprint)))
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1)
    const current = await service.preview(null, system.id)
    assert.notEqual(current.fingerprint, system.fingerprint)
    assert.equal(current.id, system.id)
    assert.equal((await service.snapshot(other, [system.id])).selected[0]?.package.fingerprint, current.fingerprint)
    storage.configured = true
    try {
      await service.sweep()
    }
    finally { storage.configured = false }
    assert.equal(await prisma.skillContent.count({ where: { skillId: system.id } }), 1)
    assert.equal((await service.preview(userId, personal.id)).fingerprint, personal.fingerprint)
    await service.setEnabled(null, system.id, false)
    assert.ok((await service.list(null)).some(item => item.id === system.id && !item.enabled))
    assert.equal((await service.list(other)).some(item => item.id === system.id), false)
    await assert.rejects(service.snapshot(other, [system.id]), /不可用/)
    await service.remove(null, system.id)
    storage.configured = true
    try {
      await service.sweep()
    }
    finally { storage.configured = false }
    assert.equal(await prisma.skillContent.count({ where: { skillId: system.id } }), 0)
    assert.ok(await service.preview(userId, personal.id))
  })

  it('creator 身份与名称受保护，编辑后新实例读取持久内容，停用不回退默认包', async () => {
    const original = await service.preview(null, CREATOR_ID)
    await assert.rejects(service.remove(null, CREATOR_ID), /不能删除/)
    await assert.rejects(service.saveSystemSkill(CREATOR_ID, files(), original.fingerprint), /名称不能修改/)
    const updated = await service.saveSystemSkill(CREATOR_ID, original.files.map(file => ({ ...file, content: `${file.content}\n管理员补充指令` })), original.fingerprint)
    const restarted = new SkillsService(prisma, storage as unknown as AttachmentStorageService, examples as unknown as SkillExamplesService)
    assert.equal((await restarted.preview(userId, CREATOR_ID)).fingerprint, updated.fingerprint)
    assert.match((await restarted.snapshot(userId, [CREATOR_ID])).selected[0]!.package.files[0]!.content, /管理员补充指令/)
    await service.setEnabled(null, CREATOR_ID, false)
    assert.equal((await restarted.snapshot(userId)).entries.some(item => item.id === CREATOR_ID), false)
    await assert.rejects(restarted.snapshot(userId, [CREATOR_ID]), /不可用/)
    assert.equal((await restarted.list(userId)).some(item => item.id === CREATOR_ID), false)
    assert.ok((await restarted.list(null)).some(item => item.id === CREATOR_ID && !item.enabled))
    await service.setEnabled(null, CREATOR_ID, true)
    await service.saveSystemSkill(CREATOR_ID, original.files, updated.fingerprint)
  })

  it('系统直接保存的 PUT 未知保留身份；真正 COMMIT 失败不改变已发布内容', async () => {
    const system = await service.createManualSkill(null, files('旧发布'))
    const put = vi.spyOn(storage, 'put').mockRejectedValueOnce(new Error('connection timeout'))
    try {
      await assert.rejects(service.saveSystemSkill(system.id, files('未知上传'), system.fingerprint), /上传结果未知/)
    }
    finally { put.mockRestore() }
    const unknown = await prisma.skillContent.findFirstOrThrow({ where: { skillId: system.id, uploadId: { not: null } } })
    await assert.rejects(service.saveSystemSkill(system.id, files('不能覆盖'), system.fingerprint), /尚未确认/)
    storage.configured = true
    try {
      await service.sweep()
    }
    finally { storage.configured = false }
    assert.equal((await prisma.skillContent.findUniqueOrThrow({ where: { id: unknown.id } })).uploadId, unknown.uploadId)
    assert.equal((await service.preview(null, system.id)).fingerprint, system.fingerprint)

    const second = await service.createManualSkill(null, files('可靠旧发布'))
    await prisma.$executeRawUnsafe(`CREATE FUNCTION reject_system_commit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."userId" IS NULL AND NEW."publishedId" IS DISTINCT FROM OLD."publishedId" THEN RAISE EXCEPTION 'reject system commit'; END IF; RETURN NEW; END $$`)
    await prisma.$executeRawUnsafe('CREATE CONSTRAINT TRIGGER reject_system_commit AFTER UPDATE ON "Skill" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION reject_system_commit()')
    const succeededPut = vi.spyOn(storage, 'put')
    try {
      await assert.rejects(service.saveSystemSkill(second.id, files('不会生效'), second.fingerprint))
      assert.equal(succeededPut.mock.calls.length, 1)
      assert.equal((await service.preview(null, second.id)).fingerprint, second.fingerprint)
      assert.equal((await service.snapshot(userId, [second.id])).selected[0]?.package.fingerprint, second.fingerprint)
      await vi.waitFor(async () => assert.equal((await prisma.skillContent.findFirstOrThrow({ where: { objectKey: succeededPut.mock.calls[0]![0] } })).uploadId, null))
      storage.configured = true
      await service.sweep()
      assert.equal(await prisma.skillContent.count({ where: { skillId: second.id } }), 1)
    }
    finally {
      storage.configured = false
      succeededPut.mockRestore()
      await prisma.$executeRawUnsafe('DROP TRIGGER reject_system_commit ON "Skill"')
      await prisma.$executeRawUnsafe('DROP FUNCTION reject_system_commit()')
    }
  })

  it('系统技能真实 HTTP：管理员 CRUD、成员拒绝、请求体边界与 COMMIT unknown', async () => {
    const admin = await prisma.user.create({ data: { email: `${randomUUID()}@example.test`, role: 'ADMIN', mustChangePassword: false } })
    await prisma.user.update({ where: { id: userId }, data: { mustChangePassword: false } })
    const tokens = [randomUUID(), randomUUID()]
    for (const [index, id] of [admin.id, userId].entries())
      await prisma.session.create({ data: { userId: id, tokenHash: createHash('sha256').update(tokens[index]!).digest('hex'), expiresAt: new Date(Date.now() + 60000) } })
    @Module({ controllers: [AdminSkillsController, SkillsController], providers: [{ provide: SkillsService, useValue: service }, { provide: PrismaService, useValue: prisma }, AuthService, { provide: APP_GUARD, useClass: AuthGuard }] })
    class SystemTestApp {}
    const app = await NestFactory.create(SystemTestApp, { logger: false })
    registerAppGlobals(app)
    await app.listen(0, '127.0.0.1')
    const base = await app.getUrl()
    const request = (path: string, token: string | undefined, method = 'GET', body?: unknown, origin = 'http://localhost:5174') => fetch(`${base}/api/admin/skills${path}`, { method, headers: { origin, 'content-type': 'application/json', ...(token ? { cookie: `agent_session=${token}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) })
    try {
      assert.equal((await request('', undefined)).status, 401)
      assert.equal((await request('', tokens[1])).status, 403)
      assert.equal((await request('', tokens[1], 'POST', { files: files() })).status, 403)
      assert.equal((await request('', tokens[0], 'POST', { files: files() }, 'https://evil.example')).status, 403)
      assert.equal((await request('', tokens[0], 'POST', { files: 'invalid' })).status, 400)
      const createdResponse = await request('', tokens[0], 'POST', { files: files('x'.repeat(160 * 1024)) })
      assert.equal(createdResponse.status, 201)
      const created = (await createdResponse.json()).data
      assert.equal(created.builtin, true)
      assert.equal(typeof created.updatedAt, 'string')
      for (const [method, suffix, body] of [['PATCH', '', { files: files(), expectedFingerprint: created.fingerprint }], ['POST', '/toggle', { enabled: false }], ['DELETE', '', undefined]] as const)
        assert.equal((await request(`/${created.id}${suffix}`, tokens[1], method, body)).status, 403)
      assert.equal((await request(`/${created.id}`, tokens[0], 'PATCH', { files: files() })).status, 400)
      assert.equal((await request(`/${created.id}`, tokens[0], 'PATCH', { files: files(), expectedFingerprint: 'stale' })).status, 409)
      const updatedResponse = await request(`/${created.id}`, tokens[0], 'PATCH', { files: files('y'.repeat(160 * 1024)), expectedFingerprint: created.fingerprint })
      assert.equal(updatedResponse.status, 200)
      const updated = (await updatedResponse.json()).data
      assert.notEqual(updated.fingerprint, created.fingerprint)
      assert.equal(updated.draft, false)
      assert.equal((await request(`/${created.id}/toggle`, tokens[0], 'POST', { enabled: false })).status, 201)
      assert.equal((await request(`/${CREATOR_ID}`, tokens[0], 'DELETE')).status, 400)
      assert.equal((await request(`/${created.id}`, tokens[0], 'DELETE')).status, 200)
      assert.equal((await request(`/${created.id}`, tokens[0])).status, 404)
      const realWrite = prisma.withDeadlineTransaction.bind(prisma)
      const uncertain = vi.spyOn(prisma, 'withDeadlineTransaction').mockImplementationOnce((async (...args: Parameters<typeof realWrite>) => {
        await realWrite(...args)
        throw new DatabaseCommitOutcomeUnknownError('INTERNAL_ONLY')
      }) as typeof realWrite)
      try {
        const response = await request('', tokens[0], 'POST', { files: files('提交未知') })
        assert.equal(response.status, 500)
        const body = await response.json()
        assert.equal(body.error.error, 'DatabaseCommitOutcomeUnknown')
        assert.match(body.message, /刷新核对/)
        assert.equal(JSON.stringify(body).includes('INTERNAL_ONLY'), false)
      }
      finally { uncertain.mockRestore() }
      const unrelated = await fetch(`${base}/api/admin/unrelated`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ value: 'x'.repeat(160 * 1024) }) })
      assert.equal(unrelated.status, 413)
    }
    finally { await app.close() }
  })
  for (const kind of ['ordinary', 'creator'] as const) {
    it(`草稿工具私人边界：停用 ${kind} 后新调用不能读取正文或参考文件`, async () => {
      const original = kind === 'creator' ? await service.preview(null, CREATOR_ID) : undefined
      const marker = `DRAFT_BOUNDARY_${kind}`
      const resources = [...(original?.files ?? files(marker)).map(file => ({ ...file, content: file.path === 'SKILL.md' ? `${file.content}\n${marker}` : file.content })), { path: 'references/boundary.txt', encoding: 'utf8', content: marker }]
      const system = original
        ? await service.saveSystemSkill(CREATOR_ID, resources, original.fingerprint)
        : await service.createManualSkill(null, resources)
      const registry = new ToolRegistryService()
      registry.register({ definition: readSkillDefinition, executor: new ReadSkillTool(service) })
      registry.register({ definition: readSkillDraftDefinition, executor: new ReadSkillDraftTool(service) })
      const invocation = new ToolInvocationService(registry)
      const operation = deadline()
      const context = {
        signal: operation.signal,
        databaseDeadline: operation,
        argumentsTruncated: false,
        serperApiKey: { status: 'missing' as const },
        workspace: { userId, conversationId, runId: randomUUID(), deadlineAt: operation.deadlineAt },
        skills: { snapshot: await service.snapshot(userId), loaded: new Map() },
      }
      const read = (toolName: string, path: string, run = context) => invocation.invoke({ callId: randomUUID(), toolName, rawArgumentsJson: JSON.stringify({ id: system.id, path }) }, run)
      try {
        const enabled = await read('read_skill', 'SKILL.md')
        assert.equal(enabled.result.ok, true)
        assert.match(enabled.result.modelContent, new RegExp(marker))
        await service.setEnabled(null, system.id, false)
        const fresh = { ...context, skills: { snapshot: await service.snapshot(userId), loaded: new Map() } }
        assert.equal(fresh.skills.snapshot.entries.some(entry => entry.id === system.id), false)
        for (const path of ['SKILL.md', 'references/boundary.txt']) {
          assert.equal((await read('read_skill', path, fresh)).result.ok, false)
          const denied = await read('read_skill_draft', path, fresh)
          assert.equal(denied.result.ok, false)
          assert.equal(denied.result.modelContent.includes(marker), false)
        }
        assert.ok((await service.preview(null, system.id)).files.some(file => file.content.includes(marker)))
        // 原 Run 已加载的整包继续使用；本次不改变缓存生命周期。
        assert.equal((await read('read_skill', 'references/boundary.txt')).result.ok, true)
        await service.setEnabled(null, system.id, true)
        assert.equal((await read('read_skill_draft', 'SKILL.md')).result.ok, false)
      }
      finally {
        if (original) {
          await service.saveSystemSkill(CREATOR_ID, original.files, system.fingerprint)
          await service.setEnabled(null, CREATOR_ID, original.enabled)
        }
      }
    })
  }

  it('草稿工具私人边界：本人停用草稿与已发布内容仍可读，其他用户不能读取', async () => {
    const registry = new ToolRegistryService()
    registry.register({ definition: readSkillDraftDefinition, executor: new ReadSkillDraftTool(service) })
    const invocation = new ToolInvocationService(registry)
    const ownDraft = await service.saveDraft(userId, conversationId, { files: files('PRIVATE_DRAFT_BODY') }, deadline())
    const ownPublished = await service.createManualSkill(userId, files('PRIVATE_PUBLISHED_BODY'))
    const other = await prisma.user.create({ data: { email: `${randomUUID()}@example.test` } })
    const otherConversation = await prisma.conversation.create({ data: { userId: other.id, title: '其他用户工具上下文' } })
    for (const skill of [ownDraft, ownPublished]) {
      await service.setEnabled(userId, skill.id, false)
      for (const actor of [userId, other.id]) {
        const operation = deadline()
        const result = await invocation.invoke({ callId: randomUUID(), toolName: 'read_skill_draft', rawArgumentsJson: JSON.stringify({ id: skill.id }) }, {
          signal: operation.signal,
          databaseDeadline: operation,
          argumentsTruncated: false,
          serperApiKey: { status: 'missing' },
          workspace: { userId: actor, conversationId: actor === userId ? conversationId : otherConversation.id, runId: randomUUID(), deadlineAt: operation.deadlineAt },
          skills: { snapshot: await service.snapshot(actor), loaded: new Map() },
        })
        assert.equal(result.result.ok, actor === userId)
        if (actor === userId)
          assert.equal(JSON.parse(result.result.modelContent).content, skill.files[0]!.content)
        else
          assert.equal(result.result.modelContent.includes('PRIVATE_'), false)
      }
    }
  })

  it('发布生成示例并持久化，重复发布不重新生成；生成失败不改变发布内容', async () => {
    const initial = await service.createManualSkill(userId, files('EXAMPLE_ORIGINAL'))
    assert.equal(initial.examples.length, 3)
    assert.equal(initial.createdAt, (await prisma.skill.findUniqueOrThrow({ where: { id: initial.id } })).createdAt.toISOString())
    const beforeCalls = examples.generate.mock.calls.length
    await service.publish(userId, initial.id, initial.fingerprint)
    assert.equal(examples.generate.mock.calls.length, beforeCalls)
    const next = await service.saveManualDraft(userId, initial.id, files('EXAMPLE_CHANGED'), initial.fingerprint)
    examples.generate.mockRejectedValueOnce(new Error('generation failed'))
    await assert.rejects(service.publish(userId, initial.id, next.fingerprint), /generation failed/u)
    const unchanged = await service.preview(userId, initial.id)
    assert.equal(unchanged.fingerprint, initial.fingerprint)
    assert.deepEqual(unchanged.examples, initial.examples)
    const generated = ['请用更新后的技能完成第一种实际任务。', '请用更新后的技能完成第二种实际任务。', '请用更新后的技能完成第三种实际任务。']
    examples.generate.mockResolvedValueOnce(generated)
    const published = await service.publish(userId, initial.id, next.fingerprint)
    assert.deepEqual(published.examples, generated)
    assert.deepEqual((await service.list(userId)).find(item => item.id === initial.id)?.examples, generated)
    const count = await prisma.skill.count()
    examples.generate.mockRejectedValueOnce(new Error('generation failed'))
    await assert.rejects(service.createManualSkill(userId, files()), /generation failed/u)
    assert.equal(await prisma.skill.count(), count)
  })

  it('草稿改动后恢复原内容时复用原示例，不依赖模型可用性', async () => {
    const original = await service.createManualSkill(userId, files('RESTORED_ORIGINAL'))
    const changed = await service.saveManualDraft(userId, original.id, files('INTERMEDIATE_CHANGE'), original.fingerprint)
    const restored = await service.saveManualDraft(userId, original.id, original.files, changed.fingerprint)
    const row = await prisma.skill.findUniqueOrThrow({ where: { id: original.id } })
    assert.notEqual(row.draftId, row.publishedId)
    assert.equal(restored.fingerprint, original.fingerprint)
    const calls = examples.generate.mock.calls.length
    const unavailable = new SkillsService(prisma, storage as unknown as AttachmentStorageService, {
      generate: async () => { throw new Error('模型不可用') },
    } as unknown as SkillExamplesService)
    const published = await unavailable.publish(userId, original.id, restored.fingerprint)
    assert.deepEqual(published.examples, original.examples)
    assert.equal(published.hasDraft, false)
    assert.equal(examples.generate.mock.calls.length, calls)
  })

  it('生成示例不持有技能锁，期间草稿变化时拒绝发布旧示例', async () => {
    const initial = await service.createManualSkill(userId, files('RACE_ORIGINAL'))
    const first = await service.saveManualDraft(userId, initial.id, files('RACE_FIRST'), initial.fingerprint)
    let release!: (value: string[]) => void
    let started!: () => void
    const entered = new Promise<void>((resolve) => {
      started = resolve
    })
    examples.generate.mockImplementationOnce(() => new Promise<string[]>((resolve) => {
      release = resolve
      started()
    }))
    const publishing = service.publish(userId, initial.id, first.fingerprint)
    const rejected = assert.rejects(publishing, /预览已过期/u)
    await entered
    try {
      await service.saveManualDraft(userId, initial.id, files('RACE_SECOND'), first.fingerprint)
    }
    finally { release(['第一条旧内容对应的使用示例。', '第二条旧内容对应的使用示例。', '第三条旧内容对应的使用示例。']) }
    await rejected
    assert.equal((await service.preview(userId, initial.id)).fingerprint, initial.fingerprint)
    assert.deepEqual((await service.preview(userId, initial.id)).examples, initial.examples)
  })

  it('使用次数按用户问答去重，包含显式选择和成功自动读取，不计失败与其他用户', async () => {
    const system = await service.createManualSkill(null, files('USAGE_COUNT'))
    const other = await prisma.user.create({ data: { email: `${randomUUID()}@example.test` } })
    const otherConversation = await prisma.conversation.create({ data: { userId: other.id, title: '其他用户' } })
    const selected = await prisma.message.create({ data: { conversationId, role: 'USER', content: '显式选择', skills: [{ id: system.id, name: system.name }] } })
    const auto = await prisma.message.create({ data: { conversationId, role: 'USER', content: '自动读取' } })
    const failed = await prisma.message.create({ data: { conversationId, role: 'USER', content: '失败读取' } })
    await prisma.message.create({ data: { conversationId: otherConversation.id, role: 'USER', content: '其他用户使用', skills: [{ id: system.id, name: system.name }] } })
    for (const message of [selected, auto, failed]) {
      const run = await prisma.agentRun.create({ data: { conversationId, userMessageId: message.id } })
      for (const sequence of [1, 2])
        await prisma.agentStep.create({ data: { runId: run.id, sequence, type: 'tool_execution', title: '读取技能', status: 'COMPLETED', input: { toolName: 'read_skill' }, output: { ok: message.id !== failed.id, display: { skill: { id: system.id, name: system.name } } } } })
    }
    assert.equal((await service.list(userId)).find(item => item.id === system.id)?.usageCount, 2)
    assert.equal((await service.preview(userId, system.id)).usageCount, 2)
    assert.equal((await service.list(other.id)).find(item => item.id === system.id)?.usageCount, 1)
    assert.equal((await service.list(null)).find(item => item.id === system.id)?.usageCount, 3)
  })
})
