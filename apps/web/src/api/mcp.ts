import type { McpConnectResult, McpPlugin, McpPluginInput } from '@agent/contracts'
import { http } from './http'

export function listPlugins(signal: AbortSignal) {
  return http.get<McpPlugin[]>('/api/mcp', { signal }).then(r => r.data)
}
export function getPlugin(id: string, signal: AbortSignal) {
  return http.get<McpPlugin>(`/api/mcp/${encodeURIComponent(id)}`, { signal }).then(r => r.data)
}
export function getMcpConfig(signal: AbortSignal) {
  return http.get<{ callbackUrl: string }>('/api/mcp/config', { signal }).then(r => r.data)
}
export function importPlugins(json: string, signal: AbortSignal) {
  return http
    .post<Array<{ config: McpPluginInput, headers: Record<string, string> }>>('/api/mcp/import', { json }, { signal })
    .then(r => r.data)
}
export function savePlugin(input: McpPluginInput, signal: AbortSignal, id?: string) {
  return (
    id
      ? http.patch<McpPlugin>(`/api/mcp/${encodeURIComponent(id)}`, input, {
          signal,
        })
      : http.post<McpPlugin>('/api/mcp', input, { signal })
  ).then(r => r.data)
}
export function connectPlugin(plugin: McpPlugin, headers: Record<string, string> | undefined, signal: AbortSignal) {
  return http
    .post<McpConnectResult>(
      `/api/mcp/${encodeURIComponent(plugin.id)}/connect`,
      { headers, configRevision: plugin.configRevision },
      { signal, timeout: 40_000 },
    )
    .then(r => r.data)
}
export function enablePlugin(id: string, enabled: boolean, signal: AbortSignal) {
  return http
    .post<McpPlugin>(`/api/mcp/${encodeURIComponent(id)}/enabled`, { enabled }, { signal })
    .then(r => r.data)
}
export function disconnectPlugin(id: string, signal: AbortSignal) {
  return http.post<McpPlugin>(`/api/mcp/${encodeURIComponent(id)}/disconnect`, {}, { signal }).then(r => r.data)
}
export function deletePlugin(id: string, signal: AbortSignal) {
  return http.delete(`/api/mcp/${encodeURIComponent(id)}`, { signal })
}
