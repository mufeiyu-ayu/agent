import type { PrismaService } from '../prisma/prisma.service.js'
import type { AttachmentModelRow } from './attachments.service.js'
import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { it } from 'vitest'
import { AttachmentStorageService } from './attachment-storage.service.js'
import { AttachmentsService } from './attachments.service.js'

it('图片尺寸按显示方向给：EXIF Orientation 5–8（手机竖拍）时宽高对调，其余原样', async () => {
  const storage = new AttachmentStorageService()
  const sizeOf = (orientation?: string) => {
    storage.read = async () => Buffer.from(JSON.stringify({ ImageWidth: { value: '4032' }, ImageHeight: { value: '3024' }, ...(orientation ? { Orientation: { value: orientation } } : {}) }))
    return storage.imageSize('key')
  }
  assert.deepEqual(await sizeOf('6'), { width: 3024, height: 4032 })
  assert.deepEqual(await sizeOf('3'), { width: 4032, height: 3024 })
  assert.deepEqual(await sizeOf(), { width: 4032, height: 3024 })
})

it('图片缓存：同 key 的并发 miss 不能虚增容量，轮替读图后最近的图片仍然命中', async () => {
  // 每张 3 MiB，在模型图片上限以内；重复同一不可变对象只应记一份缓存容量。
  const content = Buffer.alloc(3 * 1024 * 1024)
  let reads = 0
  const storage = { read: async () => {
    reads++
    await Promise.resolve()
    return content
  } }
  const service = new AttachmentsService({} as PrismaService, storage as unknown as AttachmentStorageService)
  let last: AttachmentModelRow[] = []
  for (let index = 0; index < 17; index++) {
    last = [{ id: `image-${index}`, kind: 'image', name: 'image.png', extractedText: null, objectKey: `image-${index}`, modelObjectKey: null, modelMimeType: null }]
    await Promise.all([service.modelInput('', last), service.modelInput('', last)])
  }
  const before = reads
  await service.modelInput('', last)
  assert.equal(reads, before, '最近的图应留在缓存，而不是被重复记账永久淘汰')
})
