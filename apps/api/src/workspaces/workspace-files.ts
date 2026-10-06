import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { posix } from 'node:path'

export const WORKSPACE_ROOT = '/workspace/project'
export const MAX_FILE_BYTES = 2 * 1024 * 1024
export const MAX_WORKSPACE_BYTES = 8 * 1024 * 1024
export const MAX_WORKSPACE_FILES = 200
export const MAX_READ_OBSERVATION_CHARS = 24_000

export interface StoredWorkspaceFile {
  path: string
  bytes: number
  sha256: string
  key: string
}

export interface WorkspaceCommit {
  conversationId: string
  runId: string
  expectedRevision: number
  expectedArtifactId?: string | null
  files: StoredWorkspaceFile[]
  sourceChanged?: boolean
  webProject?: boolean
  artifact?: {
    id: string
    userId: string
    sourceRevision: number
    command: string
    createdAt: string
    files: StoredWorkspaceFile[]
  }
}

export interface WorkspaceExecution {
  userId: string
  conversationId: string
  runId: string
  deadlineAt: number
}

export class WorkspaceOperationError extends Error {
  constructor(message: string, readonly fatal = false) {
    super(message)
  }
}

/** 路径仅能指向当前工作区；不接受 OSS key、跨会话身份或主机绝对路径。 */
export function storedWorkspacePath(value: string): string {
  const relative = value.startsWith(`${WORKSPACE_ROOT}/`)
    ? value.slice(WORKSPACE_ROOT.length + 1)
    : value
  if (!relative || relative.length > 500 || relative.includes('\\') || [...relative].some(character => character.charCodeAt(0) < 32)
    || Buffer.from(relative).toString('utf8') !== relative
    || posix.isAbsolute(relative) || relative.split('/').includes('..')) {
    throw new WorkspaceOperationError('文件路径必须位于 /workspace/project 内，不允许越界。')
  }
  const path = posix.normalize(relative)
  if (path === '.' || path.endsWith('/'))
    throw new WorkspaceOperationError('该路径不是普通文件。')
  return path
}

export function privateWorkspacePath(path: string): boolean {
  return path.split('/').some(part => ['node_modules', '.git', '.venv', '__pycache__', '.vite-cache', '.cache', '.pnpm-store'].includes(part)
    || /^\.env(?:\.|$)/i.test(part) || /\.(?:pem|key|p12|pfx)$/i.test(part))
}

export function artifactPath(value: string): string {
  const path = storedWorkspacePath(value)
  if (path.includes('%') || privateWorkspacePath(path))
    throw new WorkspaceOperationError('构建包含禁止保存的资源路径。')
  return path
}

export function workspacePath(value: string): string {
  const path = artifactPath(value)
  if (value.split('/').some(part => ['.', ''].includes(part)) && !value.startsWith(`${WORKSPACE_ROOT}/`))
    throw new WorkspaceOperationError('文件路径不能包含空目录或点段。')
  if (path.split('/').some(part => ['dist', 'tmp', '.tmp'].includes(part))) {
    throw new WorkspaceOperationError('该路径不是可保存的工作文件。')
  }
  return path
}

export function fileHash(content: Buffer): string {
  return createHash('sha256').update(content).digest('hex')
}

export function parseStoredFiles(value: unknown, prefix: string): StoredWorkspaceFile[] {
  if (!Array.isArray(value) || value.length > MAX_WORKSPACE_FILES)
    throw new WorkspaceOperationError('工作文件清单无效。')
  let bytes = 0
  const paths = new Set<string>()
  return value.map((item: unknown) => {
    if (!item || typeof item !== 'object')
      throw new WorkspaceOperationError('工作文件清单无效。')
    const file = item as Record<string, unknown>
    if (typeof file.path !== 'string' || typeof file.key !== 'string' || typeof file.sha256 !== 'string'
      || !Number.isSafeInteger(file.bytes) || (file.bytes as number) < 0 || (file.bytes as number) > MAX_FILE_BYTES
      || !/^[a-f0-9]{64}$/.test(file.sha256) || file.key !== `${prefix}objects/${file.sha256}`) {
      throw new WorkspaceOperationError('工作文件清单无效。')
    }
    const path = storedWorkspacePath(file.path)
    bytes += file.bytes as number
    if (paths.has(path) || bytes > MAX_WORKSPACE_BYTES)
      throw new WorkspaceOperationError('工作文件清单越过容量限制。')
    paths.add(path)
    return { path, key: file.key, sha256: file.sha256, bytes: file.bytes as number }
  })
}
