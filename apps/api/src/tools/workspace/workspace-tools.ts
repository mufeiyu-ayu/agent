import type { ToolDefinition, ToolExecutionContext, ToolExecutor, ToolResult, ValidatedToolInvocation } from '../core/tool.types.js'
import { Buffer } from 'node:buffer'
import { truncateCodeUnits } from '@agent/agent'
import { Inject, Injectable } from '@nestjs/common'
import { MAX_FILE_BYTES, MAX_READ_OBSERVATION_CHARS, WorkspaceOperationError, workspacePath } from '../../workspaces/workspace-files.js'
import { WorkspaceService } from '../../workspaces/workspace.service.js'

interface ReadInput { path: string, offset: number, limit: number }
interface WriteInput { path: string, content: string }
interface EditInput { path: string, edits: Array<{ oldText: string, newText: string }> }
interface BashInput { command: string, timeout: number, title: string, build?: boolean }

function object(value: unknown, allowed: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !allowed.includes(key)))
    throw new Error('无效工具参数')
  return value as Record<string, unknown>
}
function text(value: unknown, max: number, allowEmpty = false): string {
  if (typeof value !== 'string' || (!allowEmpty && !value.trim()) || value.length > max)
    throw new Error('无效文本参数')
  return value
}
function integer(value: unknown, fallback: number, max: number): number {
  if (value === undefined)
    return fallback
  if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > max)
    throw new Error('无效数值参数')
  return value as number
}

export const readDefinition: ToolDefinition<ReadInput> = {
  name: 'read',
  version: '1',
  description: '读取当前会话沙箱 /workspace/project 下的 UTF-8 文件，按完整行返回。offset 从 1 开始，按 nextOffset 续读，null 才表示读完；超长单行返回可用 bash 执行的分段读取命令。先读再编辑。',
  timeoutMs: 120_000,
  maxObservationChars: MAX_READ_OBSERVATION_CHARS,
  input: {
    schema: { type: 'object', properties: { path: { type: 'string' }, offset: { type: 'integer', minimum: 1, maximum: MAX_FILE_BYTES + 1 }, limit: { type: 'integer', minimum: 1, maximum: 1000 } }, required: ['path'], additionalProperties: false },
    parse(value) {
      const input = object(value, ['path', 'offset', 'limit'])
      return { path: workspacePath(text(input.path, 500)), offset: integer(input.offset, 1, MAX_FILE_BYTES + 1), limit: integer(input.limit, 200, 1000) }
    },
  },
}
export const writeDefinition: ToolDefinition<WriteInput> = {
  name: 'write',
  version: '1',
  description: '在当前会话沙箱中创建或覆盖工作文件。自动创建目录；保存到 OSS 后才返回成功。文件最多 2 MiB。',
  timeoutMs: 120_000,
  maxObservationChars: 8_000,
  input: {
    schema: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'], additionalProperties: false },
    parse(value) {
      const input = object(value, ['path', 'content'])
      const content = text(input.content, MAX_FILE_BYTES, true)
      if (Buffer.byteLength(content) > MAX_FILE_BYTES)
        throw new Error('文件过大')
      return { path: workspacePath(text(input.path, 500)), content }
    },
  },
}
export const editDefinition: ToolDefinition<EditInput> = {
  name: 'edit',
  version: '1',
  description: '精确修改当前工作文件。edits 的每个 oldText 必须在原文件唯一匹配，各替换区域不能重叠；不匹配时先 read 再修正。全部匹配后一次写入并保存。',
  timeoutMs: 120_000,
  maxObservationChars: 8_000,
  input: {
    schema: { type: 'object', properties: { path: { type: 'string' }, edits: { type: 'array', minItems: 1, maxItems: 20, items: { type: 'object', properties: { oldText: { type: 'string' }, newText: { type: 'string' } }, required: ['oldText', 'newText'], additionalProperties: false } } }, required: ['path', 'edits'], additionalProperties: false },
    parse(value) {
      const input = object(value, ['path', 'edits'])
      if (!Array.isArray(input.edits) || !input.edits.length || input.edits.length > 20)
        throw new Error('替换参数无效')
      const edits = input.edits.map((value: unknown) => {
        const edit = object(value, ['oldText', 'newText'])
        const oldText = text(edit.oldText, MAX_FILE_BYTES, true)
        if (!oldText.length)
          throw new Error('替换原文不能为空')
        return { oldText, newText: text(edit.newText, MAX_FILE_BYTES, true) }
      })
      if (Buffer.byteLength(JSON.stringify(edits)) > MAX_FILE_BYTES * 2)
        throw new Error('替换内容过大')
      return { path: workspacePath(text(input.path, 500)), edits }
    },
  },
}
export const bashDefinition: ToolDefinition<BashInput> = {
  name: 'bash',
  version: '1',
  description: '在当前会话沙箱 /workspace/project 中执行 Bash 命令，返回 stdout、stderr、退出码。用于运行、查验、编译和测试代码，失败后修正再验证。默认 60 秒，最长 90 秒；禁止网络连接（含 localhost），不支持常驻服务。仅 pnpm build 可带 build:true：清理旧 dist，成功后验证保存完整构建 Artifact；普通命令不会发布预览。',
  timeoutMs: 120_000,
  maxObservationChars: 24_000,
  input: {
    schema: { type: 'object', properties: { command: { type: 'string', description: '工作目录已是 /workspace/project。build:true 时必须逐字为 pnpm build，不加 cd、管道或重定向；工具自行返回 stdout/stderr 和退出码。' }, build: { type: 'boolean', description: '仅 pnpm build 使用 true，发布成功的完整 dist；检查/脚本不设置' }, timeout: { type: 'integer', minimum: 1, maximum: 90 }, title: { type: 'string', description: '给用户看的简短操作说明，例如检查页面脚本和数据' } }, required: ['command'], additionalProperties: false },
    parse(value) {
      const input = object(value, ['command', 'timeout', 'title', 'build'])
      if (input.build !== undefined && (typeof input.build !== 'boolean' || (input.build && input.command !== 'pnpm build')))
        throw new Error('构建参数只支持 pnpm build')
      return { command: text(input.command, 32_000), timeout: integer(input.timeout, 60, 90), title: input.title === undefined ? '执行并检查代码' : text(input.title, 120), ...(input.build !== undefined ? { build: input.build } : {}) }
    },
  },
}

