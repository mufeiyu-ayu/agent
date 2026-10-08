import type { MessageImage } from '@agent/ai'
import type { MessageAttachment } from '@agent/contracts'
import type { OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common'
import type { Buffer } from 'node:buffer'
import type { Readable } from 'node:stream'
import type { Attachment, Prisma } from '../generated/prisma/client.js'
import { randomUUID } from 'node:crypto'
import { userMessageContent } from '@agent/agent'
import { ATTACHMENT_MAX_COUNT } from '@agent/contracts'
import { BadRequestException, Inject, Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service.js'
import {
  attachmentKindOf,
  attachmentMaxBytes,
  attachmentObjectKey,
  contentTypeOf,
  decodeText,
  extensionOf,
  matchesFileSignature,
  MODEL_IMAGE_MAX_BYTES,
  MODEL_IMAGE_MAX_SIDE,
  modelImageProcesses,
  safeAttachmentName,
  THUMBNAIL_PROCESS,
  toModelDocumentText,
} from './attachment-files.js'
import { AttachmentStorageService, isMissingObject } from './attachment-storage.service.js'
import { extractDocumentText } from './document-text.js'

/** 给模型还原一条用户消息要用的列。 */
export type AttachmentModelRow = Pick<Attachment, 'id' | 'kind' | 'name' | 'extractedText' | 'objectKey' | 'modelObjectKey' | 'modelMimeType'>

export const ATTACHMENT_MODEL_SELECT = {
  id: true,
  kind: true,
  name: true,
  extractedText: true,
  objectKey: true,
  modelObjectKey: true,
  modelMimeType: true,
} as const satisfies Prisma.AttachmentSelect

/** 上传了但一直没发出去的附件，过这么久由后台清掉。 */
const UNSENT_TTL_MS = 24 * 60 * 60 * 1000
const SWEEP_INTERVAL_MS = 10 * 60 * 1000
const SWEEP_BATCH = 200
/** 发给模型的图片在进程内缓存这么多字节：同一会话每轮都要重发历史里的图片，对象不可变，可以放心缓存。 */
const IMAGE_CACHE_MAX_BYTES = 64 * 1024 * 1024

@Injectable()
export class AttachmentsService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(AttachmentsService.name)
  // Map 按插入顺序迭代：命中时删了重插，最久没用的排在最前面。
  private readonly imageCache = new Map<string, string>()
  private imageCacheBytes = 0
  private sweeping: Promise<void> | undefined
  private sweepTimer: NodeJS.Timeout | undefined

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AttachmentStorageService) private readonly storage: AttachmentStorageService,
  ) {}

  onApplicationBootstrap(): void {
    if (!this.storage.configured)
      return

    this.kickSweep()
    this.sweepTimer = setInterval(() => this.kickSweep(), SWEEP_INTERVAL_MS)
    this.sweepTimer.unref()
  }

  onModuleDestroy(): void {
    clearInterval(this.sweepTimer)
  }

  /**
   * 上传一个文件：校验类型与内容 → 文档先抽文字 → 建行 → 存原文件 → 图片读尺寸、必要时另存一份给模型的缩放图。
   * 行先于对象写入：中途失败或进程退出时对象仍有记录可查，由后台清理。
   */
  async upload(userId: string, input: { name: string, content: Buffer, signal?: AbortSignal }): Promise<MessageAttachment> {
    input.signal?.throwIfAborted()
    if (!this.storage.configured)
      throw new ServiceUnavailableException('附件存储未配置')
    const name = safeAttachmentName(input.name)
    const kind = attachmentKindOf(name)
    if (!kind)
      throw new BadRequestException('暂不支持这种文件')
    if (input.content.length === 0)
      throw new BadRequestException('文件是空的')
    if (input.content.length > attachmentMaxBytes(kind))
      throw new BadRequestException('文件超过了大小上限')
    if (!matchesFileSignature(name, input.content))
      throw new BadRequestException('文件内容和扩展名对不上')

    // 抽不出文字的文档直接拒绝：不让用户以为模型看到了。
    const extractedText = kind === 'file' ? toModelDocumentText(await this.documentText(name, input.content, input.signal)) : null
    input.signal?.throwIfAborted()
    const id = randomUUID()
    const objectKey = attachmentObjectKey(userId, id, 'original')

    await this.prisma.attachment.create({
      data: { id, userId, kind, name, bytes: input.content.length, bucket: this.storage.bucket, objectKey, extractedText },
    })

    try {
      await this.storage.put(objectKey, input.content, contentTypeOf(name))
      const image = kind === 'image' ? await this.prepareImage(userId, id, name, input.content.length) : undefined

      if (image) {
        await this.prisma.attachment.update({
          where: { id },
          data: { width: image.width, height: image.height, modelObjectKey: image.modelObjectKey, modelMimeType: image.modelMimeType },
        })
      }

      return { id, kind, name, bytes: input.content.length, ...(image ? { width: image.width, height: image.height } : {}) }
    }
    catch (error) {
      await this.prisma.attachment.update({ where: { id }, data: { deletedAt: new Date() } })
      this.kickSweep()
      throw error
    }
  }

  /** 读一个附件的内容给前台；别人的、已删除的与不存在的一律 404。 */
  async open(userId: string, id: string, variant?: string): Promise<{ stream: Readable, contentType: string, name: string, inline: boolean }> {
    const row = await this.prisma.attachment.findFirst({ where: { id, userId, deletedAt: null } })
    if (!row)
      throw new NotFoundException('附件不存在或已被删除')

    const thumbnail = variant === 'thumb' && row.kind === 'image'
    return {
      stream: await this.storage.stream(row.objectKey, thumbnail ? THUMBNAIL_PROCESS : undefined),
      contentType: contentTypeOf(row.name),
      name: row.name,
      // Word / Excel 浏览器打不开，一律下载；其余类型可以在页面里直接看。
      inline: !['docx', 'xlsx'].includes(extensionOf(row.name)),
    }
  }

  /** 发送前移除：只能删自己还没发出去的。 */
  async remove(userId: string, id: string): Promise<void> {
    const { count } = await this.prisma.attachment.updateMany({
      where: { id, userId, messageId: null, deletedAt: null },
      data: { deletedAt: new Date() },
    })
    if (count === 0)
      throw new NotFoundException('附件不存在或已经发出')
    this.kickSweep()
  }

  /**
   * 把附件绑到刚写入的用户消息上，和写消息在同一个事务里。任何一个不属于当前用户、已经发出过或已删除，
   * 就整体失败：事务回滚，不留下一条缺附件的消息。
   */
  async bind(db: Prisma.TransactionClient, input: { userId: string | undefined, conversationId: string, messageId: string, attachmentIds: string[] }): Promise<AttachmentModelRow[]> {
    const ids = input.attachmentIds
    if (ids.length === 0)
      return []
    if (!input.userId || ids.length > ATTACHMENT_MAX_COUNT || new Set(ids).size !== ids.length)
      throw new BadRequestException('附件无效，请重新添加')

    for (const [position, id] of ids.entries()) {
      const { count } = await db.attachment.updateMany({
        where: { id, userId: input.userId, messageId: null, deletedAt: null },
        data: { messageId: input.messageId, conversationId: input.conversationId, position },
      })
      if (count !== 1)
        throw new BadRequestException('有附件不存在或已经发送过，请重新添加')
    }

    return db.attachment.findMany({ where: { messageId: input.messageId }, orderBy: { position: 'asc' }, select: ATTACHMENT_MODEL_SELECT })
  }

  /**
   * 一条用户消息发给模型的样子：附件文字拼进正文，图片从存储读出。只依赖落库的记录，
   * 发送当时与之后每次读历史得到的内容相同。图片对象不存在时不让整次问答失败，在正文里写明这张图读不到。
   * `images: false` 时不读图片，只拼文字。
   */
  async modelInput(text: string, rows: AttachmentModelRow[], options: { images: boolean } = { images: true }): Promise<{ modelContent: string, images?: MessageImage[] }> {
    if (rows.length === 0)
      return { modelContent: text }

    // 并行读图，但结果按附件顺序组装：图片的先后也是模型看到的内容。
    const parts = await Promise.all(rows.map(async (row): Promise<{ text: { name: string, text?: string }, image?: MessageImage }> => {
      if (row.kind !== 'image')
        return { text: { name: row.name, text: row.extractedText ?? '' } }
      // 只要文字的调用方（写摘要）不读图片：摘要输入本来就不带图。
      if (!options.images)
        return { text: { name: row.name } }

      try {
        const data = await this.imageData(row.modelObjectKey ?? row.objectKey)
        return { text: { name: row.name }, image: { name: row.name, mimeType: row.modelMimeType ?? contentTypeOf(row.name), data } }
      }
      catch (error) {
        if (!isMissingObject(error))
          throw error
        this.logger.warn(`附件 ${row.id} 的图片对象不存在，已按读不到处理`)
        return { text: { name: row.name, text: '[Image omitted: could not be loaded.]' } }
      }
    }))
    const images = parts.flatMap(part => part.image ? [part.image] : [])

    return { modelContent: userMessageContent(text, parts.map(part => part.text)), ...(images.length > 0 ? { images } : {}) }
  }

  /** 删会话时调用，和删会话在同一个事务里：先标记，提交后由 `kickSweep` 删对象。 */
  async markConversationDeleted(db: Prisma.TransactionClient, conversationId: string): Promise<void> {
    await db.attachment.updateMany({ where: { conversationId, deletedAt: null }, data: { deletedAt: new Date() } })
  }

  /** 触发一次后台清理，不等它结束；已经在跑就不重复开。 */
  kickSweep(): void {
    this.sweeping ??= this.sweep()
      .catch(error => this.logger.error('附件清理失败，下次再试', error instanceof Error ? error.stack : undefined))
      .finally(() => {
        this.sweeping = undefined
      })
  }

  /**
   * 清理待删除的附件：删 OSS 对象，成功了才删行；失败的留着标记，下次再试。
   * 顺带把上传后长期没发出去的标成待删除。只按行里记下的确切 key 删，不列举前缀。
   */
  async sweep(): Promise<void> {
    if (!this.storage.configured)
      return

    await this.prisma.attachment.updateMany({
      where: { messageId: null, deletedAt: null, createdAt: { lt: new Date(Date.now() - UNSENT_TTL_MS) } },
      data: { deletedAt: new Date() },
    })

    const rows = await this.prisma.attachment.findMany({
      // 换过 Bucket 的旧行不归当前凭据管，留着不动。
      where: { deletedAt: { not: null }, bucket: this.storage.bucket },
      orderBy: { deletedAt: 'asc' },
      take: SWEEP_BATCH,
      select: { id: true, objectKey: true, modelObjectKey: true },
    })

    for (const row of rows) {
      try {
        await this.storage.delete(row.objectKey)
        if (row.modelObjectKey)
          await this.storage.delete(row.modelObjectKey)
        await this.prisma.attachment.delete({ where: { id: row.id } })
      }
      catch (error) {
        this.logger.warn(`附件 ${row.id} 的对象没删掉，下次再试：${error instanceof Error ? error.message : String(error)}`)
      }
    }
  }

  private async documentText(name: string, content: Buffer, signal?: AbortSignal): Promise<string> {
    const extension = extensionOf(name)

    if (['md', 'txt', 'csv', 'json'].includes(extension)) {
      const text = decodeText(content)
      if (text === undefined)
        throw new BadRequestException('这个文件不是文本，读不出内容')
      return text
    }

    try {
      return await extractDocumentText(extension, content, signal)
    }
    catch (error) {
      signal?.throwIfAborted()
      if (error instanceof ServiceUnavailableException)
        throw error
      if (error instanceof DOMException && error.name === 'TimeoutError')
        throw new BadRequestException('文件解析超时，请换一个较小的文件')
      throw new BadRequestException('文件读不出来，可能已损坏或加了密码')
    }
  }

  /**
   * 读图片尺寸（顺带确认它真的能解码），需要时另存一份给模型的缩放图。
   * GIF 一律转成 PNG 给模型（同 Codex `utils/image`：部分模型不收 GIF）。
   */
  private async prepareImage(userId: string, id: string, name: string, bytes: number) {
    const objectKey = attachmentObjectKey(userId, id, 'original')
    const extension = extensionOf(name)
    let size: { width: number, height: number }

    try {
      size = await this.storage.imageSize(objectKey)
    }
    catch {
      throw new BadRequestException('图片读不出来，可能已损坏')
    }

    const fits = size.width <= MODEL_IMAGE_MAX_SIDE && size.height <= MODEL_IMAGE_MAX_SIDE && bytes <= MODEL_IMAGE_MAX_BYTES
    if (fits && extension !== 'gif')
      return { ...size, modelObjectKey: null, modelMimeType: null }

    for (const candidate of modelImageProcesses(extension)) {
      const content = await this.storage.read(objectKey, candidate.process)
      if (content.length > MODEL_IMAGE_MAX_BYTES)
        continue

      const modelObjectKey = attachmentObjectKey(userId, id, 'model')
      // 对象可能写成功但确认失败：put 前就登记确切 key，崩溃/后续更新失败仍能清理。
      await this.prisma.attachment.update({ where: { id }, data: { modelObjectKey, modelMimeType: candidate.mimeType } })
      await this.storage.put(modelObjectKey, content, candidate.mimeType)
      return { ...size, modelObjectKey, modelMimeType: candidate.mimeType }
    }

    throw new BadRequestException('图片太大，压缩后仍超出上限，请换一张小一点的')
  }

  private async imageData(key: string): Promise<string> {
    const cached = this.imageCache.get(key)
    if (cached !== undefined) {
      this.imageCache.delete(key)
      this.imageCache.set(key, cached)
      return cached
    }

    const data = (await this.storage.read(key)).toString('base64')
    // 并发 miss 可能已经写入同一 key：扣掉覆盖值，不能只增加账面字节。
    this.imageCacheBytes -= this.imageCache.get(key)?.length ?? 0
    this.imageCache.delete(key)
    this.imageCache.set(key, data)
    this.imageCacheBytes += data.length

    for (const [oldest, value] of this.imageCache) {
      if (this.imageCacheBytes <= IMAGE_CACHE_MAX_BYTES)
        break
      this.imageCache.delete(oldest)
      this.imageCacheBytes -= value.length
    }

    return data
  }
}
