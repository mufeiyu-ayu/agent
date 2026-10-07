import type { PrismaService } from '../prisma/prisma.service.js'
import type { WorkspaceCloudService } from './workspace-cloud.service.js'
import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { it } from 'vitest'
import { fileHash } from './workspace-files.js'
import { WorkspaceGcService } from './workspace-gc.service.js'

it('300 个全保留对象只查询扫描/收尾两套引用，不随对象数量逐项放大', async () => {
  const prefix = 'users/u/conversations/c/'
  const files = Array.from({ length: 300 }, (_, i) => {
    const sha256 = fileHash(Buffer.from(String(i)))
    return { path: `${i}.txt`, bytes: 1, sha256, key: `${prefix}objects/${sha256}` }
  })
  let referencesRead = 0
  let pending = false
  const db = {
    $executeRaw: async () => 1,
    workspaceGcTarget: { findUnique: async () => ({ userId: 'u', bucket: 'fixture', generation: 1 }), updateMany: async (args: { data: { pending: boolean } }) => {
      pending = args.data.pending
      return { count: 1 }
    } },
    conversation: { findFirst: async () => ({ id: 'c' }) },
    conversationWorkspace: { findUnique: async () => ({ files: files.slice(0, 100), artifactId: 'current' }) },
    workspaceUpload: { count: async () => 0, deleteMany: async () => ({ count: 0 }) },
    workspaceArtifact: { findMany: async () => {
      referencesRead++
      return [{ id: 'current', files: files.slice(100, 200) }, { id: 'old', files: files.slice(200), retiredAt: new Date(), previewExpiresAt: new Date(Date.now() + 600000) }]
    }, deleteMany: async () => ({ count: 0 }) },
  }
  const prisma = { ...db, withDeadlineTransaction: async (_deadline: unknown, callback: (tx: { execute: (fn: (client: typeof db) => Promise<unknown>) => Promise<unknown> }) => Promise<unknown>) => callback({ execute: fn => fn(db) }) } as unknown as PrismaService
  const cloud = { storageBucket: 'fixture', listFiles: async () => ({ keys: files.map(file => file.key) }), deleteFile: async () => {
    throw new Error('有效引用不能删除')
  } } as unknown as WorkspaceCloudService
  const result = await new WorkspaceGcService(prisma, cloud).collect('c', true)
  assert.equal(result.retained.length, 300)
  assert.equal(referencesRead, 2)
  assert.equal(pending, true, '旧预览仍需到期重扫')
  console.log('GC reference scans', { objects: 300, before: 302, after: referencesRead, deletes: result.deleted.length })
})
