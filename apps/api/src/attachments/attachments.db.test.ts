import type { WorkspaceGcService } from '../workspaces/workspace-gc.service.js'
import type { AttachmentStorageService } from './attachment-storage.service.js'
import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { randomUUID } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import process from 'node:process'
import { Readable } from 'node:stream'
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common'
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest'

import { createRuntimeHost } from '../agent-runtime/agent-runtime-host.js'
import { loadConversationHistory } from '../agent-runtime/context/conversation-history.js'
import { ConversationsService } from '../conversations/conversations.service.js'
import { MessagesService } from '../conversations/messages.service.js'
import { MessageRole, MessageStatus } from '../generated/prisma/client.js'
import { PrismaService } from '../prisma/prisma.service.js'
import { AttachmentsService } from './attachments.service.js'

// 本入口不允许 skip：缺少隔离数据库时必须显式失败，而不是假装通过。
const testDatabaseUrl = process.env.TEST_DATABASE_URL?.trim()

if (!testDatabaseUrl)
  throw new Error('缺少 TEST_DATABASE_URL：先 docker compose --profile integration up -d postgres-test，再按 .env.example 在根目录 .env 配置')
if (testDatabaseUrl === process.env.DATABASE_URL?.trim())
  throw new Error('TEST_DATABASE_URL 不得与 DATABASE_URL 相同，禁止在开发库上运行真实库测试')

const MIGRATIONS_DIR = new URL('../../../../prisma/migrations/', import.meta.url)
const PNG_SIGNATURE = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]
const { Pool: PgPool } = createRequire(import.meta.url)('pg') as {
  Pool: new (options: { connectionString: string, max: number }) => {
    query: (text: string, values?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }>
    end: () => Promise<void>
  }
}

/** 内存里的对象存储：真实库 + 假存储，测的是记录与对象之间的先后和失败处理。 */
class MemoryStorage {
  readonly objects = new Map<string, Buffer>()
  readonly configured = true
  readonly bucket = 'test-bucket'
  imageSizeResult: { width: number, height: number } | Error = { width: 800, height: 600 }
  failDelete = false

  async put(key: string, content: Buffer) {
    this.objects.set(key, content)
  }

  async read(key: string, process?: string) {
    const content = this.objects.get(key)
    if (!content)
      throw Object.assign(new Error('NoSuchKey'), { code: 'NoSuchKey', status: 404 })
    // 带处理参数时返回一份可辨认的「缩放结果」。
    return process ? Buffer.from(`resized:${process}`) : content
  }

  async stream(key: string, process?: string) {
    return Readable.from(await this.read(key, process))
  }

  async imageSize() {
    if (this.imageSizeResult instanceof Error)
      throw this.imageSizeResult
    return this.imageSizeResult
  }

  async delete(key: string) {
    if (this.failDelete)
      throw new Error('存储暂时不可用')
    this.objects.delete(key)
  }
}

