import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { randomUUID } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import process from 'node:process'
import { deflateSync } from 'node:zlib'
import { MessageRole, MessageStatus } from '../generated/prisma/client.js'
import { PrismaService } from '../prisma/prisma.service.js'
import { MODEL_IMAGE_MAX_BYTES } from './attachment-files.js'
import { AttachmentStorageService, isMissingObject } from './attachment-storage.service.js'
import { AttachmentsService } from './attachments.service.js'

/**
 * 手动云验证：附件服务对真实 OSS 的读写、图片处理与清理。不进默认测试。
 * 在 apps/api 下运行：node --env-file=../../.env --import tsx src/attachments/attachments.smoke.ts
 * 数据库只用 TEST_DATABASE_URL 里的独立 schema；对象只写在本轮随机用户的前缀下，结束时由服务自己的清理删掉并核对。
 * 不调用模型。
 */
const testDatabaseUrl = process.env.TEST_DATABASE_URL?.trim() ?? ''
if (!testDatabaseUrl || testDatabaseUrl === process.env.DATABASE_URL?.trim())
  throw new Error('需要独立的 TEST_DATABASE_URL，不在开发库上运行')

const MIGRATIONS_DIR = new URL('../../../../prisma/migrations/', import.meta.url)
const { Pool } = createRequire(import.meta.url)('pg') as { Pool: new (options: { connectionString: string, max: number }) => { query: (text: string) => Promise<unknown>, end: () => Promise<void> } }
const schema = `attachments_smoke_${randomUUID().replaceAll('-', '')}`
const userId = `attach_check_${randomUUID().slice(0, 8)}`
const pool = new Pool({ connectionString: testDatabaseUrl, max: 1 })
const storage = new AttachmentStorageService()
let prisma: PrismaService | undefined

/** 一张真的能解码的纯色渐变 PNG。 */
function png(width: number, height: number): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data])
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(body))
    const length = Buffer.alloc(4)
    length.writeUInt32BE(data.length)
    return Buffer.concat([length, body, crc])
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header.set([8, 2, 0, 0, 0], 8)
  const row = Buffer.alloc(1 + width * 3)
  const rows = Buffer.concat(Array.from({ length: height }, (_, y) => {
    row.fill(Math.round(200 - 100 * y / height), 1)
    return Buffer.from(row)
  }))
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]), chunk('IHDR', header), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))])
}

function crc32(data: Buffer): number {
  let crc = 0xFFFFFFFF
  for (const byte of data) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit++)
      crc = (crc >>> 1) ^ (0xEDB88320 & -(crc & 1))
  }
  return (crc ^ 0xFFFFFFFF) >>> 0
}

async function collect(stream: AsyncIterable<Buffer>): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const chunk of stream)
    chunks.push(chunk)
  return Buffer.concat(chunks)
}

async function main() {
  try {
    assert.ok(storage.configured, 'OSS 没配置')
    await pool.query(`CREATE SCHEMA "${schema}"`)
    await pool.query(`SET search_path TO "${schema}", public`)
    for (const migration of (await readdir(MIGRATIONS_DIR, { withFileTypes: true })).filter(entry => entry.isDirectory()).map(entry => entry.name).sort())
      await pool.query(await readFile(new URL(`${migration}/migration.sql`, MIGRATIONS_DIR), 'utf8'))

    const url = new URL(testDatabaseUrl)
    url.searchParams.set('schema', schema)
    url.searchParams.set('options', `-c search_path=${schema},public`)
    prisma = new PrismaService(url.toString())
    await prisma.$connect()
    const service = new AttachmentsService(prisma, storage)
    const fixture = (name: string) => readFile(new URL(`./__fixtures__/${name}`, import.meta.url))
    const report: Record<string, unknown> = { bucket: storage.bucket, userId }

    const large = await service.upload(userId, { name: '大图.png', content: png(3000, 2000) })
    const small = await service.upload(userId, { name: '小图.png', content: png(320, 200) })
    const largeRow = await prisma.attachment.findUniqueOrThrow({ where: { id: large.id } })
    assert.deepEqual([large.width, large.height], [3000, 2000])
    assert.ok(largeRow.modelObjectKey, '超出上限的图片应另存一份给模型')
    assert.equal((await prisma.attachment.findUniqueOrThrow({ where: { id: small.id } })).modelObjectKey, null)
    const modelSize = await storage.imageSize(largeRow.modelObjectKey)
    assert.ok(modelSize.width <= 2000 && modelSize.height <= 2000)
    report.largeImage = { original: [large.width, large.height], model: [modelSize.width, modelSize.height], modelMimeType: largeRow.modelMimeType }

    const thumbnail = await collect((await service.open(userId, large.id, 'thumb')).stream as AsyncIterable<Buffer>)
    assert.equal(thumbnail.subarray(1, 4).toString('latin1'), 'PNG')
    report.thumbnailBytes = thumbnail.length

    const documents = await Promise.all([
      service.upload(userId, { name: '表格.xlsx', content: await fixture('sheets.xlsx') }),
      service.upload(userId, { name: '文档.docx', content: await fixture('document.docx') }),
      service.upload(userId, { name: '报告.pdf', content: await fixture('report.pdf') }),
      service.upload(userId, { name: '说明.md', content: Buffer.from('# 标题') }),
    ])
    report.documents = Object.fromEntries(await Promise.all(documents.map(async document => [
      document.name,
      (await prisma!.attachment.findUniqueOrThrow({ where: { id: document.id } })).extractedText?.slice(0, 40),
    ])))

    await assert.rejects(service.upload(userId, { name: '坏图.png', content: Buffer.concat([Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]), Buffer.from('不是图片')]) }), /图片读不出来/)

    const conversation = await prisma.conversation.create({ data: { title: 'smoke' } })
    const { message, rows } = await prisma.$transaction(async (db) => {
      const message = await db.message.create({ data: { conversationId: conversation.id, role: MessageRole.USER, content: '看看', status: MessageStatus.COMPLETED } })
      return { message, rows: await service.bind(db, { userId, conversationId: conversation.id, messageId: message.id, attachmentIds: [large.id, documents[3]!.id, small.id] }) }
    })
    const input = await service.modelInput(message.content, rows)
    assert.equal(input.images?.length, 2)
    assert.ok(input.images!.every(image => Buffer.from(image.data, 'base64').length <= MODEL_IMAGE_MAX_BYTES))
    report.modelContent = input.modelContent
    report.modelImages = input.images!.map(image => [image.name, image.mimeType, Buffer.from(image.data, 'base64').length])

    const keys = (await prisma.attachment.findMany({ select: { objectKey: true, modelObjectKey: true } })).flatMap(row => [row.objectKey, ...(row.modelObjectKey ? [row.modelObjectKey] : [])])
    await prisma.attachment.updateMany({ where: { deletedAt: null }, data: { deletedAt: new Date() } })
    await service.sweep()
    assert.equal(await prisma.attachment.count(), 0)
    for (const key of keys)
      await assert.rejects(storage.read(key), isMissingObject)
    report.cleanedObjects = keys.length

    console.log(JSON.stringify(report, null, 2))
    console.log('PASS')
  }
  finally {
    await prisma?.$disconnect()
    await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
    await pool.end()
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
