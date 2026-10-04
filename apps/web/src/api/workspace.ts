import type { WorkspaceSnapshot } from '@agent/contracts'
import { http } from './http'

export async function getWorkspace(conversationId: string, signal?: AbortSignal): Promise<WorkspaceSnapshot> {
  const response = await http.get<WorkspaceSnapshot>(`/api/conversations/${encodeURIComponent(conversationId)}/workspace`, { signal })
  const data = response.data
  if (data.conversationId !== conversationId || typeof data.configured !== 'boolean' || !Array.isArray(data.files) || data.files.length > 200)
    throw new Error('工作区响应无效')
  return data
}

export async function getWorkspaceFile(conversationId: string, path: string, revision: number, signal?: AbortSignal): Promise<Uint8Array> {
  const response = await http.get<{ encoding: string, content: string }>(`/api/conversations/${encodeURIComponent(conversationId)}/workspace/file`, { params: { path, revision }, signal })
  if (response.data.encoding !== 'base64' || response.data.content.length > 3_000_000)
    throw new Error('文件响应无效')
  return Uint8Array.from(atob(response.data.content), character => character.charCodeAt(0))
}

export async function getWorkspaceTraffic(conversationId: string, signal?: AbortSignal): Promise<unknown> {
  return (await http.get(`/api/conversations/${encodeURIComponent(conversationId)}/workspace/traffic`, { signal })).data
}
