import type { WorkspaceCloudInstance, WorkspaceCloudOverview } from '@agent/contracts'
import type { StoredWorkspaceFile } from './workspace-files.js'
import { Buffer } from 'node:buffer'
import { randomUUID } from 'node:crypto'
import process from 'node:process'
import { Injectable } from '@nestjs/common'
import OSS from 'ali-oss'
import { Sandbox } from 'e2b'
import { fileHash, MAX_FILE_BYTES, WorkspaceOperationError } from './workspace-files.js'

/** 两家已选服务的 SDK 入口；凭据只在此处读取，不复制到沙箱环境。 */
@Injectable()
export class WorkspaceCloudService {
  private storage: OSS | undefined
  private sandboxCache: WorkspaceCloudOverview['sandbox'] = { checkedAt: null, instances: null, error: null }
  private ossCache: WorkspaceCloudOverview['oss'] = { bucket: null, measuredAt: null, checkedAt: null, storageBytes: null, objectCount: null, error: null }
  private sandboxNextQuery = 0
  private ossNextQuery = 0
  private sandboxQuery: Promise<WorkspaceCloudOverview['sandbox']> | undefined
  private ossQuery: Promise<WorkspaceCloudOverview['oss']> | undefined

  get sandboxConfiguration() {
    return { template: process.env.E2B_TEMPLATE?.trim() ?? '', apiHost: new URL(process.env.E2B_API_URL ?? 'https://unconfigured.invalid').hostname }
  }

  get configured(): boolean {
    return this.sandboxConfigured && this.storageConfigured
  }

  private get sandboxConfigured(): boolean {
    return ['E2B_API_KEY', 'E2B_API_URL', 'E2B_DOMAIN', 'E2B_TEMPLATE'].every(name => Boolean(process.env[name]?.trim()))
  }

  private get storageConfigured(): boolean {
    return ['OSS_ACCESS_KEY_ID', 'OSS_ACCESS_KEY_SECRET', 'OSS_BUCKET', 'OSS_REGION'].every(name => Boolean(process.env[name]?.trim()))
  }

  async create(runId: string, timeoutMs: number, executionId?: string): Promise<Sandbox> {
    if (!this.configured)
      throw new WorkspaceOperationError('沙箱和文件存储尚未配置，请联系管理员。')
    const proxy = process.env.OUTBOUND_PROXY_URL?.trim()
    return Sandbox.create(process.env.E2B_TEMPLATE!.trim(), {
      apiKey: process.env.E2B_API_KEY!.trim(),
      apiUrl: process.env.E2B_API_URL!.trim(),
      domain: process.env.E2B_DOMAIN!.trim(),
      validateApiKey: false,
      ...(proxy ? { proxy } : {}),
      timeoutMs: Math.max(60_000, timeoutMs),
      requestTimeoutMs: 20_000,
      allowInternetAccess: false,
      secure: true,
      network: { allowPublicTraffic: false },
      metadata: { app: 'kuro', runId, ...(executionId ? { executionId } : {}) },
    })
  }

  /** 仅查询，不连接、唤醒或创建实例；成功的空列表与查询失败明确区分。 */
  async inspectSandboxes(force = false): Promise<WorkspaceCloudOverview['sandbox']> {
    if (this.sandboxQuery)
      return this.sandboxQuery
    if (!force && Date.now() < this.sandboxNextQuery)
      return this.sandboxCache
    this.sandboxQuery = (async () => {
      try {
        if (!this.sandboxConfigured)
          throw new Error('not configured')
        const proxy = process.env.OUTBOUND_PROXY_URL?.trim()
        const signal = AbortSignal.timeout(10_000)
        const checkedAt = new Date().toISOString()
        const connection = { apiKey: process.env.E2B_API_KEY!.trim(), apiUrl: process.env.E2B_API_URL!.trim(), domain: process.env.E2B_DOMAIN!.trim(), validateApiKey: false, ...(proxy ? { proxy } : {}) }
        const pager = Sandbox.list({ ...connection, query: { metadata: { app: 'kuro' } }, limit: 100, requestTimeoutMs: 10_000 })
        const instances: WorkspaceCloudInstance[] = []
        while (pager.hasNext) {
          if (instances.length >= 1000)
            throw new Error('incomplete list')
          const page = await pager.nextItems({ signal, requestTimeoutMs: 10_000 })
          instances.push(...page.map(item => ({ sandboxId: item.sandboxId, executionId: item.metadata.executionId ?? null, runId: item.metadata.runId ?? null, state: item.state, startedAt: item.startedAt.toISOString(), expiresAt: item.endAt.toISOString() })))
        }
        this.sandboxCache = { checkedAt, instances, error: null }
      }
      catch {
        this.sandboxCache = { ...this.sandboxCache, error: '云端沙箱核查失败，当前实例数量未知。' }
      }
      this.sandboxNextQuery = Date.now() + 30_000
      return this.sandboxCache
    })()
    try {
      return await this.sandboxQuery
    }
    finally { this.sandboxQuery = undefined }
  }

