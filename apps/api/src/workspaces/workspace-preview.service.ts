import type { Buffer } from 'node:buffer'
import type { Prisma } from '../generated/prisma/client.js'
import type { StoredWorkspaceFile } from './workspace-files.js'
import { randomBytes } from 'node:crypto'
import { BadRequestException, HttpException, Inject, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common'
import { readAppOrigins } from '../auth/auth.guard.js'
import { PrismaService } from '../prisma/prisma.service.js'
import { WorkspaceCloudService } from './workspace-cloud.service.js'
import { lockWorkspaceStorage, workspaceDb } from './workspace-db.js'
import { artifactPath, parseStoredFiles } from './workspace-files.js'
import { artifactMime, previewCsp, previewDocument } from './workspace-preview.js'

interface PreviewGrant { userId: string, conversationId: string, artifactId: string, expiresAt: number, origin: string, remainingBytes: number, remainingRequests: number }

@Injectable()
export class WorkspacePreviewService {
  private readonly grants = new Map<string, PreviewGrant>()

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(WorkspaceCloudService) private readonly cloud: WorkspaceCloudService,
  ) {}

  async open(userId: string, conversationId: string, artifactId: string, origin: string) {
    if (!readAppOrigins().includes(origin))
      throw new BadRequestException('预览宿主来源不被允许')
    const expiresAt = Date.now() + 10 * 60_000
    await workspaceDb(this.prisma, async (db) => {
      await lockWorkspaceStorage(db, conversationId)
      const current = await db.conversationWorkspace.findFirst({ where: { conversationId, userId, artifactId } })
      if (!current)
        throw new NotFoundException('旧构建已退役，请打开当前最近成功构建')
      const artifact = await this.artifact({ userId, conversationId, artifactId, expiresAt, origin, remainingBytes: 0, remainingRequests: 0 }, db)
      // 锁等待/多进程时间差不能缩短已发出的能力保护期。
      await db.workspaceArtifact.update({ where: { id: artifactId }, data: { previewExpiresAt: new Date(Math.max(expiresAt, artifact.previewExpiresAt?.getTime() ?? 0)) } })
    })
    for (const [token, grant] of this.grants) {
      if (grant.expiresAt <= Date.now())
        this.grants.delete(token)
    }
    // 只读短期能力，不是用户 Session 或 Agent 授权；重启失效后由宿主重新打开同一个 Artifact。
    const token = randomBytes(32).toString('hex')
    this.grants.set(token, { userId, conversationId, artifactId, expiresAt, origin, remainingBytes: 32 * 1024 * 1024, remainingRequests: 2000 })
    while (this.grants.size > 1000)
      this.grants.delete(this.grants.keys().next().value!)
    return { artifactId, url: `/api/workspace-preview/${token}/document`, expiresAt: new Date(expiresAt).toISOString() }
  }

  async resource(token: string, path: string, signal: AbortSignal): Promise<{ content: Buffer, mime: string }> {
    const grant = this.grants.get(token)
    if (!grant || grant.expiresAt <= Date.now())
      throw new NotFoundException('预览已失效，请打开当前最近成功构建')
    if (--grant.remainingRequests < 0)
      throw new HttpException('预览读取过于频繁，请重新打开此构建。', 429)
    let normalized: string
    try {
      normalized = artifactPath(path)
    }
    catch {
      throw new NotFoundException('预览资源不存在')
    }
    const row = await this.artifact(grant)
    const file = parseStoredFiles(row.files, `users/${grant.userId}/conversations/${grant.conversationId}/`).find(file => file.path === normalized)
    if (!file)
      throw new NotFoundException('预览资源不存在')
    // 在读取前预留字节预算，模型页面不能通过重复资源请求制造无界并发/OSS 流量。
    if (file.bytes > grant.remainingBytes)
      throw new HttpException('预览读取预算已用完，请重新打开此构建。', 429)
    grant.remainingBytes -= file.bytes
    const content = await this.read(file, signal)
    signal.throwIfAborted()
    await this.artifact(grant, this.prisma, false) // 删除、停用和过期期间的迟到读取不能交付。
    if (this.grants.get(token) !== grant)
      throw new NotFoundException('预览已失效，请重新打开')
    return { content, mime: artifactMime(normalized) }
  }

  async document(token: string, signal: AbortSignal, path = 'index.html'): Promise<{ content: string, csp: string }> {
    if (typeof path !== 'string' || !path.endsWith('.html'))
      throw new NotFoundException('预览页面不存在')
    const { content } = await this.resource(token, path, signal)
    const grant = this.grants.get(token)
    if (!grant)
      throw new NotFoundException('预览已失效，请重新打开')
    const resourceBase = `${grant.origin}/api/workspace-preview/${token}/files/`
    return { content: previewDocument(content.toString('utf8'), resourceBase, artifactPath(path)), csp: previewCsp(resourceBase) }
  }

  private async artifact(grant: PreviewGrant, db: Prisma.TransactionClient = this.prisma, includeFiles = true) {
    if (grant.expiresAt <= Date.now())
      throw new NotFoundException('预览已失效，请打开当前最近成功构建')
    const row = await db.workspaceArtifact.findFirst({ where: {
      id: grant.artifactId,
      userId: grant.userId,
      conversationId: grant.conversationId,
      conversation: { userId: grant.userId, user: { disabled: false, pendingApproval: false } },
    }, select: { retiredAt: true, previewExpiresAt: true, files: includeFiles } })
    if (!row)
      throw new NotFoundException('构建不存在或会话已删除')
    if (row.retiredAt && (!row.previewExpiresAt || row.previewExpiresAt.getTime() <= Date.now()))
      throw new NotFoundException('旧预览已过期，请打开当前最近成功构建')
    return row
  }

  private async read(file: StoredWorkspaceFile, signal: AbortSignal) {
    try {
      return await this.cloud.readFile(file, signal)
    }
    catch {
      throw new ServiceUnavailableException('构建资源读取失败，请重试此构建。')
    }
  }
}
