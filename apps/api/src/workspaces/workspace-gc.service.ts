import type { OnModuleDestroy, OnModuleInit } from '@nestjs/common'
import type { Prisma } from '../generated/prisma/client.js'
import type { WorkspaceExecution } from './workspace-files.js'
import { randomUUID } from 'node:crypto'
import process from 'node:process'
import { setTimeout as sleep } from 'node:timers/promises'
import { Inject, Injectable, Logger } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service.js'
import { WorkspaceCloudService, WorkspaceDeleteOutcomeUnknownError } from './workspace-cloud.service.js'
import { lockWorkspaceStorage, workspaceDb } from './workspace-db.js'
import { parseStoredFiles, WorkspaceOperationError } from './workspace-files.js'

export interface WorkspaceGcReport {
  conversationId: string
  bucket: string
  prefix: string
  retained: string[]
  candidates: string[]
  deleted: string[]
  failed: string[]
  unknown: string[]
  blocked: string | null
}

@Injectable()
export class WorkspaceGcService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WorkspaceGcService.name)
  private timer?: ReturnType<typeof setInterval>
  private sweep: Promise<void> | undefined
  private stopping = false
  private readonly tasks = new Set<Promise<void>>()

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService, @Inject(WorkspaceCloudService) private readonly cloud: WorkspaceCloudService) {}

  get bucket(): string { return this.cloud.storageBucket ?? process.env.OSS_BUCKET?.trim() ?? '' }
  get enabled(): boolean { return process.env.OSS_WORKSPACE_GC_ENABLED === 'true' }

  onModuleInit() {
    if (!this.enabled)
      return
    void this.resume()
    this.timer = setInterval(() => {
      void this.resume()
    }, 60_000)
    this.timer.unref()
  }

  async onModuleDestroy() {
    this.stopping = true
    clearInterval(this.timer)
    await Promise.all([...this.tasks, ...(this.sweep ? [this.sweep] : [])])
  }

  /** 固定目标不设会话 FK；删除与 tombstone 必须同事务。 */
  async register(db: Prisma.TransactionClient, userId: string, conversationId: string, deletedAt?: Date) {
    const previous = await db.workspaceGcTarget.findUnique({ where: { conversationId } })
    if (previous && (previous.userId !== userId || previous.bucket !== this.bucket || (previous.deletedAt && !deletedAt)))
      throw new WorkspaceOperationError('存储环境或清理目标身份不匹配，需人工核查。')
    await db.workspaceGcTarget.upsert({ where: { conversationId }, create: { conversationId, userId, bucket: this.bucket, ...(deletedAt ? { deletedAt } : {}) }, update: { pending: true, ...(deletedAt ? { deletedAt } : {}) } })
  }

  /** 等明确的删除收尾状态，不用固定延迟当作已完成；未知结局不自动解除。 */
  async waitForDeletion(execution: WorkspaceExecution, signal: AbortSignal): Promise<void> {
    const until = Math.min(execution.deadlineAt, Date.now() + 30_000)
    for (;;) {
      signal.throwIfAborted()
      const target = await workspaceDb(this.prisma, db => db.workspaceGcTarget.findUnique({ where: { conversationId: execution.conversationId } }), signal)
      if (!target?.deletingKey)
        return
      if (target.deleteState === 'unknown' || Date.now() >= until)
        throw new WorkspaceOperationError('对象回收结局尚未确认，存储写入保持保护，请核查后重试。', true)
      await sleep(Math.min(100, until - Date.now()), undefined, { signal })
    }
  }

  async beginUpload(execution: WorkspaceExecution): Promise<string> {
    const id = randomUUID()
    await workspaceDb(this.prisma, async (db) => {
      await lockWorkspaceStorage(db, execution.conversationId)
      const owner = await db.conversationWorkspace.findFirst({ where: { conversationId: execution.conversationId, userId: execution.userId, ownerRunId: execution.runId, leaseExpiresAt: { gt: new Date() }, conversation: { userId: execution.userId } } })
      const run = await db.agentRun.findFirst({ where: { id: execution.runId, conversationId: execution.conversationId, status: 'RUNNING' } })
      if (!owner || !run)
        throw new WorkspaceOperationError('工作区已失去上传所有权。', true)
      await this.register(db, execution.userId, execution.conversationId)
      if ((await db.workspaceGcTarget.findUnique({ where: { conversationId: execution.conversationId } }))?.deletingKey)
        throw new WorkspaceOperationError('对象回收结局未确认，停止上传。', true)
      await db.workspaceUpload.create({ data: { id, conversationId: execution.conversationId, runId: execution.runId, bucket: this.bucket } })
    })
    return id
  }

  async uploading(id: string, key: string): Promise<void> {
    // 必须先确认登记，再启动 PUT；登记响应未知时不启动新的云写入。
    await workspaceDb(this.prisma, db => db.workspaceUpload.update({ where: { id }, data: { keys: { push: key } } }).then(() => {}))
  }

  async finishUpload(id: string, unknown: boolean): Promise<void> {
    // 不使用已取消的工具 signal；实际 PUT 结束后仍要保留可恢复的收尾事实。
    await workspaceDb(this.prisma, db => db.workspaceUpload.update({ where: { id }, data: { state: unknown ? 'unknown' : 'settled', endedAt: new Date() } }).then(() => {}))
  }

  async afterRun(runId: string): Promise<void> {
    if (!this.enabled || this.stopping)
      return
    try {
      const id = await workspaceDb(this.prisma, async (db) => {
        const run = await db.agentRun.findUnique({ where: { id: runId }, select: { status: true, conversationId: true } })
        if (run?.status === 'RUNNING')
          return undefined
        return run?.conversationId ?? (await db.workspaceUpload.findFirst({ where: { runId }, select: { conversationId: true } }))?.conversationId
      })
      if (id)
        this.kick(id)
    }
    catch {
      this.logger.warn({ event: 'workspace_gc_pending', runId })
    }
  }

  kick(conversationId: string): void {
    if (!this.enabled || this.stopping)
      return
    const task = this.collect(conversationId, true)
      .then((report) => {
        if (report.failed.length || report.blocked)
          this.logger.warn({ event: 'workspace_gc_pending', conversationId, failed: report.failed.length, blocked: report.blocked })
      })
      .catch(() => this.logger.warn({ event: 'workspace_gc_pending', conversationId }))
      .finally(() => this.tasks.delete(task))
    this.tasks.add(task)
  }

  /** 默认只读。每个对象删除都在 DB 互斥内重新判定，不能用旧 dry-run 清单直接删除。 */
  async collect(conversationId: string, apply = false): Promise<WorkspaceGcReport> {
    const { target, workspace } = await workspaceDb(this.prisma, async db => ({
      target: await db.workspaceGcTarget.findUnique({ where: { conversationId } }),
      workspace: await db.conversationWorkspace.findUnique({ where: { conversationId } }),
    }))
    const userId = target?.userId ?? workspace?.userId
    if (!userId || !/^[\w-]+$/.test(userId) || !/^[\w-]+$/.test(conversationId))
      throw new WorkspaceOperationError('清理目标无法关联，未删除对象。')
    const prefix = `users/${userId}/conversations/${conversationId}/`
    const report: WorkspaceGcReport = { conversationId, bucket: this.bucket, prefix, retained: [], candidates: [], deleted: [], failed: [], unknown: [], blocked: null }
    if (!this.bucket || (target && target.bucket !== this.bucket)) {
      report.blocked = 'Bucket 身份不匹配或未配置'
      return report
    }
    // 不写入登记的 dry-run 可用于已有业务对账；apply 先建立可靠重试目标。
    if (apply && !target) {
      await workspaceDb(this.prisma, async (db) => {
        await lockWorkspaceStorage(db, conversationId)
        const own = await db.conversation.findFirst({ where: { id: conversationId, userId } })
        if (!own)
          throw new WorkspaceOperationError('会话不存在，且没有已确认删除目标。')
        await this.register(db, userId, conversationId)
      })
    }
    report.blocked = await workspaceDb(this.prisma, async (db) => {
      await lockWorkspaceStorage(db, conversationId)
      return (await this.references(db, userId, conversationId, prefix)).blocked
    })
    let marker: string | undefined
    do {
      const page = await this.cloud.listFiles(prefix, marker)
      for (const key of page.keys) {
        if (!key.startsWith(prefix))
          throw new WorkspaceOperationError('列举越过核定范围，停止回收。')
        const deleteId = randomUUID()
        try {
          // ponytail: 每个对象一次引用复核，清单有界；实际 GC 吞吐不足再按锁定批次优化。
          const verdict = await workspaceDb(this.prisma, async (db) => {
            await lockWorkspaceStorage(db, conversationId)
            const state = await this.references(db, userId, conversationId, prefix)
            if (state.blocked)
              return { kind: 'blocked' as const, reason: state.blocked }
            if (state.keys.has(key))
              return { kind: 'retained' as const }
            if (!state.deleted && !/^objects\/[a-f0-9]{64}$/.test(key.slice(prefix.length)))
              return { kind: 'unknown' as const }
            if (apply)
              await db.workspaceGcTarget.update({ where: { conversationId }, data: { deletingKey: key, deleteId, deleteState: 'active', pending: true } })
            return { kind: 'candidate' as const }
          })
          if (verdict.kind === 'blocked') {
            report.blocked = verdict.reason
            report.unknown.push(key)
          }
          else if (verdict.kind === 'retained') {
            report.retained.push(key)
          }
          else if (verdict.kind === 'unknown') {
            report.unknown.push(key)
          }
          else {
            report.candidates.push(key)
            if (apply) {
              // 外部删除可能晚于 DB 事务/SDK 超时；持久屏障阻止新 owner 和同 SHA 再发布。
              try {
                await this.cloud.deleteFile(key)
              }
              catch (error) {
                const unknown = error instanceof WorkspaceDeleteOutcomeUnknownError || !(error instanceof WorkspaceOperationError)
                await this.finishDelete(conversationId, key, deleteId, unknown)
                throw error
              }
              await this.finishDelete(conversationId, key, deleteId, false)
              report.deleted.push(key)
            }
          }
        }
        catch {
          // SDK 异常不输出；事务/删除响应未知均由下一次同判定重新对账，删除幂等。
          report.failed.push(key)
        }
      }
      marker = page.nextMarker
    } while (marker)
    if (apply) {
      await workspaceDb(this.prisma, async (db) => {
        await lockWorkspaceStorage(db, conversationId)
        const state = await this.references(db, userId, conversationId, prefix)
        if (!state.blocked) {
          const now = new Date()
          await db.workspaceArtifact.deleteMany({ where: { conversationId, userId, id: { not: state.artifactId ?? '' }, retiredAt: { not: null }, OR: [{ previewExpiresAt: null }, { previewExpiresAt: { lte: now } }] } })
          await db.workspaceUpload.deleteMany({ where: { conversationId, state: 'settled' } })
        }
        await db.workspaceGcTarget.update({ where: { conversationId }, data: { pending: !!state.blocked || state.protectedOld || report.failed.length > 0 || report.unknown.length > 0 } })
      })
    }
    return report
  }

  private async finishDelete(conversationId: string, key: string, deleteId: string, unknown: boolean): Promise<void> {
    await workspaceDb(this.prisma, async (db) => {
      await lockWorkspaceStorage(db, conversationId)
      await db.workspaceGcTarget.updateMany({ where: { conversationId, deletingKey: key, deleteId }, data: unknown ? { deleteState: 'unknown', pending: true } : { deletingKey: null, deleteId: null, deleteState: null, pending: true } })
    })
  }

  private async references(db: Prisma.TransactionClient, userId: string, conversationId: string, prefix: string) {
    const target = await db.workspaceGcTarget.findUnique({ where: { conversationId } })
    const conversation = await db.conversation.findFirst({ where: { id: conversationId, userId } })
    const workspace = await db.conversationWorkspace.findUnique({ where: { conversationId } })
    let blocked: string | null = target?.deletingKey ? '存在活动/未知删除，保持写入屏障' : null
    if (target && (target.userId !== userId || target.bucket !== this.bucket))
      blocked = '目标身份不匹配'
    if ((!conversation && !target?.deletedAt) || (conversation && target?.deletedAt))
      blocked = '会话删除结果未确认或目标不一致'
    const uploads = await db.workspaceUpload.count({ where: { conversationId, state: { not: 'settled' } } })
    if (uploads)
      blocked = '存在活动/未知上传，需核查真实请求结局'
    if (workspace?.ownerRunId) {
      const run = await db.agentRun.findUnique({ where: { id: workspace.ownerRunId }, select: { status: true } })
      if (!run || run.status === 'RUNNING')
        blocked = '运行/提交结局未确认（不以租约过期当作无活动）'
      // 已终态的旧 owner 不会再被允许登记新上传；实际在途 PUT 已由 uploads 保护。
    }
    const keys = new Set<string>()
    if (workspace) {
      for (const file of parseStoredFiles(workspace.files, prefix))
        keys.add(file.key)
    }
    let protectedOld = false
    const artifacts = await db.workspaceArtifact.findMany({ where: { conversationId, userId } })
    for (const artifact of artifacts) {
      const current = artifact.id === workspace?.artifactId
      const protectedPreview = !!artifact.previewExpiresAt && artifact.previewExpiresAt.getTime() > Date.now()
      if (!current && !artifact.retiredAt)
        blocked = '非当前 Artifact 尚未确认退役'
      if (current || protectedPreview) {
        for (const file of parseStoredFiles(artifact.files, prefix))
          keys.add(file.key)
        protectedOld ||= !current && protectedPreview
      }
    }
    return { keys, blocked, protectedOld, deleted: !!target?.deletedAt, artifactId: workspace?.artifactId }
  }

  private resume(): Promise<void> {
    if (this.sweep)
      return this.sweep
    this.sweep = (async () => {
      let cursor: string | undefined
      for (;;) {
        const targets = await workspaceDb(this.prisma, db => db.workspaceGcTarget.findMany({ where: { pending: true, bucket: this.bucket }, orderBy: { conversationId: 'asc' }, take: 50, ...(cursor ? { cursor: { conversationId: cursor }, skip: 1 } : {}) }))
        for (const target of targets)
          await this.collect(target.conversationId, true).catch(() => this.logger.warn({ event: 'workspace_gc_pending', conversationId: target.conversationId }))
        if (targets.length < 50)
          break
        cursor = targets.at(-1)!.conversationId
      }
    })().catch(() => this.logger.warn({ event: 'workspace_gc_reconcile_failed' })).finally(() => { this.sweep = undefined })
    return this.sweep
  }
}
