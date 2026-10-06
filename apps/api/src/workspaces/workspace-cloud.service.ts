import type { WorkspaceCloudInstance, WorkspaceCloudOverview } from '@agent/contracts'
import type { SandboxApiOpts } from 'e2b'
import type { StoredWorkspaceFile } from './workspace-files.js'
import { Buffer } from 'node:buffer'
import { randomUUID } from 'node:crypto'
import process from 'node:process'
import { gunzipSync } from 'node:zlib'
import { Injectable } from '@nestjs/common'
import OSS from 'ali-oss'
import { AuthenticationError, RateLimitError, Sandbox } from 'e2b'
import { fileHash, MAX_FILE_BYTES, WorkspaceOperationError } from './workspace-files.js'

/** 只标记已收到创建拒绝响应的情况；网络/创建后的失败仍视为结果未知。 */
export class WorkspaceCreationRejectedError extends WorkspaceOperationError {
  constructor(status: 401 | 429) {
    super(status === 401 ? '沙箱创建被拒绝：认证失败，请检查服务配置。' : '沙箱创建被限流，未创建实例，请稍后再试。')
    this.name = 'WorkspaceCreationRejectedError'
  }
}

/** SDK 已确认创建、但尚未返回实例；保留实际 ID，让业务层仍能登记和清理。 */
export class WorkspaceCreatedError extends WorkspaceOperationError {
  constructor(readonly sandbox: Pick<Sandbox, 'sandboxId' | 'kill'>, readonly startedAt: Date) {
    super('沙箱创建后的初始化失败，未执行文件操作。', true)
    this.name = 'WorkspaceCreatedError'
  }
}

/** PUT 未得到明确成功或拒绝响应；不能仅按超时认定没有迟到写入。 */
export class WorkspaceUploadOutcomeUnknownError extends WorkspaceOperationError {
  constructor() { super('文件上传结果未知，保留待核查目标。') }
}

