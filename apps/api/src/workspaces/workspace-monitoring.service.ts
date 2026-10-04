import type { WorkspaceMonitorItem } from '@agent/contracts'
import type { WorkspaceExecution } from './workspace-files.js'
import { randomUUID } from 'node:crypto'
import { Inject, Injectable, NotFoundException } from '@nestjs/common'
import { Prisma } from '../generated/prisma/client.js'
import { PrismaService } from '../prisma/prisma.service.js'
import { WorkspaceCloudService } from './workspace-cloud.service.js'
import { workspaceDb } from './workspace-db.js'
import { parseStoredFiles, WorkspaceOperationError } from './workspace-files.js'

@Injectable()
export class WorkspaceMonitoringService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(WorkspaceCloudService) private readonly cloud: WorkspaceCloudService,
  ) {}

  begin(execution: WorkspaceExecution, title: string, id: string = randomUUID()) {
    return workspaceDb(this.prisma, db => db.sandboxExecution.create({ data: {
      id,
      userId: execution.userId,
      conversationId: execution.conversationId,
      runId: execution.runId,
      title: title.slice(0, 240),
      ...this.cloud.sandboxConfiguration,
      expiresAt: new Date(execution.deadlineAt + 60_000),
    } }))
  }

  async created(id: string, sandboxId: string, startedAt: Date) {
    const result = await workspaceDb(this.prisma, db => db.sandboxExecution.updateMany({ where: { id, state: 'creating', releasedAt: null }, data: { sandboxId, startedAt, state: 'running' } }))
    if (result.count !== 1)
      throw new WorkspaceOperationError('沙箱创建记录无法确认，停止执行并释放实例。', true)
  }

  async released(id: string, sandboxId: string, startedAt: Date, confirmed: boolean) {
    const releasedAt = new Date()
    await workspaceDb(this.prisma, async (db) => {
      const row = await db.sandboxExecution.findUniqueOrThrow({ where: { id } })
      const start = row.startedAt ?? startedAt
      const duration = releasedAt.getTime() - start.getTime()
      await db.sandboxExecution.updateMany({ where: { id, releasedAt: null }, data: {
        sandboxId,
        startedAt: start,
        state: confirmed ? 'released' : 'not_listed',
        checkedAt: releasedAt,
        // kill() 返回 false 只说明实例已不存在，不能编造它的实际结束时间。
        ...(confirmed ? { releasedAt, durationMs: duration >= 0 ? BigInt(duration) : null } : {}),
      } })
    })
  }

  unknown(id: string, state: 'creation_unknown' | 'cleanup_pending' | 'create_failed') {
    return workspaceDb(this.prisma, db => db.sandboxExecution.updateMany({ where: { id, releasedAt: null }, data: { state } }))
  }

  async monitor(page = 1, pageSize = 20) {
    const today = new Date(`${new Date(Date.now() + 8 * 3_600_000).toISOString().slice(0, 10)}T00:00:00+08:00`)
    return workspaceDb(this.prisma, async (db) => {
      const items = await this.workspaceRows(db, page, pageSize)
      const [count] = await db.$queryRaw<Array<{ total: number }>>(Prisma.sql`
        SELECT count(*)::int AS total FROM (
          SELECT "conversationId" FROM "ConversationWorkspace"
          UNION SELECT "conversationId" FROM "SandboxExecution"
        ) workspaces
      `)
      const [summary] = await db.$queryRaw<Array<{ attempts: number, created: number, released: number, unconfirmed: number, todayAttempts: number, confirmedDurationMs: bigint }>>(Prisma.sql`
        SELECT count(*)::int AS "attempts", count("startedAt")::int AS "created", count("releasedAt")::int AS "released",
          count(*) FILTER (WHERE "releasedAt" IS NULL AND "state" != 'create_failed')::int AS "unconfirmed",
          count(*) FILTER (WHERE "requestedAt" >= ${today})::int AS "todayAttempts",
          coalesce(sum("durationMs"), 0)::bigint AS "confirmedDurationMs"
        FROM "SandboxExecution"
      `)
      return { configured: this.cloud.configured, items, pagination: { page, pageSize, total: count!.total }, summary: { ...summary!, confirmedDurationMs: Number(summary!.confirmedDurationMs) } }
    })
  }

  async history(conversationId: string, page = 1, pageSize = 20) {
    return workspaceDb(this.prisma, async (db) => {
      const [workspace] = await this.workspaceRows(db, 1, 1, conversationId)
      if (!workspace)
        throw new NotFoundException('工作区不存在')
      const records = await db.sandboxExecution.findMany({ where: { conversationId }, orderBy: [{ requestedAt: 'desc' }, { id: 'desc' }], skip: (page - 1) * pageSize, take: pageSize })
      const total = await db.sandboxExecution.count({ where: { conversationId } })
      const runs = await db.agentRun.findMany({ where: { conversationId, id: { in: records.map(row => row.runId) } }, select: { id: true } })
      const availableRuns = new Set(runs.map(run => run.id))
      const items = records.map(row => ({ id: row.id, userId: row.userId, user: row.userId === workspace.userId ? workspace.user : null, conversationId: row.conversationId, runId: row.runId, runAvailable: availableRuns.has(row.runId), title: row.title, sandboxId: row.sandboxId, template: row.template, apiHost: row.apiHost, state: observedState(row.state, row.expiresAt), requestedAt: row.requestedAt.toISOString(), startedAt: row.startedAt?.toISOString() ?? null, releasedAt: row.releasedAt?.toISOString() ?? null, expiresAt: row.expiresAt?.toISOString() ?? null, durationMs: row.durationMs === null ? null : Number(row.durationMs), checkedAt: row.checkedAt?.toISOString() ?? null }))
      return { workspace, items, pagination: { page, pageSize, total } }
    })
  }

  async overview(page = 1, pageSize = 20) {
    const [records, sandbox, oss] = await Promise.all([this.monitor(page, pageSize), this.cloud.inspectSandboxes(), this.cloud.inspectStorage()])
    return { ...records, cloud: { sandbox, oss } }
  }

  async refresh(page = 1, pageSize = 20) {
    const [{ sandbox }, oss] = await Promise.all([this.reconcile(true), this.cloud.inspectStorage()])
    const records = await this.monitor(page, pageSize)
    return { ...records, cloud: { sandbox, oss } }
  }

  /** 同一会话一行；没有文件工作区但仍有运行历史的会话也保留入口。 */
  private async workspaceRows(db: Prisma.TransactionClient, page: number, pageSize: number, conversationId?: string): Promise<WorkspaceMonitorItem[]> {
    const historyFilter = conversationId ? Prisma.sql`WHERE "conversationId" = ${conversationId}` : Prisma.empty
    const filter = conversationId ? Prisma.sql`WHERE coalesce(w."conversationId", h."conversationId") = ${conversationId}` : Prisma.empty
    type Row = Omit<WorkspaceMonitorItem, 'fileCount' | 'fileBytes' | 'updatedAt' | 'leaseExpiresAt' | 'latestRunAt' | 'confirmedDurationMs'> & { files: unknown, observedExpiresAt: Date | null, updatedAt: Date, leaseExpiresAt: Date | null, latestRunAt: Date | null, confirmedDurationMs: bigint | null }
    const rows = await db.$queryRaw<Row[]>(Prisma.sql`
      WITH h AS (
        SELECT "conversationId", count(*)::int AS "sandboxCount", coalesce(sum("durationMs"), 0)::bigint AS "confirmedDurationMs", max("updatedAt") AS "updatedAt"
        FROM "SandboxExecution" ${historyFilter} GROUP BY "conversationId"
      ), latest AS (
        SELECT DISTINCT ON ("conversationId") "conversationId", "userId", title, state, "sandboxId", "requestedAt", "expiresAt"
        FROM "SandboxExecution" ${historyFilter} ORDER BY "conversationId", "requestedAt" DESC, id DESC
      )
      SELECT coalesce(w."conversationId", h."conversationId") AS "conversationId",
        coalesce(c.title, latest.title) AS title, coalesce(w."userId", latest."userId") AS "userId",
        CASE WHEN u.id IS NULL THEN NULL ELSE jsonb_build_object('name', u.name, 'email', u.email, 'avatarUrl', u."avatarUrl") END AS "user",
        c.id IS NULL AS deleted, coalesce(latest.state, w.state, 'idle') AS state,
        w.revision, coalesce(latest."sandboxId", w."sandboxId") AS "sandboxId", w."leaseExpiresAt", coalesce(latest."expiresAt", w."leaseExpiresAt") AS "observedExpiresAt", w."lastError", w."lastOperation", w.files,
        greatest(w."updatedAt", h."updatedAt") AS "updatedAt", coalesce(h."sandboxCount", 0)::int AS "sandboxCount",
        latest."requestedAt" AS "latestRunAt", h."confirmedDurationMs"
      FROM "ConversationWorkspace" w FULL JOIN h ON h."conversationId" = w."conversationId"
      LEFT JOIN latest ON latest."conversationId" = coalesce(w."conversationId", h."conversationId")
      LEFT JOIN "Conversation" c ON c.id = coalesce(w."conversationId", h."conversationId")
      LEFT JOIN "User" u ON u.id = coalesce(w."userId", latest."userId")
      ${filter}
      ORDER BY greatest(w."updatedAt", h."updatedAt") DESC, coalesce(w."conversationId", h."conversationId") DESC
      LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}
    `)
    return rows.map(({ files, observedExpiresAt, ...row }) => {
      const entries = files === null ? null : parseStoredFiles(files, `users/${row.userId}/conversations/${row.conversationId}/`)
      return { ...row, state: observedState(row.state, observedExpiresAt), updatedAt: row.updatedAt.toISOString(), leaseExpiresAt: row.leaseExpiresAt?.toISOString() ?? null, latestRunAt: row.latestRunAt?.toISOString() ?? null, confirmedDurationMs: row.confirmedDurationMs === null ? null : Number(row.confirmedDurationMs), fileCount: entries?.length ?? null, fileBytes: entries?.reduce((sum, file) => sum + file.bytes, 0) ?? null }
    })
  }

  /** 管理员主动核查只读取云端，不连接、唤醒或删除实例，也不推断销毁时间。 */
  async reconcile(force = false) {
    const sandbox = await this.cloud.inspectSandboxes(force)
    if (sandbox.error || !sandbox.checkedAt || !sandbox.instances)
      return { updated: 0, sandbox }
    const checkedAt = new Date(sandbox.checkedAt)
    const { apiHost } = this.cloud.sandboxConfiguration
    const byExecution = new Map(sandbox.instances.filter(instance => instance.executionId).map(instance => [instance.executionId, instance]))
    const bySandbox = new Map(sandbox.instances.map(instance => [instance.sandboxId, instance]))
    const updated = await workspaceDb(this.prisma, async (db) => {
      const rows = await db.sandboxExecution.findMany({ where: { apiHost, releasedAt: null, state: { not: 'create_failed' }, updatedAt: { lte: checkedAt } } })
      const updates = []
      for (const row of rows) {
        // 创建请求仍在预算内时，观察者不能抢先改状态导致创建确认失败。
        if (row.state === 'creating' && row.expiresAt && row.expiresAt > checkedAt)
          continue
        if (row.checkedAt && row.checkedAt >= checkedAt)
          continue
        const instance = byExecution.get(row.id) ?? (row.sandboxId ? bySandbox.get(row.sandboxId) : undefined)
        if (!instance && row.state === 'creating' && checkedAt.getTime() - row.requestedAt.getTime() < 60_000)
          continue
        updates.push({ id: row.id, previousState: row.state, updatedAt: row.updatedAt, sandboxId: instance?.sandboxId ?? row.sandboxId, startedAt: row.startedAt ?? instance?.startedAt ?? null, expiresAt: instance?.expiresAt ?? row.expiresAt, state: instance ? (row.state === 'cleanup_pending' ? 'cleanup_pending' : instance.state) : (row.sandboxId ? 'not_listed' : 'creation_unknown') })
      }
      if (!updates.length)
        return 0
      // 一次批量核对，避免未确认历史越积越多后 N 次往返耗尽事务预算；逐行保留 CAS。
      return db.$executeRaw(Prisma.sql`
        UPDATE "SandboxExecution" s SET
          "sandboxId" = v."sandboxId", "startedAt" = v."startedAt", "expiresAt" = v."expiresAt",
          state = v.state, "checkedAt" = ${checkedAt}, "updatedAt" = clock_timestamp()
        FROM jsonb_to_recordset(${JSON.stringify(updates)}::jsonb) AS v(
          id text, "previousState" text, "updatedAt" timestamp(3), "sandboxId" text,
          "startedAt" timestamp(3), "expiresAt" timestamp(3), state text
        )
        WHERE s.id = v.id AND s."releasedAt" IS NULL AND s.state = v."previousState" AND s."updatedAt" = v."updatedAt"
      `)
    })
    return { updated, sandbox }
  }
}

/** 到期只表示当前状态需核查，不能推断云端已经释放。 */
function observedState(state: string, expiresAt: Date | null): string {
  return ['creating', 'running', 'restoring', 'saving'].includes(state) && expiresAt && expiresAt.getTime() <= Date.now() ? 'cleanup_pending' : state
}