/** 四个执行器共用保存与错误处理；保持现有注册/执行/记录/回喂链路。 */
abstract class WorkspaceTool<T extends { path?: string, command?: string, title?: string }> implements ToolExecutor<T> {
  constructor(protected readonly workspaces: WorkspaceService, private readonly action: 'read' | 'write' | 'edit' | 'bash') {}

  async execute(invocation: ValidatedToolInvocation<T>, context: ToolExecutionContext): Promise<ToolResult> {
    if (!context.workspace)
      return { ok: false, code: 'execution_failed', modelContent: '当前请求没有可信工作区身份，未执行。' }
    const execution = context.workspace
    const input = invocation.input
    const stop = () => {
      void this.workspaces.releaseRun(execution.runId, '工具已中断，保留上次已确认版本')
    }
    context.signal.addEventListener('abort', stop, { once: true })
    try {
      const result = this.action === 'bash'
        ? await this.workspaces.bash(execution, input.command!, (input as unknown as BashInput).timeout, context.signal, (input as unknown as BashInput).build)
        : await this.workspaces.fileOperation(execution, { action: this.action, ...input }, context.signal)
      context.signal.throwIfAborted()
      const data = result as Record<string, unknown>
      if (data.timedOut === true)
        return { ok: false, code: 'timeout', modelContent: '命令执行超时，沙箱已终止；当前命令未保存的改动已舍弃，保留上次已保存版本。' }
      const commit = this.action === 'read' ? undefined : await this.workspaces.prepareCommit(execution, context.signal)
      const revision = commit ? commit.expectedRevision + Number(commit.sourceChanged !== false) : undefined
      const artifact = commit?.artifact ? { id: commit.artifact.id, sourceRevision: commit.artifact.sourceRevision, command: commit.artifact.command, createdAt: commit.artifact.createdAt, runId: execution.runId, files: commit.artifact.files.map(({ path, bytes, sha256 }) => ({ path, bytes, sha256 })) } : undefined
      const files = commit?.files.map(({ path, bytes, sha256 }) => ({ path, bytes, sha256 }))
      const workspace = {
        operation: this.action,
        title: input.title ?? ({ read: '读取文件', write: '写入文件', edit: '修改文件', bash: '执行代码' })[this.action],
        ...(input.path ? { path: input.path } : {}),
        ...(input.command ? { command: input.command } : {}),
        ...(this.action === 'write' ? { preview: (input as unknown as WriteInput).content.slice(0, 24_000) } : {}),
        ...(this.action === 'edit' ? { preview: JSON.stringify((input as unknown as EditInput).edits).slice(0, 24_000) } : {}),
        ...(this.action === 'read' && typeof data.content === 'string' ? { preview: data.content } : {}),
        ...(typeof data.stdout === 'string' ? { stdout: data.stdout } : {}),
        ...(typeof data.stderr === 'string' ? { stderr: data.stderr } : {}),
        ...(typeof data.exitCode === 'number' ? { exitCode: data.exitCode } : {}),
        ...(commit ? { revision: revision!, files: files! } : {}),
        ...(artifact ? { artifact } : {}),
      }
      const delivery = {
        ...(commit ? { saved: true, revision, files: files!.slice(0, 20) } : {}),
        ...(artifact ? { artifact: { id: artifact.id, sourceRevision: artifact.sourceRevision, fileCount: artifact.files.length, files: artifact.files.slice(0, 20) } } : {}),
      }
      return {
        ok: true,
        modelContent: this.action === 'bash' ? bashModelContent(data, delivery, files?.length ?? 0) : JSON.stringify({ ...data, ...delivery }),
        display: { workspace, ...(typeof data.exitCode === 'number' && data.exitCode !== 0 ? { failure: 'failed' as const } : {}) },
        ...(commit ? { workspaceCommit: commit } : {}),
      }
    }
    catch (error) {
      context.signal.throwIfAborted()
      if (error instanceof WorkspaceOperationError) {
        if (error.fatal)
          await this.workspaces.releaseRun(execution.runId, error.message)
        else
          await this.workspaces.reportError(execution, error.message)
        return { ok: false, code: 'execution_failed', modelContent: error.message }
      }
      await this.workspaces.releaseRun(execution.runId, '文件操作或保存失败，保留上次已确认版本')
      const name = error instanceof Error ? error.name : 'UnknownError'
      throw new Error(`工作区服务请求失败（${/^\w+$/.test(name) ? name : 'UnknownError'}）`)
    }
    finally {
      context.signal.removeEventListener('abort', stop)
    }
  }
}

