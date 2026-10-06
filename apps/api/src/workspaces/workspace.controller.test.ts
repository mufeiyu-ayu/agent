import type { AddressInfo } from 'node:net'
import type { AuthService } from '../auth/auth.service.js'
import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { Module } from '@nestjs/common'
import { NestFactory, Reflector } from '@nestjs/core'
import { it, onTestFinished, vi } from 'vitest'
import { AuthGuard, readAppOrigins } from '../auth/auth.guard.js'
import { registerAppGlobals } from '../common/bootstrap/register-app-globals.js'
import { PrismaService } from '../prisma/prisma.service.js'
import { WorkspaceCloudService } from './workspace-cloud.service.js'
import { fileHash } from './workspace-files.js'
import { WorkspacePreviewService } from './workspace-preview.service.js'
import { WorkspaceController, WorkspacePreviewController } from './workspace.controller.js'
import { WorkspaceService } from './workspace.service.js'

it('真实 Nest 入口：认证 mint/归档 DTO、opaque CSP、attachment/CORS/MIME、归属与过期', async () => {
  const contents = { 'index.html': '<html><script type="module" src="./assets/app.js"></script></html>', 'assets/app.js': 'document.body.textContent="DEMO"', 'assets/big.js': 'x'.repeat(2 * 1024 * 1024) }
  const files = Object.entries(contents).map(([path, content]) => ({ path, bytes: Buffer.byteLength(content), sha256: fileHash(Buffer.from(content)), key: `users/A/conversations/C/objects/${fileHash(Buffer.from(content))}` }))
  const row = { id: 'build', userId: 'A', conversationId: 'C', sourceRevision: 1, runId: 'run', command: 'pnpm build', createdAt: new Date(), retiredAt: null, previewExpiresAt: null as Date | null, files }
  const lock = vi.fn(async () => 1)
  const protect = vi.fn(async ({ where, data }: { where: { id: string }, data: { previewExpiresAt: Date } }) => {
    assert.equal(where.id, row.id)
    row.previewExpiresAt = data.previewExpiresAt
    return row
  })
  const prisma = {
    $executeRaw: lock,
    withDeadlineTransaction: async (_deadline: unknown, callback: (transaction: { execute: (operation: (db: unknown) => Promise<unknown>) => Promise<unknown> }) => Promise<unknown>) => callback({ execute: operation => operation(prisma) }),
    conversationWorkspace: { findFirst: async ({ where }: { where: { userId: string, conversationId: string, artifactId: string } }) => where.userId === row.userId && where.conversationId === row.conversationId && where.artifactId === row.id ? { userId: row.userId, conversationId: row.conversationId, artifactId: row.id } : null },
    workspaceArtifact: {
      findFirst: async ({ where }: { where: { id: string, userId: string, conversationId: string, conversation: { userId: string, user: { disabled: boolean, pendingApproval: boolean } } } }) => where.id === row.id && where.userId === row.userId && where.conversationId === row.conversationId && where.conversation.userId === row.userId && !where.conversation.user.disabled && !where.conversation.user.pendingApproval ? row : null,
      update: protect,
    },
  }
  const cloud = { readFile: async (file: { path: string }) => Buffer.from(contents[file.path as keyof typeof contents]) }
  const archive = vi.fn(async () => Buffer.from('ZIP'))
  @Module({
    controllers: [WorkspaceController, WorkspacePreviewController],
    providers: [
      WorkspacePreviewService,
      { provide: PrismaService, useValue: prisma },
      { provide: WorkspaceCloudService, useValue: cloud },
      { provide: WorkspaceService, useValue: { archive } },
    ],
  })
  class FixtureModule {}
  const app = await NestFactory.create(FixtureModule, { logger: false })
  registerAppGlobals(app)
  app.useGlobalGuards(new AuthGuard(new Reflector(), { authenticate: async (token: string) => ['A', 'B'].includes(token) ? { user: { id: token, role: 'USER', mustChangePassword: false } } : null } as unknown as AuthService))
  await app.listen(0, '127.0.0.1')
  onTestFinished(() => app.close())
  const base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}/api`
  const path = `/conversations/C/workspace/artifacts/build/preview?origin=${encodeURIComponent(readAppOrigins()[0]!)}`
  assert.equal((await fetch(base + path)).status, 401)
  assert.equal((await fetch(base + path, { headers: { Cookie: 'agent_session=B' } })).status, 404)
  assert.equal((await fetch(base + path.replace('/C/', '/D/'), { headers: { Cookie: 'agent_session=A' } })).status, 404)
  assert.equal((await fetch(base + path.replace('/build/', '/other/'), { headers: { Cookie: 'agent_session=A' } })).status, 404)
  assert.equal(protect.mock.calls.length, 0)
  const minted = await fetch(base + path, { headers: { Cookie: 'agent_session=A' } })
  assert.equal(minted.status, 200)
  assert.ok(lock.mock.calls.length > 0)
  assert.equal(protect.mock.calls.length, 1)
  assert.ok(row.previewExpiresAt && row.previewExpiresAt.getTime() > Date.now())
  const data = (await minted.json()).data
  const url = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}${data.url}`
  const document = await fetch(url)
  assert.equal(document.status, 200)
  assert.match(document.headers.get('content-security-policy')!, /^sandbox allow-scripts;/)
  assert.doesNotMatch(document.headers.get('content-security-policy')!, /allow-same-origin|connect-src 'self'/)
  assert.ok((await document.text()).startsWith('<!doctype html>'))
  const asset = await fetch(url.replace('/document', '/files/assets/app.js?v=1'))
  assert.equal(asset.status, 200)
  assert.equal(await asset.text(), contents['assets/app.js'])
  assert.equal(asset.headers.get('content-type'), 'text/javascript')
  assert.equal(asset.headers.get('content-disposition'), 'attachment')
  assert.equal(asset.headers.get('access-control-allow-origin'), 'null')
  assert.equal(asset.headers.get('access-control-allow-credentials'), null)
  assert.match(asset.headers.get('content-security-policy')!, /^sandbox;/)
  assert.equal((await fetch(url.replace('/document', '/files/%252e%252e/index.html'))).status, 404)
  const invalid = await fetch(`${base}/conversations/C/workspace/archive?revision=no`, { headers: { Cookie: 'agent_session=A' } })
  assert.equal(invalid.status, 400)
  assert.equal(archive.mock.calls.length, 0)
  assert.equal((await fetch(`${base}/conversations/C/workspace/archive?revision=1`, { headers: { Cookie: 'agent_session=A' } })).status, 200)
  assert.equal(archive.mock.calls.length, 1)
  for (let i = 0; i < 15; i++) {
    const big = await fetch(url.replace('/document', `/files/assets/big.js?q=${i}`))
    assert.equal(big.status, 200)
    await big.arrayBuffer()
  }
  assert.equal((await fetch(url.replace('/document', '/files/assets/big.js?q=again'))).status, 429)
  const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 11 * 60_000)
  onTestFinished(() => clock.mockRestore())
  assert.equal((await fetch(url)).status, 404)
})