export class WorkspaceDeleteOutcomeUnknownError extends WorkspaceOperationError {
  constructor() { super('对象删除结果未知，保持存储写入保护。') }
}

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
    const template = process.env.E2B_TEMPLATE!.trim()
    const options = {
      apiKey: process.env.E2B_API_KEY!.trim(),
      apiUrl: process.env.E2B_API_URL!.trim(),
      domain: process.env.E2B_DOMAIN!.trim(),
      validateApiKey: false,
      // 此适配器只管理云实例；创建、SDK 构造与清理不能被 E2B_DEBUG 切到本地短路。
      debug: false,
      ...(proxy ? { proxy } : {}),
      timeoutMs: Math.max(60_000, timeoutMs),
      requestTimeoutMs: 20_000,
      allowInternetAccess: false,
      secure: true,
      network: { allowPublicTraffic: false },
      metadata: { app: 'kuro', runId, ...(executionId ? { executionId } : {}) },
    }
    let createdId: string | undefined
    let startedAt: Date | undefined
    // 沿用 e2b 2.31.0 的创建/兼容检查；其后置检查通过 this.kill 回滚。
    // 每次调用独立记录阶段，不修改 SDK 全局方法，也不从 message/stack 猜 HTTP 状态。
    class Creation extends Sandbox {
      static open() { return this.createSandbox(template, options.timeoutMs, options) }
      static override kill(id: string, opts?: SandboxApiOpts) {
        createdId = id
        startedAt = new Date()
        return super.kill(id, opts)
      }
    }
    try {
      const info = await Creation.open()
      createdId = info.sandboxId
      startedAt = new Date()
      return new Sandbox({
        ...options,
        sandboxId: info.sandboxId,
        envdVersion: info.envdVersion,
        ...(info.sandboxDomain ? { sandboxDomain: info.sandboxDomain } : {}),
        ...(info.envdAccessToken ? { envdAccessToken: info.envdAccessToken } : {}),
        ...(info.trafficAccessToken ? { trafficAccessToken: info.trafficAccessToken } : {}),
      })
    }
    catch (error) {
      if (createdId) {
        const sandboxId = createdId
        throw new WorkspaceCreatedError({ sandboxId, kill: opts => Sandbox.kill(sandboxId, { ...options, ...opts }) }, startedAt!)
      }
      // SDK 的这两个拒绝类不带 statusCode；仅在尚未进入创建后阶段时确定未创建。
      if (error instanceof AuthenticationError)
        throw new WorkspaceCreationRejectedError(401)
      if (error instanceof RateLimitError)
        throw new WorkspaceCreationRejectedError(429)
      throw error
    }
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
    const outputPath = `${path}.result`
    try {
      await sandbox.files.write(path, JSON.stringify(request), { user: 'root', signal, requestTimeoutMs: 15_000 })
      const code = Buffer.from(script).toString('base64')
      // SDK 默认在 /home/user 启动登录 shell；用户可写该目录，不能从那里导入 root 的 Python 模块或 shell 配置。
      // 大快照不能走 envd 命令 stdout；可信监督结果先写 root-only 文件，再由 SDK 有界流式读取。
      await sandbox.commands.run(`/usr/local/bin/python3 -I -S -c "import base64,gzip,io,os,sys;fd=os.open(sys.argv[2],os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600);sys.stdout=io.TextIOWrapper(gzip.GzipFile(fileobj=os.fdopen(fd,'wb'),mode='wb'),encoding='utf-8');exec(base64.b64decode('${code}'));sys.stdout.close()" '${path}' '${outputPath}'`, {
        user: 'root',
        cwd: '/',
        envs: { HOME: '/root', PATH: '/usr/local/bin:/usr/bin:/bin', BASH_ENV: '/dev/null', ENV: '/dev/null' },
        signal,
        timeoutMs,
        requestTimeoutMs: 15_000,
      })
      signal.throwIfAborted()
      const stream = await sandbox.files.read(outputPath, { user: 'root', format: 'stream', signal, requestTimeoutMs: 15_000 })
      const chunks: Uint8Array[] = []
      let bytes = 0
      for await (const chunk of stream) {
        signal.throwIfAborted()
        bytes += chunk.byteLength
        if (bytes > 12 * 1024 * 1024)
          throw new WorkspaceOperationError('沙箱结果超过传输容量限制。')
        chunks.push(chunk)
      }
      signal.throwIfAborted()
      const value: unknown = JSON.parse(gunzipSync(Buffer.concat(chunks), { maxOutputLength: 12 * 1024 * 1024 }).toString('utf8'))
      if (value && typeof value === 'object' && 'error' in value && typeof value.error === 'string')
        throw new WorkspaceOperationError(value.error)
      return value
    }
    finally {
      await Promise.all([path, outputPath].map(file => sandbox.files.remove(file, { user: 'root', requestTimeoutMs: 5_000 }).catch(() => {})))
    }
  }

  get storageBucket(): string {
    return process.env.OSS_BUCKET?.trim() ?? ''
  }

  async listFiles(prefix: string, marker?: string): Promise<{ keys: string[], nextMarker?: string }> {
    const result = await this.oss.list({ prefix, 'max-keys': 1000, ...(marker ? { marker } : {}) }, { timeout: 15_000 })
    const keys = (result.objects ?? []).map(object => object.name)
    if (keys.some(key => !key.startsWith(prefix)) || (result.isTruncated && !result.nextMarker)
      || (result.nextMarker && (!result.nextMarker.startsWith(prefix) || (marker && result.nextMarker <= marker)))) {
      throw new WorkspaceOperationError('存储清单不完整，未回收对象。')
    }
    return { keys, ...(result.nextMarker ? { nextMarker: result.nextMarker } : {}) }
  }

  async deleteFile(key: string): Promise<void> {
    // DeleteObject 对不存在的对象也返回 204；不做删除标记/历史版本清理。
    try {
      await this.oss.delete(key, { timeout: 15_000 })
    }
    catch (error) {
      const status = error && typeof error === 'object' && 'status' in error ? Number(error.status) : 0
      if (status >= 400 && status < 500 && status !== 408)
        throw new WorkspaceOperationError('对象删除被存储服务拒绝。')
      throw new WorkspaceDeleteOutcomeUnknownError()
    }
  }

  async putFile(file: StoredWorkspaceFile, content: Buffer, signal: AbortSignal): Promise<void> {
    signal.throwIfAborted()
    try {
      await this.oss.put(file.key, content, { headers: { 'x-oss-forbid-overwrite': 'true' }, timeout: 15_000 })
    }
    catch (error) {
      if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 'FileAlreadyExists') {
        const status = error && typeof error === 'object' && 'status' in error ? Number(error.status) : 0
        if (status >= 400 && status < 500 && status !== 408)
          throw new WorkspaceOperationError('文件上传被存储服务拒绝。')
        throw new WorkspaceUploadOutcomeUnknownError()
      }
      // 失败重试可能命中上次留下的对象；名称相同不代表内容正确，不能把损坏对象确认为已保存。
      await this.readFile(file, signal)
    }
    // 返回的是 PUT/校验的实际确认；调用方登记 settled 后再响应晚到的取消。
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
      // 单次外部写入结局必须可核查；禁止超时后自动重试掩盖前一次迟到 PUT/DELETE。
      retryMax: 0,
      enableProxy: false,
    }
    this.storage ??= new OSS(options)
    return this.storage
  }
}
