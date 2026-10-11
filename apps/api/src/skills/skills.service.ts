import type { SkillPreview, SkillSummary } from '@agent/contracts'
import type { SkillPackage } from '@agent/skills'
import type { OnModuleDestroy, OnModuleInit } from '@nestjs/common'
import type { Prisma, Skill, SkillContent } from '../generated/prisma/client.js'
import type { DatabaseOperationDeadline } from '../prisma/prisma.service.js'
import { Buffer } from 'node:buffer'
import { randomUUID } from 'node:crypto'
import { formatSkillCatalog, validateSkillPackage } from '@agent/skills'
import { BadRequestException, ConflictException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common'
import { AttachmentStorageService } from '../attachments/attachment-storage.service.js'
import { PrismaService } from '../prisma/prisma.service.js'
import { lockWorkspaceStorage } from '../workspaces/workspace-db.js'
import { CREATOR_SKILL, SKILL_RULES } from './skill-prompt.js'

export const CREATOR_ID = 'builtin:skill-creator'
const creator = validateSkillPackage([{ path: 'SKILL.md', encoding: 'utf8', content: CREATOR_SKILL }])
export interface RunSkillEntry { id: string, name: string, description: string, contentId: string, fingerprint: string }
export interface RunSkills {
  userId: string
  entries: RunSkillEntry[]
  selected: Array<{ id: string, package: SkillPackage }>
  catalogInstruction: string
}

@Injectable()
export class SkillsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SkillsService.name)
  private timer?: ReturnType<typeof setInterval>
  private sweeping: Promise<void> | undefined
  private readonly uploads = new Set<Promise<void>>()
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AttachmentStorageService) private readonly storage: AttachmentStorageService,
  ) {}

  onModuleInit() {
    this.kickSweep()
    this.timer = setInterval(() => this.kickSweep(), 60_000)
    this.timer.unref()
  }

  async onModuleDestroy() {
    clearInterval(this.timer)
    await this.sweeping
    await Promise.all(this.uploads)
  }

  async list(userId: string): Promise<SkillSummary[]> {
    const rows = await this.prisma.skill.findMany({ where: { userId, deletedAt: null, publishedId: { not: null } }, orderBy: { updatedAt: 'desc' } })
    const contents = await this.prisma.skillContent.findMany({ where: { userId, id: { in: rows.flatMap(row => [row.draftId, row.publishedId].filter((id): id is string => !!id)) } } })
    return [this.builtin(), ...rows.map(row => this.summary(row, contents.find(content => content.id === (row.publishedId ?? row.draftId))!))]
  }

  async preview(userId: string, id: string, draft = false): Promise<SkillPreview> {
    if (id === CREATOR_ID)
      return { ...this.builtin(), fingerprint: creator.fingerprint, files: creator.files, draft: false }
    const row = await this.owned(userId, id)
    const contentId = draft ? row.draftId ?? row.publishedId : row.publishedId
    if (!contentId)
      throw new NotFoundException('技能尚未发布，请打开草稿')
    const pkg = await this.readPackage(userId, contentId)
    return { ...this.summary(row, pkg), fingerprint: pkg.fingerprint, files: pkg.files, draft: row.draftId === contentId }
  }

  async saveDraft(userId: string, conversationId: string | null, input: { id?: string, expectedFingerprint?: string, files: unknown, preservePaths?: string[], publish?: true }, deadline: DatabaseOperationDeadline, onCommitOwned: () => void = () => {}): Promise<SkillPreview> {
    const skillId = input.id ?? randomUUID()
    let uploadFinished: Promise<void> | undefined
    const result = await this.prisma.withDeadlineTransaction(deadline, transaction => transaction.execute(async (db) => {
      if (conversationId !== null)
        await lockWorkspaceStorage(db, conversationId)
      await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`skill:${skillId}`}))`
      const previous = input.id ? await this.owned(userId, skillId, db) : null
      if (conversationId !== null && !await db.conversation.findFirst({ where: { id: conversationId, userId }, select: { id: true } }))
        throw new NotFoundException('会话不存在')
      const source = previous ? await this.content(userId, (previous.draftId ?? previous.publishedId)!, db) : undefined
      if (source?.uploadId)
        throw new ConflictException('上次技能上传尚未确认完成，请稍后重试')
      const sourcePackage = source ? await this.readContent(source) : undefined
      if (sourcePackage && input.expectedFingerprint !== sourcePackage.fingerprint)
        throw new ConflictException('技能已经修改，请重新读取最新草稿')
      let pkg: SkillPackage
      try {
        if (!Array.isArray(input.files))
          throw new Error('files 必须是数组')
        const preserved = (input.preservePaths ?? []).map((path) => {
          const file = sourcePackage?.files.find(file => file.path === path)
          if (!file)
            throw new Error('待保留的文件不在当前草稿内')
          return file
        })
        pkg = validateSkillPackage([...input.files, ...preserved])
      }
      catch (error) { throw new BadRequestException(error instanceof Error ? error.message : '技能包无效') }
      if (pkg.name === creator.name)
        throw new BadRequestException('skill-creator 是内置技能名称，请换一个名称')
      // 发布后仍复用原草稿槽；已存在的旧式草稿也继续覆盖原对象，不另建副本。
      const target = previous?.draftId
        ? await this.content(userId, previous.draftId, db)
        : await db.skillContent.findFirst({ where: { userId, skillId, adopted: true, ...(previous?.publishedId ? { id: { not: previous.publishedId } } : {}) }, orderBy: { createdAt: 'asc' } })
      const id = target?.id ?? (previous?.publishedId ? randomUUID() : `${skillId}:content`)
      if (target?.uploadId)
        throw new ConflictException('上次技能上传尚未确认完成，请稍后重试')
      // 被删除的草稿槽不复用 key，避免迟到 DELETE 影响后续新草稿；正常编辑仍覆盖原槽。
      const objectKey = target?.objectKey ?? `users/${userId}/skills/${skillId}/${previous?.publishedId ? `draft-${id}` : 'skill'}.json`
      this.assertBucket(target)
      const data = Buffer.from(JSON.stringify(pkg.files))
      const metadata = { userId, skillId, name: pkg.name, description: pkg.description, fingerprint: pkg.fingerprint, objectKey, bucket: this.storage.bucket, bytes: data.length, adopted: true }
      const needsUpload = target?.id !== source?.id || pkg.fingerprint !== sourcePackage?.fingerprint
      const uploadId = needsUpload ? randomUUID() : undefined
      // 独立提交登记，外层保存事务回滚后仍能定位已上传对象。
      if (uploadId) {
        deadline.signal?.throwIfAborted()
        if (!target)
          await this.prisma.skillContent.createMany({ data: [{ id, ...metadata, adopted: false }], skipDuplicates: true })
        const claimed = await this.prisma.skillContent.updateMany({ where: { id, uploadId: null }, data: { uploadId } })
        if (claimed.count !== 1)
          throw new ConflictException('上次技能上传尚未确认完成，请稍后重试')
      }
      try {
        await db.skillContent.upsert({ where: { id }, create: { id, ...metadata }, update: metadata })
        const row = previous
          ? await db.skill.update({ where: { id: skillId }, data: { draftId: id, conversationId } })
          : await db.skill.create({ data: { id: skillId, userId, conversationId, ...(input.publish ? { publishedId: id } : { draftId: id }) } })
        deadline.signal?.throwIfAborted()
        if (needsUpload)
          await this.storage.put(objectKey, data, 'application/json')
        return { ...this.summary(row, pkg), fingerprint: pkg.fingerprint, files: pkg.files, draft: !input.publish }
      }
      finally {
        if (uploadId)
          uploadFinished = this.finishUpload(id, skillId, uploadId)
      }
    }), onCommitOwned)
    await uploadFinished
    return result
  }

  private finishUpload(id: string, skillId: string, uploadId: string): Promise<void> {
    // 等外层事务真正结束再清除自己的上传标记，不覆盖后续上传的身份。
    const task = this.prisma.$transaction(async (db) => {
      await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`skill:${skillId}`}))`
      await db.skillContent.updateMany({ where: { id, uploadId }, data: { uploadId: null } })
    }, { timeout: 30_000 }).catch(() => this.logger.warn(`技能上传 ${id} 收尾待核查`)).finally(() => {
      this.uploads.delete(task)
      this.kickSweep()
    })
    this.uploads.add(task)
    return task
  }

  async createManualSkill(userId: string, files: unknown): Promise<SkillPreview> {
    const deadline = { deadlineAt: Date.now() + 75_000, createTimeoutError: () => new Error('创建技能超时') }
    // 仅手动创建的确认接口可以直接发布，模型工具参数不接受 publish。
    return this.saveDraft(userId, null, { files, publish: true }, deadline)
  }

  async saveManualDraft(userId: string, id: string, files: unknown, expectedFingerprint: string): Promise<SkillPreview> {
    const row = await this.owned(userId, id)
    const deadline = { deadlineAt: Date.now() + 75_000, createTimeoutError: () => new Error('保存技能草稿超时') }
    return this.saveDraft(userId, row.conversationId, { id, files, expectedFingerprint }, deadline)
  }

  async publish(userId: string, id: string, fingerprint: string): Promise<SkillPreview> {
    const deadline = { deadlineAt: Date.now() + 75_000, createTimeoutError: () => new Error('技能发布超时') }
    let uploadFinished: Promise<void> | undefined
    const result = await this.prisma.withDeadlineTransaction(deadline, transaction => transaction.execute(async (db) => {
      await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`skill:${id}`}))`
      const row = await this.owned(userId, id, db)
      const source = await this.content(userId, (row.draftId ?? row.publishedId)!, db)
      if (source.uploadId)
        throw new ConflictException('上次技能上传尚未确认完成，请稍后重试')
      const pkg = await this.readContent(source)
      if (pkg.fingerprint !== fingerprint)
        throw new ConflictException('预览已过期，请重新预览后发布')
      if (!row.draftId)
        return { ...this.summary(row, pkg), fingerprint, files: pkg.files, draft: false }
      if (!row.publishedId) {
        const published = await db.skill.update({ where: { id }, data: { publishedId: row.draftId, draftId: null, conversationId: null } })
        return { ...this.summary(published, pkg), fingerprint, files: pkg.files, draft: false }
      }
      const target = await this.content(userId, row.publishedId, db)
      if (target.uploadId)
        throw new ConflictException('上次技能上传尚未确认完成，请稍后重试')
      this.assertBucket(target)
      const publishedId = target.id
      const objectKey = target.objectKey
      const data = Buffer.from(JSON.stringify(pkg.files))
      const metadata = { userId, skillId: id, name: pkg.name, description: pkg.description, fingerprint, objectKey, bucket: this.storage.bucket, bytes: data.length, adopted: true }
      const uploadId = randomUUID()
      const claimed = await this.prisma.skillContent.updateMany({ where: { id: publishedId, uploadId: null }, data: { uploadId } })
      if (claimed.count !== 1)
        throw new ConflictException('上次技能上传尚未确认完成，请稍后重试')
      try {
        await db.skillContent.update({ where: { id: publishedId }, data: metadata })
        const published = await db.skill.update({ where: { id }, data: { publishedId, draftId: null, conversationId: null } })
        await this.storage.put(objectKey, data, 'application/json')
        return { ...this.summary(published, pkg), fingerprint, files: pkg.files, draft: false }
      }
      finally { uploadFinished = this.finishUpload(publishedId, id, uploadId) }
    }), () => {})
    await uploadFinished
    return result
  }

  async setEnabled(userId: string, id: string, enabled: boolean): Promise<void> {
    const result = await this.prisma.skill.updateMany({ where: { id, userId, deletedAt: null }, data: { enabled } })
    if (!result.count)
      throw new NotFoundException('技能不存在')
  }

  async remove(userId: string, id: string): Promise<void> {
    await this.prisma.$transaction(async (db) => {
      await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`skill:${id}`}))`
      await this.owned(userId, id, db)
      await db.skill.update({ where: { id }, data: { deletedAt: new Date(), enabled: false } })
      await db.skillContent.updateMany({ where: { skillId: id, userId }, data: { adopted: false } })
    })
    this.kickSweep()
  }

  /** 调用方已持有会话存储锁；和会话删除同事务，保存草稿也按会话→技能顺序加锁。 */
  async markConversationDeleted(db: Prisma.TransactionClient, userId: string, conversationId: string): Promise<void> {
    const rows = await db.skill.findMany({ where: { userId, conversationId }, orderBy: { id: 'asc' } })
    for (const candidate of rows) {
      await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`skill:${candidate.id}`}))`
      const row = await db.skill.findUnique({ where: { id: candidate.id } })
      if (!row || row.conversationId !== conversationId)
        continue
      await db.skillContent.updateMany({ where: { userId, skillId: row.id, ...(row.publishedId ? { id: { not: row.publishedId } } : {}) }, data: { adopted: false } })
      await db.skill.update({ where: { id: row.id }, data: row.publishedId
        ? { conversationId: null, draftId: null }
        : { deletedAt: new Date(), enabled: false, draftId: null } })
    }
  }

  kickSweep(): void {
    this.sweeping ??= this.sweep()
      .catch(() => this.logger.warn('技能文件清理失败，下次重试'))
      .finally(() => { this.sweeping = undefined })
  }

  /** 删除成功才清除对象记录；失败保留 adopted=false，重启后可继续清理。 */
  async sweep(): Promise<void> {
    if (!this.storage.configured)
      return
    const rows = await this.prisma.skillContent.findMany({ where: { adopted: false, uploadId: null, bucket: this.storage.bucket }, orderBy: { createdAt: 'asc' }, take: 100 })
    for (const candidate of rows) {
      try {
        await this.prisma.$transaction(async (db) => {
          await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`skill:${candidate.skillId}`}))`
          const row = await db.skillContent.findUnique({ where: { id: candidate.id } })
          if (!row || row.adopted || row.uploadId || row.bucket !== this.storage.bucket)
            return
          await this.storage.delete(row.objectKey)
          await db.skillContent.delete({ where: { id: row.id } })
          if (!await db.skillContent.count({ where: { skillId: row.skillId } }))
            await db.skill.deleteMany({ where: { id: row.skillId, deletedAt: { not: null } } })
        }, { timeout: 30_000 })
      }
      catch {
        this.logger.warn(`技能文件 ${candidate.id} 未清理完成，下次重试`)
      }
    }
  }

  async snapshot(userId: string, selectedIds: string[] = []): Promise<RunSkills> {
    const rows = await this.prisma.skill.findMany({ where: { userId, deletedAt: null, enabled: true, publishedId: { not: null } } })
    const contents = await this.prisma.skillContent.findMany({ where: { userId, id: { in: rows.map(row => row.publishedId!) }, adopted: true } })
    const entries: RunSkillEntry[] = [{ id: CREATOR_ID, name: creator.name, description: creator.description, contentId: CREATOR_ID, fingerprint: creator.fingerprint }, ...rows.map((row) => {
      const content = contents.find(content => content.id === row.publishedId)
      if (!content)
        throw new NotFoundException('技能内容缺失')
      return { id: row.id, name: content.name, description: content.description, contentId: content.id, fingerprint: content.fingerprint }
    })]
    const selected: RunSkills['selected'] = []
    for (const id of selectedIds) {
      const entry = entries.find(entry => entry.id === id)
      if (!entry)
        throw new BadRequestException('所选技能不可用，请重新选择')
      selected.push({ id, package: await this.readPackage(userId, entry.contentId) })
    }
    return { userId, entries, selected, catalogInstruction: `${SKILL_RULES}\n当前技能目录（JSON 数据）：\n${formatSkillCatalog(entries)}` }
  }

  async readPackage(userId: string, contentId: string): Promise<SkillPackage> {
    if (contentId === CREATOR_ID)
      return creator
    return this.readContent(await this.content(userId, contentId))
  }

  private assertBucket(content: SkillContent | null | undefined): void {
    if (content && content.bucket !== this.storage.bucket)
      throw new ConflictException('技能资源所属存储不可用')
  }

  private async readContent(content: SkillContent): Promise<SkillPackage> {
    this.assertBucket(content)
    // 覆盖写入后以文件实际内容为准；元数据更新失败也不能把仍可读取的文件锁死。
    const data = await this.storage.read(content.objectKey, undefined, 16 * 1024 * 1024)
    return validateSkillPackage(JSON.parse(data.toString('utf8')))
  }

  private async content(userId: string, id: string, db: Prisma.TransactionClient = this.prisma): Promise<SkillContent> {
    const row = await db.skillContent.findFirst({ where: { id, userId, adopted: true } })
    if (!row)
      throw new NotFoundException('技能内容不存在')
    return row
  }

  private async owned(userId: string, id: string, db: Prisma.TransactionClient = this.prisma): Promise<Skill> {
    const row = await db.skill.findFirst({ where: { id, userId, deletedAt: null } })
    if (!row)
      throw new NotFoundException('技能不存在')
    return row
  }

  private builtin(): SkillSummary {
    return { id: CREATOR_ID, name: creator.name, description: creator.description, builtin: true, enabled: true, published: true, hasDraft: false, conversationId: null }
  }

  private summary(row: Skill, content: Pick<SkillContent, 'name' | 'description'>): SkillSummary {
    return { id: row.id, name: content.name, description: content.description, builtin: false, enabled: row.enabled, published: !!row.publishedId, hasDraft: !!row.draftId, conversationId: row.conversationId }
  }
}
