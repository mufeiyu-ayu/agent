import type { WorkspaceSnapshot } from '@agent/contracts'
import type { OnModuleDestroy } from '@nestjs/common'
import type { Sandbox } from 'e2b'
import type { Prisma } from '../generated/prisma/client.js'
import type { StoredWorkspaceFile, WorkspaceCommit, WorkspaceExecution } from './workspace-files.js'
import { Buffer } from 'node:buffer'
import { randomUUID } from 'node:crypto'
import { setTimeout as sleep } from 'node:timers/promises'
import { BadRequestException, ConflictException, Inject, Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service.js'
import { BASH_SCRIPT, FILE_SCRIPT } from './sandbox-scripts.js'
import { sourceZip } from './workspace-archive.js'
import { WorkspaceCloudService, WorkspaceCreatedError, WorkspaceCreationRejectedError, WorkspaceUploadOutcomeUnknownError } from './workspace-cloud.service.js'
import { lockWorkspaceStorage, workspaceDb } from './workspace-db.js'
import { artifactPath, fileHash, MAX_FILE_BYTES, MAX_WORKSPACE_BYTES, MAX_WORKSPACE_FILES, parseStoredFiles, privateWorkspacePath, storedWorkspacePath, WorkspaceOperationError, workspacePath } from './workspace-files.js'
import { WorkspaceGcService } from './workspace-gc.service.js'
import { WorkspaceMonitoringService } from './workspace-monitoring.service.js'
import { validateArtifact } from './workspace-preview.js'

interface CollectedFile { path: string, sha256: string, bytes: number, content?: Buffer }

interface RunningWorkspace {
  sandbox: Sandbox
  execution: WorkspaceExecution
  historyId: string
  startedAt: Date
  build?: { id: string, command: string, createdAt: string, sourceHashes: Map<string, string> } | undefined
}

@Injectable()
export class WorkspaceService implements OnModuleDestroy {
  private readonly logger = new Logger(WorkspaceService.name)
  private readonly running = new Map<string, Promise<RunningWorkspace>>()
  private readonly releasing = new Map<string, Promise<void>>()

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(WorkspaceCloudService) readonly cloud: WorkspaceCloudService,
    @Inject(WorkspaceMonitoringService) private readonly monitoring: WorkspaceMonitoringService,
    @Inject(WorkspaceGcService) private readonly gc = new WorkspaceGcService(prisma, cloud),
  ) {}

  async snapshot(userId: string, conversationId: string): Promise<WorkspaceSnapshot> {
    await this.assertOwner(userId, conversationId)
    const row = await this.prisma.conversationWorkspace.findUnique({ where: { conversationId } })
    const files = row ? parseStoredFiles(row.files, this.prefix(userId, conversationId)) : []
    const expired = row?.ownerRunId && row.leaseExpiresAt && row.leaseExpiresAt.getTime() <= Date.now()
    const artifact = row?.artifactId ? await this.prisma.workspaceArtifact.findFirst({ where: { id: row.artifactId, userId, conversationId } }) : null
    return {
      configured: this.cloud.configured,
      conversationId,
      revision: row?.revision ?? 0,
      webProject: row?.webProject ?? false,
      artifact: artifact ? { id: artifact.id, sourceRevision: artifact.sourceRevision, runId: artifact.runId, command: artifact.command, files: parseStoredFiles(artifact.files, this.prefix(userId, conversationId)).map(({ path, bytes, sha256 }) => ({ path, bytes, sha256 })), createdAt: artifact.createdAt.toISOString() } : null,
      state: expired ? 'cleanup_pending' : row?.state ?? 'idle',
      files: files.map(({ path, bytes, sha256 }) => ({ path, bytes, sha256 })),
      lastOperation: row?.lastOperation ?? null,
      lastError: row?.lastError ?? (expired ? '执行租约已过期，沙箱释放状态待核查；已保存文件仍可读取。' : null),
      updatedAt: row?.updatedAt.toISOString() ?? null,
    }
  }

  async savedFile(userId: string, conversationId: string, path: string, revision?: number, signal = AbortSignal.timeout(30_000)): Promise<Buffer> {
    await this.assertOwner(userId, conversationId)
    const row = await this.prisma.conversationWorkspace.findUnique({ where: { conversationId } })
    if (revision !== undefined && row?.revision !== revision)
      throw new ConflictException('文件版本已更新，请刷新文件列表')
    let normalized: string
    try {
      normalized = storedWorkspacePath(path)
    }
    catch (error) {
      if (error instanceof WorkspaceOperationError)
        throw new BadRequestException(error.message)
      throw error
    }
    const file = parseStoredFiles(row?.files ?? [], this.prefix(userId, conversationId)).find(item => item.path === normalized)
    if (!file)
      throw new NotFoundException('文件不存在')
    let content: Buffer
    try {
      content = await this.cloud.readFile(file, signal)
    }
    catch {
      // OSS SDK 异常可能含请求与认证信息，不能进入全局异常过滤器的 stack 日志。
      this.logger.warn({ event: 'workspace_download_failed', conversationId })
      throw new ServiceUnavailableException('工作文件暂时无法读取，请稍后重试。')
    }
    signal.throwIfAborted()
    await this.assertOwner(userId, conversationId)
    if (revision !== undefined && (await this.prisma.conversationWorkspace.findUnique({ where: { conversationId }, select: { revision: true } }))?.revision !== revision)
      throw new ConflictException('文件版本已更新，请刷新文件列表')
    return content
  }

  async archive(userId: string, conversationId: string, revision: number, signal: AbortSignal): Promise<Buffer> {
    await this.assertOwner(userId, conversationId)
    const row = await this.prisma.conversationWorkspace.findUnique({ where: { conversationId } })
    if (!row || row.revision !== revision)
      throw new ConflictException('源码版本已更新，请重新选择下载版本')
    const files = parseStoredFiles(row.files, this.prefix(userId, conversationId)).filter(file => !privateWorkspacePath(file.path))
    let contents: Array<{ path: string, content: Buffer }>
    try {
      contents = await this.readSourceFiles(files, signal)
    }
    catch {
      throw new ServiceUnavailableException('源码归档读取失败，请重试同一版本。')
    }
    signal.throwIfAborted()
    await this.assertOwner(userId, conversationId)
    const current = await this.prisma.conversationWorkspace.findUnique({ where: { conversationId }, select: { revision: true } })
    if (current?.revision !== revision)
      throw new ConflictException('源码版本已更新，此次下载未交付')
    return sourceZip(contents)
  }

  async fileOperation(execution: WorkspaceExecution, request: Record<string, unknown>, signal: AbortSignal): Promise<unknown> {
    const active = await this.ensure(execution, signal)
    const { sandbox } = active
    active.build = undefined
    await this.operation(execution, String(request.action))
    const stop = () => {
      void this.releaseRun(execution.runId, '操作已停止')
    }
    signal.addEventListener('abort', stop, { once: true })
    try {
      signal.throwIfAborted()
      return await this.cloud.request(sandbox, FILE_SCRIPT, request, signal)
    }
    finally {
      signal.removeEventListener('abort', stop)
    }
  }

  async bash(execution: WorkspaceExecution, command: string, timeout: number, signal: AbortSignal, build = false): Promise<{ stdout: string, stderr: string, exitCode: number, truncated: boolean, timedOut: boolean }> {
    const active = await this.ensure(execution, signal)
    const { sandbox } = active
    active.build = undefined
    const row = await this.operation(execution, 'bash')
    const stop = () => {
      void this.releaseRun(execution.runId, '命令已停止')
    }
    signal.addEventListener('abort', stop, { once: true })
    try {
      signal.throwIfAborted()
      let sourceHashes: Map<string, string> | undefined
      if (build) {
        if (command !== 'pnpm build')
          throw new WorkspaceOperationError('成功 Artifact 只由 pnpm build 构建；其他命令仍可正常检查源码。')
        const preserved = parseStoredFiles(row.files, this.prefix(execution.userId, execution.conversationId)).filter(file => !privateWorkspacePath(file.path)).map(file => file.path)
        if (preserved.some(path => path.startsWith('dist/')))
          throw new WorkspaceOperationError('旧已确认文件位于 dist，未清理或覆盖；请先明确移动旧文件后再构建。')
        sourceHashes = new Map((await this.collectFiles(sandbox, signal, false, preserved)).map(file => [file.path, file.sha256]))
        await this.cloud.request(sandbox, FILE_SCRIPT, { action: 'clear-dist' }, signal)
      }
      const createdAt = new Date().toISOString()
      const result = await this.cloud.request(sandbox, BASH_SCRIPT, { command, timeout }, signal, timeout * 1000 + 5_000)
      if (!result || typeof result !== 'object' || !('stdout' in result) || typeof result.stdout !== 'string'
        || !('stderr' in result) || typeof result.stderr !== 'string' || !('exitCode' in result) || !Number.isInteger(result.exitCode)
        || !('timedOut' in result) || typeof result.timedOut !== 'boolean' || !('truncated' in result) || typeof result.truncated !== 'boolean') {
        throw new WorkspaceOperationError('沙箱没有返回有效的执行结果。')
      }
      if (build && sourceHashes && result.exitCode === 0 && !result.timedOut)
        active.build = { id: randomUUID(), command, createdAt, sourceHashes }
      if (result.timedOut)
        await this.releaseRun(execution.runId, '命令执行超时，保留上次已保存版本')
      return result as { stdout: string, stderr: string, exitCode: number, truncated: boolean, timedOut: boolean }
    }
    finally {
      signal.removeEventListener('abort', stop)
    }
  }

  /** 这里只准备不可变对象；当前文件版本与工具结果在 recorder 的同一事务里确认。 */
  async prepareCommit(execution: WorkspaceExecution, signal: AbortSignal): Promise<WorkspaceCommit | undefined> {
    const active = await this.ensure(execution, signal)
    const row = await this.operation(execution, 'saving')
    const prefix = this.prefix(execution.userId, execution.conversationId)
    const previous = parseStoredFiles(row.files, prefix)
    const uploadId = await this.gc.beginUpload(execution)
    let unknownUpload = false
    try {
      const artifactId = row.artifactId
      const confirmedArtifact = artifactId ? await this.withDb(db => db.workspaceArtifact.findFirst({ where: { id: artifactId, userId: execution.userId, conversationId: execution.conversationId } }), signal) : null
      // 当前 Source/Artifact 受 owner + 持久上传登记保护；GC 与取得 owner 共用互斥。
      // 不复用任意历史 hash，也不依赖一次存在性检查避免检查后被删的竞态。
      const existingHashes = new Map([...previous, ...parseStoredFiles(confirmedArtifact?.files ?? [], prefix)].map(file => [file.sha256, file.bytes]))
      const upload = async (contents: CollectedFile[]) => {
        const files: StoredWorkspaceFile[] = []
        const uploads = new Map<string, Promise<void>>()
        let next = 0
        let failed = false
        let failure: unknown
        // 每路自行收集失败，所有已启动 PUT 的真实结局都返回后才允许 finishUpload。
        await Promise.all(Array.from({ length: Math.min(4, contents.length) }, async () => {
          while (!failed && next < contents.length) {
            const index = next++
            const { path, content, sha256, bytes } = contents[index]!
            const file = { path, bytes, sha256, key: `${prefix}objects/${sha256}` }
            try {
              signal.throwIfAborted()
              if (!existingHashes.has(sha256)) {
                let pending = uploads.get(sha256)
                if (!pending) {
                  if (!content)
                    throw new WorkspaceOperationError('待上传文件缺少内容。')
                  pending = (async () => {
                    await this.gc.uploading(uploadId, file.key)
                    signal.throwIfAborted()
                    if (failed)
                      return
                    await this.cloud.putFile(file, content, signal)
                    existingHashes.set(sha256, bytes)
                  })()
                  uploads.set(sha256, pending)
                }
                await pending
              }
              signal.throwIfAborted()
              files[index] = file
            }
            catch (error) {
              unknownUpload ||= error instanceof WorkspaceUploadOutcomeUnknownError
              if (!failed)
                failure = error
              failed = true
            }
          }
        }))
        if (failed)
          throw failure
        return parseStoredFiles(files, prefix)
      }
      const files = await upload(await this.collectFiles(active.sandbox, signal, false, previous.filter(file => !privateWorkspacePath(file.path)).map(file => file.path), existingHashes))
      const hashes = new Map(previous.map(file => [file.path, file.sha256]))
      const sourceChanged = previous.length !== files.length || files.some(file => hashes.get(file.path) !== file.sha256)
      const build = active.build
      active.build = undefined
      let artifact: WorkspaceCommit['artifact']
      if (build) {
        if (build.sourceHashes.size !== files.length || files.some(file => build.sourceHashes.get(file.path) !== file.sha256))
          throw new WorkspaceOperationError('构建期间源码发生变化，未发布 Artifact；请重新检查构建。')
        const contents = await this.collectFiles(active.sandbox, signal, true)
        validateArtifact(contents.map(file => ({ path: file.path, content: file.content! })))
        artifact = { id: build.id, userId: execution.userId, sourceRevision: row.revision + Number(sourceChanged), command: build.command, createdAt: build.createdAt, files: await upload(contents) }
      }
      const webProject = (row.webProject ?? false) || !!artifact || (files.some(file => file.path === 'pnpm-lock.yaml') && files.some(file => /^vite\.config\.[cm]?[jt]s$/.test(file.path)))
      if (!sourceChanged && !artifact && webProject === (row.webProject ?? false)) {
        await this.operation(execution, 'running')
        return undefined
      }
      signal.throwIfAborted()
      return { conversationId: execution.conversationId, runId: execution.runId, expectedRevision: row.revision, expectedArtifactId: row.artifactId, files, sourceChanged, webProject, ...(artifact ? { artifact } : {}) }
    }
    finally {
      // 登记失败保持 active（不丢待核查目标），不能覆盖原保存/取消结果。
      await this.gc.finishUpload(uploadId, unknownUpload).catch(() => this.logger.warn({ event: 'workspace_upload_pending', uploadId }))
      await this.gc.afterRun(execution.runId)
    }
  }

  releaseRun(runId: string, error?: string): Promise<void> {
    const releasing = this.releasing.get(runId)
    if (releasing)
      return releasing
    const pending = this.running.get(runId)
    if (!pending)
      return this.gc.afterRun(runId)
    // 收尾期间保留实例槽位；超时后的下一次工具调用必须等旧实例收尾，不能被迟到的清理清掉新租约。
    const cleanup = this.release(pending, runId, error).finally(() => {
      if (this.running.get(runId) === pending)
        this.running.delete(runId)
      this.releasing.delete(runId)
    })
    this.releasing.set(runId, cleanup)
    return cleanup
  }

  private async release(pending: Promise<RunningWorkspace>, runId: string, error?: string): Promise<void> {
    let active: RunningWorkspace | undefined
    try {
      active = await pending
      const confirmed = await active.sandbox.kill({ requestTimeoutMs: 15_000 })
      await this.monitoring.released(active.historyId, active.sandbox.sandboxId, active.startedAt, confirmed)
      const execution = active.execution
      await this.withDb(db => db.conversationWorkspace.updateMany({
        where: { conversationId: execution.conversationId, ownerRunId: runId },
        data: { ownerRunId: null, leaseExpiresAt: null, sandboxId: null, state: error ? 'error' : 'idle', lastError: error ?? null },
      }))
    }
    catch {
      // open 已负责创建失败的补偿；不能再次把它的确定失败改成释放未知。
      if (!active)
        return
      await this.monitoring.unknown(active.historyId, 'cleanup_pending').catch(() => {})
      this.logger.warn({ event: 'workspace_cleanup_pending', runId })
      await this.withDb(db => db.conversationWorkspace.updateMany({
        where: { ownerRunId: runId },
        data: { state: 'cleanup_pending', lastError: error ?? '沙箱释放未确认，云端到期时间兜底' },
      })).catch(() => {})
    }
    finally {
      if (active)
        await this.gc.afterRun(runId)
    }
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.allSettled([...this.running.keys()].map(runId => this.releaseRun(runId)).concat([...this.releasing.values()]))
  }

  async reportError(execution: WorkspaceExecution, message: string): Promise<void> {
    await this.withDb(db => db.conversationWorkspace.updateMany({
      where: { conversationId: execution.conversationId, ownerRunId: execution.runId, state: { notIn: ['creation_unknown', 'cleanup_pending', 'creating'] } },
      data: { state: 'running', lastError: message.slice(0, 400) },
    })).catch(() => this.logger.warn({ event: 'workspace_error_record_failed', runId: execution.runId }))
  }

  private async ensure(execution: WorkspaceExecution, signal: AbortSignal): Promise<RunningWorkspace> {
    signal.throwIfAborted()
    await this.waitForRelease(execution.runId, execution, signal)
    signal.throwIfAborted()
    let pending = this.running.get(execution.runId)
    if (!pending) {
      pending = this.open(execution, signal)
      this.running.set(execution.runId, pending)
    }
    let active: RunningWorkspace
    try {
      active = await pending
    }
    catch (error) {
      if (this.running.get(execution.runId) === pending)
        this.running.delete(execution.runId)
      throw error
    }
    signal.throwIfAborted()
    if (this.running.get(execution.runId) !== pending || this.releasing.has(execution.runId))
      throw new WorkspaceOperationError('工作区正在关闭，请在释放完成后重试。')
    return active
  }

  private async waitForRelease(runId: string, execution: WorkspaceExecution, signal: AbortSignal): Promise<void> {
    const cleanup = this.releasing.get(runId)
    if (!cleanup)
      return
    signal.throwIfAborted()
    const timer = new AbortController()
    try {
      await Promise.race([
        cleanup,
        sleep(Math.max(0, Math.min(30_000, execution.deadlineAt - Date.now())), undefined, { signal: AbortSignal.any([signal, timer.signal]) }).then(() => {
          throw new WorkspaceOperationError('上一轮工作区清理尚未确认，已停止等待。')
        }),
      ])
      signal.throwIfAborted()
    }
    catch (error) {
      signal.throwIfAborted()
      throw error
    }
    finally { timer.abort() }
  }

  private async open(execution: WorkspaceExecution, signal: AbortSignal): Promise<RunningWorkspace> {
    const conversation = await this.withDb(db => this.assertOwner(execution.userId, execution.conversationId, db), signal)
    if (!this.cloud.configured)
      throw new WorkspaceOperationError('沙箱和文件存储尚未配置。')
    const { conversationId, userId, runId } = execution
    await this.gc.waitForDeletion(execution, signal)
    const previous = await this.withDb(db => db.conversationWorkspace.upsert({ where: { conversationId }, create: { conversationId, userId }, update: {} }), signal)
    // 只等待本进程已启动的收尾；未知实例/真实并发仍由数据库租约拒绝。过期的其他 Run 不阻止新 owner。
    if (previous.ownerRunId && previous.leaseExpiresAt && previous.leaseExpiresAt.getTime() > Date.now())
      await this.waitForRelease(previous.ownerRunId, execution, signal)
    signal.throwIfAborted()
    let sandbox: Sandbox | undefined
    let historyId: string | undefined
    let startedAt: Date | undefined
    let creationStarted = false
    let leaseAttempted = false
    try {
      leaseAttempted = true
      const acquired = await this.withDb(async (db) => {
        await lockWorkspaceStorage(db, conversationId)
        if ((await db.workspaceGcTarget.findUnique({ where: { conversationId } }))?.deletingKey)
          throw new WorkspaceOperationError('对象回收结局未确认，暂时不能取得写入所有权。', true)
        return db.conversationWorkspace.updateMany({
          where: { conversationId, userId, OR: [{ ownerRunId: null }, { leaseExpiresAt: { lt: new Date() } }] },
          data: { ownerRunId: runId, leaseExpiresAt: new Date(execution.deadlineAt + 60_000), sandboxId: null, state: 'creating', lastOperation: 'creating', lastError: null },
        })
      }, signal)
      if (acquired.count !== 1) {
        leaseAttempted = false
        const current = await this.withDb(db => db.conversationWorkspace.findUniqueOrThrow({ where: { conversationId }, select: { state: true } }), signal)
        throw new WorkspaceOperationError(['creation_unknown', 'cleanup_pending'].includes(current.state)
          ? '上一轮沙箱状态尚未确认，暂时不能创建新实例，请等待云端到期或核查。'
          : '这个会话的工作区正在执行另一项任务，请稍后再试。')
      }
      signal.throwIfAborted()
      // 在提交前确定 ID，响应未知时仍可核查或标记未启动的创建请求。
      historyId = randomUUID()
      await this.monitoring.begin(execution, conversation.title, historyId)
      signal.throwIfAborted()
      creationStarted = true
      sandbox = await this.cloud.create(runId, execution.deadlineAt - Date.now() + 60_000, historyId)
      startedAt = new Date()
      await this.monitoring.created(historyId, sandbox.sandboxId, startedAt)
      signal.throwIfAborted()
      const row = await this.operation(execution, 'restoring', sandbox.sandboxId)
      const files = parseStoredFiles(row.files, this.prefix(userId, conversationId))
      const restored = (await this.readSourceFiles(files, signal)).map(({ path, content }) => ({ path, content: content.toString('base64') }))
      await this.cloud.request(sandbox, FILE_SCRIPT, { action: 'restore', files: restored, webProject: row.webProject }, signal)
      return { sandbox, execution, historyId, startedAt }
    }
    catch (error) {
      // 明确未取得租约时，不能清理另一个实例（包括同 Run 的另一个进程）的所有权。
      if (!leaseAttempted)
        throw error
      const resource = sandbox ?? (error instanceof WorkspaceCreatedError ? error.sandbox : undefined)
      if (error instanceof WorkspaceCreatedError) {
        startedAt = error.startedAt
        if (historyId)
          await this.monitoring.created(historyId, error.sandbox.sandboxId, startedAt).catch(() => {})
      }
      const notCreated = !creationStarted || (!resource && error instanceof WorkspaceCreationRejectedError)
      let released = notCreated
      if (resource) {
        try {
          const confirmed = await resource.kill({ requestTimeoutMs: 15_000 })
          if (historyId && startedAt)
            await this.monitoring.released(historyId, resource.sandboxId, startedAt, confirmed)
          released = true
        }
        catch {
          released = false
        }
      }
      if (historyId && !released)
        await this.monitoring.unknown(historyId, resource ? 'cleanup_pending' : 'creation_unknown').catch(() => {})
      else if (historyId && notCreated)
        await this.monitoring.unknown(historyId, 'create_failed').catch(() => {})
      await this.withDb(db => db.conversationWorkspace.updateMany({
        where: { conversationId, ownerRunId: runId },
        data: {
          ...(released ? { ownerRunId: null, leaseExpiresAt: null, sandboxId: null } : { sandboxId: resource?.sandboxId ?? null }),
          state: released ? 'error' : resource ? 'cleanup_pending' : 'creation_unknown',
          lastError: error instanceof WorkspaceOperationError ? error.message : '沙箱创建或文件恢复失败，实例状态需确认',
        },
      })).catch(() => this.logger.warn({ event: 'workspace_creation_cleanup_record_failed', runId }))
      throw error
    }
  }

  private async operation(execution: WorkspaceExecution, state: string, sandboxId?: string) {
    return this.withDb(async (db) => {
      const result = await db.conversationWorkspace.updateMany({
        where: { conversationId: execution.conversationId, userId: execution.userId, ownerRunId: execution.runId, leaseExpiresAt: { gt: new Date() } },
        data: { state, ...(state !== 'running' ? { lastOperation: state } : {}), ...(sandboxId ? { sandboxId } : {}) },
      })
      if (result.count !== 1)
        throw new WorkspaceOperationError('工作区已失去执行所有权，停止操作。', true)
      // 与租约复核共用事务和行锁，恢复读取也受同一个数据库预算约束。
      return db.conversationWorkspace.findUniqueOrThrow({ where: { conversationId: execution.conversationId }, select: { files: true, revision: true, webProject: true, artifactId: true } })
    })
  }

  private async collectFiles(sandbox: Sandbox, signal: AbortSignal, artifact = false, preserve: string[] = [], known = new Map<string, number>()): Promise<CollectedFile[]> {
    const snapshot = await this.cloud.request(sandbox, FILE_SCRIPT, { action: 'snapshot', ...(artifact ? { artifact: true } : {}), ...(preserve.length ? { preserve } : {}), ...(known.size ? { known: Object.fromEntries(known) } : {}) }, signal)
    if (!snapshot || typeof snapshot !== 'object' || !('files' in snapshot) || !Array.isArray(snapshot.files) || snapshot.files.length > MAX_WORKSPACE_FILES)
      throw new WorkspaceOperationError('沙箱文件清单无效。')
    let total = 0
    const paths = new Set<string>()
    return snapshot.files.map((raw: unknown) => {
      if (!raw || typeof raw !== 'object' || !('path' in raw) || typeof raw.path !== 'string')
        throw new WorkspaceOperationError('沙箱文件清单无效。')
      const path = artifact ? artifactPath(raw.path) : preserve.includes(raw.path) ? storedWorkspacePath(raw.path) : workspacePath(raw.path)
      let file: CollectedFile
      if ('content' in raw) {
        if (typeof raw.content !== 'string' || raw.content.length > Math.ceil(MAX_FILE_BYTES / 3) * 4)
          throw new WorkspaceOperationError('沙箱文件超过容量限制。')
        const content = Buffer.from(raw.content, 'base64')
        const sha256 = fileHash(content)
        if (content.toString('base64') !== raw.content || ('sha256' in raw && raw.sha256 !== sha256) || ('bytes' in raw && raw.bytes !== content.length))
          throw new WorkspaceOperationError('沙箱文件哈希或长度无效。')
        file = { path, content, sha256, bytes: content.length }
      }
      else {
        if (!('sha256' in raw) || typeof raw.sha256 !== 'string' || !('bytes' in raw) || typeof raw.bytes !== 'number' || known.get(raw.sha256) !== raw.bytes)
          throw new WorkspaceOperationError('沙箱省略的文件没有受保护的已确认内容。')
        file = { path, sha256: raw.sha256, bytes: raw.bytes }
      }
      total += file.bytes
      if (paths.has(path) || file.bytes > MAX_FILE_BYTES || total > MAX_WORKSPACE_BYTES)
        throw new WorkspaceOperationError('沙箱文件清单重复或超过容量限制。')
      paths.add(path)
      return file
    })
  }

  /** 恢复与 ZIP 共用四路读取；同 SHA/长度只读取一次，失败取消同批读取，不发布半份内容。 */
  private async readSourceFiles(files: StoredWorkspaceFile[], signal: AbortSignal): Promise<Array<{ path: string, content: Buffer }>> {
    const contents: Array<{ path: string, content: Buffer }> = []
    const cache = new Map<string, Promise<Buffer>>()
    const reads = new AbortController()
    const readSignal = AbortSignal.any([signal, reads.signal])
    let next = 0
    try {
      await Promise.all(Array.from({ length: Math.min(4, files.length) }, async () => {
        while (next < files.length) {
          readSignal.throwIfAborted()
          const index = next++
          const file = files[index]!
          const key = `${file.sha256}:${file.bytes}`
          let pending = cache.get(key)
          if (!pending) {
            pending = this.cloud.readFile(file, readSignal)
            cache.set(key, pending)
          }
          contents[index] = { path: file.path, content: await pending }
        }
      }))
      readSignal.throwIfAborted()
      return contents
    }
    catch (error) {
      reads.abort()
      throw error
    }
  }

  private withDb<T>(operation: (db: Prisma.TransactionClient) => Promise<T>, signal?: AbortSignal): Promise<T> {
    return workspaceDb(this.prisma, operation, signal)
  }

  private prefix(userId: string, conversationId: string): string {
    return `users/${userId}/conversations/${conversationId}/`
  }

  private async assertOwner(userId: string, conversationId: string, db: Prisma.TransactionClient = this.prisma) {
    const row = await db.conversation.findFirst({ where: { id: conversationId, userId }, select: { id: true, title: true } })
    if (!row)
      throw new NotFoundException('会话不存在或已被删除')
    return row
  }
}