  /** OSS 直连；官方统计有小时级延迟，保留最后有效值和云端统计时间。 */
  async inspectStorage(): Promise<WorkspaceCloudOverview['oss']> {
    if (this.ossQuery)
      return this.ossQuery
    if (Date.now() < this.ossNextQuery)
      return this.ossCache
    this.ossQuery = (async () => {
      const bucket = process.env.OSS_BUCKET?.trim() ?? null
      try {
        // SDK 已支持此方法，当前 @types/ali-oss 未声明。
        const result: unknown = await (this.oss as OSS & { getBucketStat: (bucket: string) => Promise<unknown> }).getBucketStat(bucket!)
        const value = result && typeof result === 'object' && 'stat' in result ? result.stat : null
        if (!value || typeof value !== 'object' || !('Storage' in value) || !('ObjectCount' in value) || !('LastModifiedTime' in value))
          throw new Error('invalid statistics')
        if ([value.Storage, value.ObjectCount, value.LastModifiedTime].some(raw => typeof raw !== 'number' && (typeof raw !== 'string' || !/^\d+$/.test(raw))))
          throw new Error('invalid statistics')
        const storageBytes = Number(value.Storage)
        const objectCount = Number(value.ObjectCount)
        const measured = Number(value.LastModifiedTime) * 1000
        if (![storageBytes, objectCount, measured].every(number => Number.isSafeInteger(number) && number >= 0))
          throw new Error('invalid statistics')
        const measuredAt = new Date(measured).toISOString()
        if (!this.ossCache.measuredAt || measuredAt >= this.ossCache.measuredAt)
          this.ossCache = { bucket, storageBytes, objectCount, measuredAt, checkedAt: new Date().toISOString(), error: null }
        else
          this.ossCache = { ...this.ossCache, error: null }
        this.ossNextQuery = Date.now() + 3_600_000
      }
      catch {
        this.ossCache = { ...this.ossCache, bucket, error: 'OSS 容量查询失败，保留上一有效统计；请核对 oss:GetBucketStat 权限及直连网络。' }
        this.ossNextQuery = Date.now() + 30_000
      }
      return this.ossCache
    })()
    try {
      return await this.ossQuery
    }
    finally { this.ossQuery = undefined }
  }

  async request(sandbox: Sandbox, script: string, request: unknown, signal: AbortSignal, timeoutMs = 20_000): Promise<unknown> {
    signal.throwIfAborted()
    const path = `/tmp/kuro-${randomUUID()}.json`
    try {
      await sandbox.files.write(path, JSON.stringify(request), { user: 'root', signal, requestTimeoutMs: 15_000 })
      const code = Buffer.from(script).toString('base64')
      // SDK 默认在 /home/user 启动登录 shell；用户可写该目录，不能从那里导入 root 的 Python 模块或 shell 配置。
      const result = await sandbox.commands.run(`/usr/local/bin/python3 -I -S -c "import base64;exec(base64.b64decode('${code}'))" '${path}'`, {
        user: 'root',
        cwd: '/',
        envs: { HOME: '/root', PATH: '/usr/local/bin:/usr/bin:/bin', BASH_ENV: '/dev/null', ENV: '/dev/null' },
        signal,
        timeoutMs,
        requestTimeoutMs: 15_000,
      })
      signal.throwIfAborted()
      const value: unknown = JSON.parse(result.stdout)
      if (value && typeof value === 'object' && 'error' in value && typeof value.error === 'string')
        throw new WorkspaceOperationError(value.error)
      return value
    }
    finally {
      await sandbox.files.remove(path, { user: 'root', requestTimeoutMs: 5_000 }).catch(() => {})
    }
  }

  async putFile(file: StoredWorkspaceFile, content: Buffer, signal: AbortSignal): Promise<void> {
    signal.throwIfAborted()
    try {
      await this.oss.put(file.key, content, { headers: { 'x-oss-forbid-overwrite': 'true' }, timeout: 15_000 })
    }
    catch (error) {
      if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 'FileAlreadyExists')
        throw error
      // 失败重试可能命中上次留下的对象；名称相同不代表内容正确，不能把损坏对象确认为已保存。
      await this.readFile(file, signal)
    }
    signal.throwIfAborted()
  }

  async readFile(file: StoredWorkspaceFile, signal?: AbortSignal): Promise<Buffer> {
    signal?.throwIfAborted()
    const result = await this.oss.getStream(file.key, { timeout: 15_000 })
    const stream = result.stream
    const abort = () => stream.destroy(new Error('文件读取已取消'))
    signal?.addEventListener('abort', abort, { once: true })
    try {
      if (signal?.aborted)
        abort()
      const chunks: Buffer[] = []
      let bytes = 0
      for await (const chunk of stream) {
        const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array)
        bytes += data.length
        if (bytes > MAX_FILE_BYTES || bytes > file.bytes)
          throw new WorkspaceOperationError('存储文件超过已确认的容量。')
        chunks.push(data)
      }
      const content = Buffer.concat(chunks)
      if (content.length !== file.bytes || fileHash(content) !== file.sha256)
        throw new WorkspaceOperationError('存储文件校验失败，已停止操作。')
      return content
    }
    finally {
      signal?.removeEventListener('abort', abort)
      stream.destroy()
    }
  }

  private get oss(): OSS {
    if (!this.storageConfigured)
      throw new WorkspaceOperationError('文件存储尚未配置，请联系管理员。')
    const options = {
      bucket: process.env.OSS_BUCKET!.trim(),
      region: process.env.OSS_REGION!.trim(),
      accessKeyId: process.env.OSS_ACCESS_KEY_ID!.trim(),
      accessKeySecret: process.env.OSS_ACCESS_KEY_SECRET!.trim(),
      secure: true,
      authorizationV4: true,
      timeout: 15_000,
      enableProxy: false,
    }
    this.storage ??= new OSS(options)
    return this.storage
  }
}