/** 交付身份优先，按最终 JSON 的 code point 预算分配日志；全局 observation 上限仍保留。 */
function bashModelContent(data: Record<string, unknown>, delivery: {
  saved?: boolean
  revision?: number | undefined
  files?: unknown[]
  artifact?: { id: string, sourceRevision: number, fileCount: number, files: unknown[] }
}, sourceCount: number): string {
  const stdout = String(data.stdout ?? '')
  const stderr = String(data.stderr ?? '')
  const artifactCount = delivery.artifact?.fileCount ?? 0
  const serialize = (limit: number) => JSON.stringify({
    exitCode: data.exitCode,
    ...delivery,
    ...(sourceCount !== (delivery.files?.length ?? 0) ? { filesOmitted: sourceCount - delivery.files!.length } : {}),
    ...(artifactCount !== (delivery.artifact?.files.length ?? 0) ? { artifactFilesOmitted: artifactCount - delivery.artifact!.files.length } : {}),
    stderr: boundedOutput(stderr, limit),
    stdout: boundedOutput(stdout, limit),
    truncated: data.truncated === true || stdout.length > limit || stderr.length > limit,
  })
  const length = (text: string) => [...text].length
  const full = serialize(12_000)
  if (length(full) <= MAX_READ_OBSERVATION_CHARS)
    return full
  // 清单原本就是部分展示；给两路诊断留至少半份预算，不移除保存状态或 Artifact 身份。
  while (length(serialize(0)) > MAX_READ_OBSERVATION_CHARS / 2) {
    if ((delivery.files?.length ?? 0) >= (delivery.artifact?.files.length ?? 0))
      delivery.files?.pop()
    else
      delivery.artifact?.files.pop()
  }
  let low = 0
  let high = 12_000
  while (low < high) {
    const middle = Math.ceil((low + high) / 2)
    if (length(serialize(middle)) <= MAX_READ_OBSERVATION_CHARS)
      low = middle
    else
      high = middle - 1
  }
  return serialize(low)
}

function boundedOutput(value: string, limit: number): string {
  if (value.length <= limit)
    return value
  const marker = '\n[中间输出已截断]\n'
  if (limit <= marker.length)
    return truncateCodeUnits(marker, limit)
  const kept = limit - marker.length
  const tail = value.slice(value.length - Math.ceil(kept / 2)).replace(/^[\uDC00-\uDFFF]/, '')
  return `${truncateCodeUnits(value, Math.floor(kept / 2))}${marker}${tail}`
}

@Injectable()
export class ReadTool extends WorkspaceTool<ReadInput> {
  constructor(@Inject(WorkspaceService) service: WorkspaceService) {
    super(service, 'read')
  }
}
@Injectable()
export class WriteTool extends WorkspaceTool<WriteInput> {
  constructor(@Inject(WorkspaceService) service: WorkspaceService) {
    super(service, 'write')
  }
}
@Injectable()
export class EditTool extends WorkspaceTool<EditInput> {
  constructor(@Inject(WorkspaceService) service: WorkspaceService) {
    super(service, 'edit')
  }
}
@Injectable()
export class BashTool extends WorkspaceTool<BashInput> {
  constructor(@Inject(WorkspaceService) service: WorkspaceService) {
    super(service, 'bash')
  }
}