describe('附件（真实库）', { timeout: 60_000 }, () => {
  const schema = `attachments_test_${randomUUID().replaceAll('-', '')}`
  const adminPool = new PgPool({ connectionString: testDatabaseUrl, max: 1 })
  let prisma: PrismaService
  let storage: MemoryStorage
  let service: AttachmentsService
  let conversationId: string

  beforeAll(async () => {
    await adminPool.query(`CREATE SCHEMA "${schema}"`)
    await adminPool.query(`SET search_path TO "${schema}", public`)
    for (const migration of (await readdir(MIGRATIONS_DIR, { withFileTypes: true })).filter(entry => entry.isDirectory()).map(entry => entry.name).sort())
      await adminPool.query(await readFile(new URL(`${migration}/migration.sql`, MIGRATIONS_DIR), 'utf8'))

    const url = new URL(testDatabaseUrl)
    url.searchParams.set('schema', schema)
    url.searchParams.set('options', `-c search_path=${schema},public`)
    prisma = new PrismaService(url.toString())
    await prisma.$connect()
  })

  beforeEach(async () => {
    await prisma.attachment.deleteMany()
    await prisma.conversation.deleteMany()
    storage = new MemoryStorage()
    service = new AttachmentsService(prisma, storage as unknown as AttachmentStorageService)
    conversationId = (await prisma.conversation.create({ data: { title: '测试会话' } })).id
  })

  afterAll(async () => {
    await prisma?.$disconnect()
    assert.match(schema, /^attachments_test_[a-f\d]+$/)
    await adminPool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
    await adminPool.end()
  })

  const png = (bytes = 64) => Buffer.concat([Buffer.from(PNG_SIGNATURE), Buffer.alloc(bytes)])

  /** 和宿主的 createUserMessage 一样：同一个事务里写消息并绑定附件。 */
  async function send(userId: string, text: string, attachmentIds: string[]) {
    return prisma.$transaction(async (db) => {
      const message = await db.message.create({ data: { conversationId, role: MessageRole.USER, content: text, status: MessageStatus.COMPLETED } })
      const rows = await service.bind(db, { userId, conversationId, messageId: message.id, attachmentIds })
      return { message, rows }
    })
  }

  it('上传文档：文字在上传时抽好落库，对象按用户前缀存放；不属于自己的读不到', async () => {
    const uploaded = await service.upload('user-1', { name: '需求.md', content: Buffer.from('# 标题\n正文') })
    const row = await prisma.attachment.findUniqueOrThrow({ where: { id: uploaded.id } })

    assert.deepEqual(uploaded, { id: uploaded.id, kind: 'file', name: '需求.md', bytes: 15 })
    assert.equal(row.extractedText, '# 标题\n正文')
    assert.equal(row.objectKey, `users/user-1/attachments/${uploaded.id}/original`)
    assert.equal(storage.objects.get(row.objectKey)?.toString(), '# 标题\n正文')
    assert.equal(row.messageId, null)

    assert.equal((await service.open('user-1', uploaded.id)).contentType, 'text/plain; charset=utf-8')
    await assert.rejects(service.open('user-2', uploaded.id), NotFoundException)
  })

  it('上传图片：记下尺寸；超出上限时另存一份缩放后的给模型，没超出就不另存', async () => {
    const small = await service.upload('user-1', { name: 'a.png', content: png() })
    assert.deepEqual([small.width, small.height], [800, 600])
    assert.equal((await prisma.attachment.findUniqueOrThrow({ where: { id: small.id } })).modelObjectKey, null)

    storage.imageSizeResult = { width: 3000, height: 2000 }
    const large = await service.upload('user-1', { name: 'b.png', content: png() })
    const row = await prisma.attachment.findUniqueOrThrow({ where: { id: large.id } })

    assert.equal(row.modelObjectKey, `users/user-1/attachments/${large.id}/model`)
    assert.equal(row.modelMimeType, 'image/png')
    assert.match(storage.objects.get(row.modelObjectKey!)!.toString(), /^resized:image\/auto-orient,1\/resize,m_lfit,w_2000,h_2000/)
  })

  it('模型对象写入前已有确切 key：写完后故障仍能回收全部对象', async () => {
    storage.imageSizeResult = { width: 3000, height: 2000 }
    storage.failDelete = true
    const put = storage.put.bind(storage)
    storage.put = async (key, content) => {
      await put(key, content)
      if (key.endsWith('/model')) {
        const row = await prisma.attachment.findFirstOrThrow({ where: { modelObjectKey: key } })
        assert.equal(row.modelObjectKey, key)
        throw new Error('model put confirmation failed')
      }
    }
    await assert.rejects(service.upload('user-1', { name: 'large.png', content: png() }), /model put confirmation failed/)
    const row = await prisma.attachment.findFirstOrThrow()
    assert.ok(row.deletedAt)
    assert.ok(row.modelObjectKey)
    storage.failDelete = false
    await service.sweep()
    assert.equal(storage.objects.size, 0)
    assert.equal(await prisma.attachment.count(), 0)
  })

  it('删会话的标记之后才绑上的附件：随消息级联解绑，不留在消息上，由过期清理收走', async () => {
    const owner = await prisma.user.create({ data: { email: `${randomUUID()}@example.invalid` } })
    await prisma.conversation.update({ where: { id: conversationId }, data: { userId: owner.id } })
    const file = await service.upload(owner.id, { name: 'file.md', content: Buffer.from('test') })
    // 只调用宿主提交方法，不调用模型/工具；其他宿主依赖在这条路径上不会执行。
    const host = createRuntimeHost({ userId: owner.id } as Parameters<typeof createRuntimeHost>[0], { prisma, attachments: service, recorder: {} } as Parameters<typeof createRuntimeHost>[1])
    // 发送路径不和删会话抢锁：把一次发送插在「标记附件」与「删会话」之间，这是标记漏掉它的唯一窗口。
    const mark = service.markConversationDeleted.bind(service)
    service.markConversationDeleted = async (...args) => {
      await mark(...args)
      await host.createUserMessage(conversationId, 'test', [file.id])
    }
    const conversations = new ConversationsService(prisma, { register: async () => {}, kick: () => {} } as unknown as WorkspaceGcService, service)
    await conversations.delete(owner.id, conversationId)

    assert.equal(await prisma.message.count(), 0)
    const row = await prisma.attachment.findUniqueOrThrow({ where: { id: file.id } })
    assert.deepEqual([row.messageId, row.deletedAt], [null, null])
    await prisma.attachment.update({ where: { id: file.id }, data: { createdAt: new Date(Date.now() - 25 * 60 * 60 * 1000) } })
    await service.sweep()
    assert.equal(await prisma.attachment.count(), 0)
    assert.equal(storage.objects.size, 0)
  })

  it('发送已提交、运行还没开始（客户端等不到 start）：消息接口已经带着这批附件，同一批原样再发整体被拒', async () => {
    const owner = await prisma.user.create({ data: { email: `${randomUUID()}@example.invalid` } })
    await prisma.conversation.update({ where: { id: conversationId }, data: { userId: owner.id } })
    const file = await service.upload(owner.id, { name: 'file.md', content: Buffer.from('test') })
    const host = createRuntimeHost({ userId: owner.id } as Parameters<typeof createRuntimeHost>[0], { prisma, attachments: service, recorder: {} } as Parameters<typeof createRuntimeHost>[1])
    await service.assertSendable(owner.id, [file.id])
    // 只走到提交：不建 Run、不读历史、不发 run_started，等同于客户端在这之后断开或停止。
    const message = await host.createUserMessage(conversationId, '看看', [file.id])

    const conversations = new ConversationsService(prisma, { register: async () => {}, kick: () => {} } as unknown as WorkspaceGcService, service)
    const listed = await new MessagesService(prisma, conversations).listMessages(owner.id, conversationId)
    assert.deepEqual(listed.map(item => [item.id, item.attachments?.map(attachment => attachment.id)]), [[message.id, [file.id]]])

    // 再发：写响应头之前的检查先拦下并给出原因；即使越过它，事务里的绑定也整体失败。
    await assert.rejects(service.assertSendable(owner.id, [file.id]), ConflictException)
    await assert.rejects(host.createUserMessage(conversationId, '再发', [file.id]), BadRequestException)
    assert.equal(await prisma.message.count(), 1)
  })

  it('拒绝的上传不留东西：类型不对、内容与扩展名不符、图片解不开（已存的对象由清理删掉）', async () => {
    await assert.rejects(service.upload('user-1', { name: 'a.html', content: Buffer.from('<p>') }), BadRequestException)
    await assert.rejects(service.upload('user-1', { name: 'a.png', content: Buffer.from('<html>') }), BadRequestException)
    await assert.rejects(service.upload('user-1', { name: 'a.txt', content: Buffer.from([0x61, 0x00]) }), BadRequestException)
    assert.equal(await prisma.attachment.count(), 0)

    storage.imageSizeResult = new Error('This image format is not supported.')
    await assert.rejects(service.upload('user-1', { name: 'bad.png', content: png() }), /图片读不出来/)
    await service.sweep()
    assert.equal(await prisma.attachment.count(), 0)
    assert.equal(storage.objects.size, 0)
  })

  it('发送时绑定：按用户选择的顺序记位置；别人的、发过的、已删除的整体失败，消息不落库', async () => {
    const first = await service.upload('user-1', { name: '1.md', content: Buffer.from('一') })
    const second = await service.upload('user-1', { name: '2.md', content: Buffer.from('二') })
    const foreign = await service.upload('user-2', { name: 'x.md', content: Buffer.from('别人的') })

    const { message, rows } = await send('user-1', '看看', [second.id, first.id])
    assert.deepEqual(rows.map(row => row.name), ['2.md', '1.md'])
    assert.deepEqual(
      await prisma.attachment.findMany({ where: { messageId: message.id }, orderBy: { position: 'asc' }, select: { id: true, conversationId: true } }),
      [{ id: second.id, conversationId }, { id: first.id, conversationId }],
    )

    const messagesBefore = await prisma.message.count()
    await assert.rejects(send('user-1', '重复发', [first.id]), BadRequestException)
    await assert.rejects(send('user-1', '用别人的', [foreign.id]), BadRequestException)
    const third = await service.upload('user-1', { name: '3.md', content: Buffer.from('三') })
    await service.remove('user-1', third.id)
    await assert.rejects(send('user-1', '用已移除的', [third.id]), BadRequestException)
    assert.equal(await prisma.message.count(), messagesBefore)

    // 已经发出的不能再当「未发送」移除。
    await assert.rejects(service.remove('user-1', first.id), NotFoundException)
  })

  it('模型看到的内容只取自记录：文档文字拼进正文、图片按顺序读出；读历史与发送当时一致，图片对象丢了就写明', async () => {
    storage.imageSizeResult = { width: 3000, height: 2000 }
    const doc = await service.upload('user-1', { name: '报表.csv', content: Buffer.from('日期,访问量\n9/1,1203') })
    const first = await service.upload('user-1', { name: 'a.png', content: png() })
    const second = await service.upload('user-1', { name: 'b.png', content: png() })
    const { message, rows } = await send('user-1', '帮我看看', [first.id, doc.id, second.id])

    const sent = await service.modelInput(message.content, rows)
    assert.equal(sent.modelContent, '<file name="a.png"></file>\n<file name="报表.csv">\n日期,访问量\n9/1,1203\n</file>\n<file name="b.png"></file>\n帮我看看')
    assert.deepEqual(sent.images?.map(image => [image.name, image.mimeType]), [['a.png', 'image/png'], ['b.png', 'image/png']])
    // 发给模型的是缩放后的那份，不是原文件。
    assert.match(Buffer.from(sent.images![0]!.data, 'base64').toString(), /^resized:/)

    await prisma.message.create({ data: { conversationId, role: MessageRole.ASSISTANT, content: '好的', status: MessageStatus.COMPLETED } })
    const deadline = { deadlineAt: Date.now() + 10_000, createTimeoutError: () => new Error('timeout') }
    const { history } = await loadConversationHistory(prisma, conversationId, undefined, deadline, service)
    assert.deepEqual(history.groups[0]!.question, { content: sent.modelContent, images: sent.images, createdAt: message.createdAt })

    // 写摘要只要文字：不读图片。
    const textOnly = await loadConversationHistory(prisma, conversationId, undefined, deadline, service, { images: false })
    assert.equal(textOnly.history.groups[0]!.question!.content, sent.modelContent)
    assert.equal(textOnly.history.groups[0]!.question!.images, undefined)

    storage.objects.clear()
    const lost = await new AttachmentsService(prisma, storage as unknown as AttachmentStorageService).modelInput(message.content, rows)
    assert.equal(lost.images, undefined)
    assert.match(lost.modelContent, /<file name="a\.png">\n\[Image omitted: could not be loaded\.\]\n<\/file>/)
  })

  it('删会话：附件不随级联消失，同事务标记；清理先删对象再删行，对象没删掉就留着标记下次再试', async () => {
    storage.imageSizeResult = { width: 3000, height: 2000 }
    const image = await service.upload('user-1', { name: 'a.png', content: png() })
    const other = await service.upload('user-1', { name: '别的会话还没发的.md', content: Buffer.from('保留') })
    await send('user-1', '', [image.id])
    assert.equal(storage.objects.size, 3)

    await prisma.$transaction(async (db) => {
      await service.markConversationDeleted(db, conversationId)
      await db.conversation.delete({ where: { id: conversationId } })
    })
    const marked = await prisma.attachment.findUniqueOrThrow({ where: { id: image.id } })
    assert.ok(marked.deletedAt)
    assert.equal(marked.messageId, null)
    await assert.rejects(service.open('user-1', image.id), NotFoundException)

    storage.failDelete = true
    await service.sweep()
    assert.equal(await prisma.attachment.count({ where: { id: image.id } }), 1)

    storage.failDelete = false
    await service.sweep()
    assert.equal(await prisma.attachment.count({ where: { id: image.id } }), 0)
    assert.deepEqual([...storage.objects.keys()], [`users/user-1/attachments/${other.id}/original`])
  })

  it('上传后 24 小时没发出去的由清理收走；刚上传的和已发出的不动', async () => {
    const stale = await service.upload('user-1', { name: '旧的.md', content: Buffer.from('旧') })
    const fresh = await service.upload('user-1', { name: '新的.md', content: Buffer.from('新') })
    const sent = await service.upload('user-1', { name: '发出的.md', content: Buffer.from('发') })
    await send('user-1', '', [sent.id])
    const longAgo = new Date(Date.now() - 25 * 60 * 60 * 1000)
    await prisma.attachment.updateMany({ where: { id: { in: [stale.id, sent.id] } }, data: { createdAt: longAgo } })

    await service.sweep()

    assert.deepEqual((await prisma.attachment.findMany({ orderBy: { name: 'asc' }, select: { id: true } })).map(row => row.id).sort(), [fresh.id, sent.id].sort())
    assert.equal(storage.objects.size, 2)
  })
})
