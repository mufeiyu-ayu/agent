import type { McpConnectResult, McpPlugin, McpPluginInput } from '@agent/contracts'
import { requestAdminRun } from '../shared/admin-api'

export function fetchSystemPlugins(signal: AbortSignal) {
  return requestAdminRun<McpPlugin[]>('/api/admin/mcp', { signal })
}
export function saveSystemPlugin(input: McpPluginInput, signal: AbortSignal, id?: string) {
  return requestAdminRun<McpPlugin>(
    `/api/admin/mcp${id ? `/${encodeURIComponent(id)}` : ''}`,
    { signal },
    { method: id ? 'PATCH' : 'POST', body: input },
  )
}
export function toggleSystemPlugin(id: string, enabled: boolean, signal: AbortSignal) {
  return requestAdminRun<McpPlugin>(
    `/api/admin/mcp/${encodeURIComponent(id)}/enabled`,
    { signal },
    { method: 'POST', body: { enabled } },
  )
}
export function removeSystemPlugin(id: string, signal: AbortSignal) {
  return requestAdminRun(`/api/admin/mcp/${encodeURIComponent(id)}`, { signal }, { method: 'DELETE' })
}
export function testSystemPlugin(plugin: McpPlugin, headers: Record<string, string>, signal: AbortSignal) {
  return requestAdminRun<McpConnectResult>(
    `/api/admin/mcp/${encodeURIComponent(plugin.id)}/test`,
    { signal },
    { method: 'POST', body: { headers, configRevision: plugin.configRevision } },
  )
}
