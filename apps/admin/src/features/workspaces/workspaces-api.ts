import type { WorkspaceHistoryResponse, WorkspaceMonitorResponse } from '@agent/contracts'
import { requestAdminRun } from '../shared/admin-api'

export function getWorkspaces(page: number, pageSize: number, signal?: AbortSignal): Promise<WorkspaceMonitorResponse> {
  return requestAdminRun(`/api/admin/workspaces?page=${page}&pageSize=${pageSize}`, { signal })
}

export function refreshWorkspaces(page: number, pageSize: number, signal?: AbortSignal): Promise<WorkspaceMonitorResponse> {
  return requestAdminRun(`/api/admin/workspaces/refresh?page=${page}&pageSize=${pageSize}`, { signal }, { method: 'POST' })
}

export function getWorkspaceHistory(conversationId: string, page: number, pageSize: number, signal: AbortSignal): Promise<WorkspaceHistoryResponse> {
  return requestAdminRun(`/api/admin/workspaces/${encodeURIComponent(conversationId)}/history?page=${page}&pageSize=${pageSize}`, { signal })
}
