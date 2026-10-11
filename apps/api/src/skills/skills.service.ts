import type { SkillPreview, SkillSummary } from '@agent/contracts'
import type { SkillPackage } from '@agent/skills'
import type { Skill, SkillContent } from '../generated/prisma/client.js'
import type { DatabaseOperationDeadline } from '../prisma/prisma.service.js'
import { Buffer } from 'node:buffer'
import { randomUUID } from 'node:crypto'
import { formatSkillCatalog, validateSkillPackage } from '@agent/skills'
import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common'
import { AttachmentStorageService } from '../attachments/attachment-storage.service.js'
import { PrismaService } from '../prisma/prisma.service.js'
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
export class SkillsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AttachmentStorageService) private readonly storage: AttachmentStorageService,
  ) {}

  async list(userId: string): Promise<SkillSummary[]> {
    const rows = await this.prisma.skill.findMany({ where: { userId, deletedAt: null }, orderBy: { updatedAt: 'desc' } })
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
    const content = await this.content(userId, contentId)
    const pkg = await this.readPackage(userId, contentId)
    return { ...this.summary(row, content), fingerprint: content.id, files: pkg.files, draft: row.draftId === contentId }
  }

  async saveDraft(userId: string, conversationId: string, input: { id?: string, expectedFingerprint?: string, files: unknown, preservePaths?: string[] }, deadline: DatabaseOperationDeadline, onCommitOwned: () => void = () => {}): Promise<SkillPreview> {
    const previous = input.id ? await this.owned(userId, input.id) : null
    if (previous && input.expectedFingerprint !== (previous.draftId ?? previous.publishedId))
      throw new ConflictException('技能已经修改，请重新读取最新草稿')
    const source = input.preservePaths?.length && previous
      ? await this.readPackage(userId, (previous.draftId ?? previous.publishedId)!)
      : undefined
    let pkg: SkillPackage
    try {
      if (!Array.isArray(input.files))
        throw new Error('files 必须是数组')
      const preserved = []
      if (input.preservePaths?.length) {
        if (!previous)
          throw new Error('新技能没有可保留的原文件')
        for (const path of input.preservePaths) {
          const file = source!.files.find(file => file.path === path)
          if (!file)
            throw new Error('待保留的文件不在当前草稿内')
          preserved.push(file)
        }
      }
      pkg = validateSkillPackage([...input.files, ...preserved])
    }
    catch (error) { throw new BadRequestException(error instanceof Error ? error.message : '技能包无效') }
    if (pkg.name === creator.name)
      throw new BadRequestException('skill-creator 是内置技能名称，请换一个名称')
    const conversation = await this.prisma.conversation.findFirst({ where: { id: conversationId, userId }, select: { id: true } })
    if (!conversation)
      throw new NotFoundException('会话不存在')
    const skillId = previous?.id ?? randomUUID()
    const id = randomUUID()
    const objectKey = `users/${userId}/skills/${skillId}/${id}.json`
    const data = Buffer.from(JSON.stringify(pkg.files))
    // 先登记再写 OSS；任何不确定失败都保留可核查的对象身份，绝不删除已确认内容。
    await this.prisma.skillContent.create({ data: { id, userId, skillId, name: pkg.name, description: pkg.description, fingerprint: pkg.fingerprint, objectKey, bucket: this.storage.bucket, bytes: data.length } })
    deadline.signal?.throwIfAborted()
    await this.storage.put(objectKey, data, 'application/json')
    deadline.signal?.throwIfAborted()
    // 开启 COMMIT 结局仲裁；连接丢失时暴露提交未知，不能提示模型盲目重建。
    await this.prisma.withDeadlineTransaction(deadline, async transaction => transaction.execute(async (db) => {
      if (previous) {
        const updated = await db.skill.updateMany({ where: { id: skillId, userId, deletedAt: null, draftId: previous.draftId, publishedId: previous.publishedId }, data: { draftId: id, conversationId } })
        if (updated.count !== 1)
          throw new ConflictException('技能已经修改，请重新读取最新草稿')
      }
      else {
        await db.skill.create({ data: { id: skillId, userId, conversationId, draftId: id } })
      }
      await db.skillContent.update({ where: { id }, data: { adopted: true } })
    }), onCommitOwned)
    return { id: skillId, name: pkg.name, description: pkg.description, builtin: false, enabled: previous?.enabled ?? true, published: !!previous?.publishedId, hasDraft: true, conversationId, fingerprint: id, files: pkg.files, draft: true }
  }

  async publish(userId: string, id: string, fingerprint: string): Promise<SkillPreview> {
    const confirmed = await this.owned(userId, id)
    if (confirmed.draftId !== fingerprint && confirmed.publishedId !== fingerprint)
      throw new ConflictException('预览已过期，请重新预览后发布')
    await this.readPackage(userId, fingerprint)
    await this.prisma.$transaction(async (db) => {
      const row = await db.skill.findFirst({ where: { id, userId, deletedAt: null } })
      if (!row)
        throw new NotFoundException('技能不存在')
      if (row.publishedId === fingerprint && !row.draftId)
        return
      if (!row.draftId || row.draftId !== fingerprint)
        throw new ConflictException('预览已过期，请重新预览后发布')
      const updated = await db.skill.updateMany({ where: { id, userId, deletedAt: null, draftId: fingerprint, publishedId: row.publishedId }, data: { publishedId: fingerprint, draftId: null } })
      if (!updated.count) {
        const current = await db.skill.findFirst({ where: { id, userId, deletedAt: null } })
        if (current?.publishedId !== fingerprint || current.draftId)
          throw new ConflictException('技能已经修改，请重新预览')
      }
    })
    return this.preview(userId, id)
  }

  async setEnabled(userId: string, id: string, enabled: boolean): Promise<void> {
    const result = await this.prisma.skill.updateMany({ where: { id, userId, deletedAt: null }, data: { enabled } })
    if (!result.count)
      throw new NotFoundException('技能不存在')
  }

  async remove(userId: string, id: string): Promise<void> {
    // 已开始 Run 持有不可变引用；删除只撤销后续发现与管理，不破坏原始执行记录。
    const result = await this.prisma.skill.updateMany({ where: { id, userId, deletedAt: null }, data: { deletedAt: new Date(), enabled: false } })
    if (!result.count)
      throw new NotFoundException('技能不存在')
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
    const row = await this.content(userId, contentId)
    if (row.bucket !== this.storage.bucket)
      throw new ConflictException('技能资源所属存储不可用')
    const data = await this.storage.read(row.objectKey, undefined, row.bytes)
    if (data.length !== row.bytes)
      throw new ConflictException('技能资源校验失败')
    const pkg = validateSkillPackage(JSON.parse(data.toString('utf8')))
    if (pkg.fingerprint !== row.fingerprint)
      throw new ConflictException('技能资源校验失败')
    return pkg
  }

  private async content(userId: string, id: string): Promise<SkillContent> {
    const row = await this.prisma.skillContent.findFirst({ where: { id, userId, adopted: true } })
    if (!row)
      throw new NotFoundException('技能内容不存在')
    return row
  }

  private async owned(userId: string, id: string): Promise<Skill> {
    const row = await this.prisma.skill.findFirst({ where: { id, userId, deletedAt: null } })
    if (!row)
      throw new NotFoundException('技能不存在')
    return row
  }

  private builtin(): SkillSummary {
    return { id: CREATOR_ID, name: creator.name, description: creator.description, builtin: true, enabled: true, published: true, hasDraft: false, conversationId: null }
  }

  private summary(row: Skill, content: SkillContent): SkillSummary {
    return { id: row.id, name: content.name, description: content.description, builtin: false, enabled: row.enabled, published: !!row.publishedId, hasDraft: !!row.draftId, conversationId: row.conversationId }
  }
}
