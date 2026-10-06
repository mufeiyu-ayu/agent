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

export async function getWorkspaceArchive(conversationId: string, revision: number, signal: AbortSignal): Promise<Uint8Array> {
  const response = await http.get<{ revision: number, encoding: string, content: string }>(`/api/conversations/${encodeURIComponent(conversationId)}/workspace/archive`, { params: { revision }, signal })
  if (response.data.revision !== revision || response.data.encoding !== 'base64' || response.data.content.length > 13_000_000)
    throw new Error('源码归档响应无效')
  return Uint8Array.from(atob(response.data.content), character => character.charCodeAt(0))
}

export async function openWorkspacePreview(conversationId: string, artifactId: string, signal: AbortSignal): Promise<string> {
  const response = await http.get<{ artifactId: string, url: string }>(`/api/conversations/${encodeURIComponent(conversationId)}/workspace/artifacts/${encodeURIComponent(artifactId)}/preview`, { params: { origin: window.location.origin }, signal })
  if (response.data.artifactId !== artifactId || !/^\/api\/workspace-preview\/[a-f0-9]{64}\/document$/.test(response.data.url))
    throw new Error('构建预览响应无效')
  return response.data.url
}

export async function getWorkspaceTraffic(conversationId: string, signal?: AbortSignal): Promise<unknown> {
  return (await http.get(`/api/conversations/${encodeURIComponent(conversationId)}/workspace/traffic`, { signal })).data
}
