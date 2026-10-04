import type { UserProfile } from './auth.js'

export interface WorkspaceFile {
  path: string
  bytes: number
  sha256: string
}

export interface WorkspaceSnapshot {
  configured: boolean
  conversationId: string
  revision: number
  state: string
  files: WorkspaceFile[]
  lastOperation: string | null
  lastError: string | null
  updatedAt: string | null
}

export interface WorkspaceToolDisplay {
  title: string
  operation: 'read' | 'write' | 'edit' | 'bash' | 'traffic'
  path?: string
  command?: string
  stdout?: string
  stderr?: string
  exitCode?: number
  revision?: number
  files?: WorkspaceFile[]
  preview?: string
}

export interface WorkspaceMonitorItem {
  conversationId: string
  title: string
  userId: string
  user: UserProfile | null
  deleted: boolean
  state: string
  revision: number | null
  sandboxId: string | null
  leaseExpiresAt: string | null
  lastError: string | null
  lastOperation: string | null
  updatedAt: string
  fileCount: number | null
  fileBytes: number | null
  sandboxCount: number
  latestRunAt: string | null
  confirmedDurationMs: number | null
}

export interface WorkspaceMonitorResponse {
  cloud: WorkspaceCloudOverview
  configured: boolean
  items: WorkspaceMonitorItem[]
  pagination: { page: number, pageSize: number, total: number }
  summary: { attempts: number, created: number, released: number, unconfirmed: number, todayAttempts: number, confirmedDurationMs: number }
}

export interface WorkspaceHistoryResponse {
  workspace: WorkspaceMonitorItem
  items: SandboxExecutionRecord[]
  pagination: { page: number, pageSize: number, total: number }
}

export interface SandboxExecutionRecord {
  id: string
  userId: string
  user: UserProfile | null
  conversationId: string
  runId: string
  runAvailable: boolean
  title: string
  sandboxId: string | null
  template: string
  apiHost: string
  state: string
  requestedAt: string
  startedAt: string | null
  releasedAt: string | null
  expiresAt: string | null
  durationMs: number | null
  checkedAt: string | null
}

export interface WorkspaceCloudInstance {
  sandboxId: string
  executionId: string | null
  runId: string | null
  state: string
  startedAt: string
  expiresAt: string
}

export interface WorkspaceCloudOverview {
  sandbox: { checkedAt: string | null, instances: WorkspaceCloudInstance[] | null, error: string | null }
  oss: { bucket: string | null, measuredAt: string | null, checkedAt: string | null, storageBytes: number | null, objectCount: number | null, error: string | null }
}
