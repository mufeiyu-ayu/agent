import type { PrismaService } from '../prisma/prisma.service.js'
import type { WorkspaceCloudService } from './workspace-cloud.service.js'
import type { WorkspaceGcService } from './workspace-gc.service.js'
import type { WorkspaceMonitoringService } from './workspace-monitoring.service.js'
import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { it, vi } from 'vitest'
import { WorkspaceUploadOutcomeUnknownError } from './workspace-cloud.service.js'
import { fileHash, WorkspaceOperationError } from './workspace-files.js'
import { WorkspaceService } from './workspace.service.js'

function fixture(previous: Array<{ path: string, content: Buffer }> = []) {
  const files = previous.map(file => ({ path: file.path, bytes: file.content.length, sha256: fileHash(file.content), key: `users/u/conversations/c/objects/${fileHash(file.content)}` }))
  const row = { files, revision: 1, artifactId: null }
  const db = {
    $executeRaw: async () => 1,
    workspaceGcTarget: { findUnique: async () => null },
    conversation: { findFirst: async () => ({ id: 'c', title: 'fixture' }) },
    conversationWorkspace: { upsert: async () => row, updateMany: async () => ({ count: 1 }), findUniqueOrThrow: async () => row },
  }
  const prisma = { ...db, withDeadlineTransaction: async (_deadline: unknown, callback: (tx: { execute: (fn: (db: typeof prisma) => Promise<unknown>) => Promise<unknown> }) => Promise<unknown>) => callback({ execute: fn => fn(prisma) }) } as unknown as PrismaService
  let snapshot: unknown[] = []
  const request = vi.fn(async (_sandbox: unknown, _script: string, input: { action?: string, known?: Record<string, number> }) => input.action === 'snapshot' ? { files: snapshot } : {})
  const putFile = vi.fn(async (_file: unknown, _content: Buffer, _signal: AbortSignal) => {})
  const cloud = { configured: true, request, putFile, create: async () => ({ sandboxId: 's', kill: async () => true }), readFile: async (file: { path: string }) => previous.find(item => item.path === file.path)!.content } as unknown as WorkspaceCloudService
  const finishUpload = vi.fn(async (_id: string, _unknown: boolean) => {})
  const gc = { waitForDeletion: async () => {}, beginUpload: async () => 'upload', uploading: async () => {}, finishUpload, afterRun: async () => {} } as unknown as WorkspaceGcService
  const monitoring = { begin: async () => {}, created: async () => {}, released: async () => {} } as unknown as WorkspaceMonitoringService
  const service = new WorkspaceService(prisma, cloud, monitoring, gc)
  const execution = { userId: 'u', conversationId: 'c', runId: 'r', deadlineAt: Date.now() + 60000 }
  return { service, execution, putFile, request, finishUpload, files, setSnapshot: (value: unknown[]) => {
    snapshot = value
  } }
}

it('四路 PUT 同 SHA 去重、保留清单顺序与原字节，受控计数不再串行', async () => {
  const f = fixture()
  const source = Array.from({ length: 8 }, (_, i) => ({ path: `${i}.txt`, content: Buffer.from(`file ${i}`).toString('base64') }))
  source.splice(1, 0, { ...source[0]!, path: 'duplicate.txt' })
  f.setSnapshot(source)
  let active = 0
  let peak = 0
  f.putFile.mockImplementation(async (file, content) => {
    assert.equal(fileHash(content), (file as { sha256: string }).sha256)
    active++
    peak = Math.max(peak, active)
    await new Promise(resolve => setTimeout(resolve, 20))
    active--
  })
  const started = performance.now()
  const result = await f.service.prepareCommit(f.execution, new AbortController().signal)
  assert.deepEqual(result?.files.map(file => file.path), source.map(file => file.path))
  assert.equal(f.putFile.mock.calls.length, 8)
  assert.equal(peak, 4)
  assert.deepEqual(f.finishUpload.mock.calls, [['upload', false]])
  console.log('upload controlled evidence', { uniqueObjects: 8, delayMs: 20, serialLowerBoundMs: 160, measuredMs: Math.round(performance.now() - started), peak })
  await f.service.releaseRun('r')
})

it.each(['failure', 'abort'] as const)('PUT %s 后停止派发，必须等其余在途真实结局才收尾，晚到 unknown 不能丢', async (mode) => {
  const f = fixture()
  f.setSnapshot(Array.from({ length: 12 }, (_, i) => ({ path: `${i}.txt`, content: Buffer.from(`file ${i}`).toString('base64') })))
  const ends: Array<{ resolve: () => void, reject: (error: Error) => void }> = []
  f.putFile.mockImplementation(() => new Promise<void>((resolve, reject) => ends.push({ resolve, reject })))
  const controller = new AbortController()
  const pending = f.service.prepareCommit(f.execution, controller.signal).then(() => {
    throw new Error('不应发布')
  }, error => error)
  await vi.waitFor(() => assert.equal(ends.length, 4))
  if (mode === 'abort')
    controller.abort(new Error('cancel upload'))
  ends[0]!.reject(new WorkspaceOperationError('explicit failure'))
  await Promise.resolve()
  await Promise.resolve()
  assert.equal(f.finishUpload.mock.calls.length, 0)
  ends[1]!.resolve()
  ends[2]!.resolve()
  ends[3]!.reject(new WorkspaceUploadOutcomeUnknownError())
  assert.ok(await pending instanceof Error)
  assert.equal(f.putFile.mock.calls.length, 4)
  assert.deepEqual(f.finishUpload.mock.calls, [['upload', true]])
  await f.service.releaseRun('r')
})

it('仅受保护的 SHA/长度可省略内容；未知、错长度/哈希和缺失内容拒绝', async () => {
  const content = Buffer.from('confirmed source')
  const f = fixture([{ path: 'a.txt', content }])
  const known = { path: 'a.txt', sha256: fileHash(content), bytes: content.length }
  f.setSnapshot([known])
  const signal = new AbortController().signal
  assert.equal(await f.service.prepareCommit(f.execution, signal), undefined)
  assert.deepEqual(f.request.mock.calls.find(call => call[2].action === 'snapshot')![2].known, { [known.sha256]: content.length })
  f.setSnapshot([known, { ...known, path: 'copy.txt' }])
  assert.equal((await f.service.prepareCommit(f.execution, signal))?.files.length, 2)
  assert.equal(f.putFile.mock.calls.length, 0)
  for (const invalid of [
    { ...known, bytes: known.bytes + 1 },
    { ...known, sha256: 'b'.repeat(64) },
    { path: 'missing.txt' },
    { ...known, content: Buffer.from('different').toString('base64') },
    { path: 'bad.txt', content: content.toString('base64'), bytes: -1 },
  ]) {
    f.setSnapshot([invalid])
    await assert.rejects(f.service.prepareCommit(f.execution, signal), WorkspaceOperationError)
  }
  assert.equal(f.putFile.mock.calls.length, 0)
  await f.service.releaseRun('r')
})
