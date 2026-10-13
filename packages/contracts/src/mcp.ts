export const MCP_AUTH_TYPES = ['none', 'headers', 'oauth'] as const
export type McpAuthType = (typeof MCP_AUTH_TYPES)[number]

export interface McpTool {
  name: string
  description: string
  inputSchema: Record<string, unknown>
}

export interface McpPluginInput {
  name: string
  description: string
  url: string
  authType: McpAuthType
  icon?: string | null
  headerNames: string[]
  oauthClientId?: string
  oauthClientSecret?: string
  oauthScopes?: string
  headers?: Record<string, string>
}

export interface McpPlugin {
  id: string
  configRevision: string
  name: string
  description: string
  url: string
  icon: string | null
  system: boolean
  available: boolean
  authType: McpAuthType
  headerNames: string[]
  oauthClientId: string
  oauthScopes: string
  hasClientSecret: boolean
  connected: boolean
  enabled: boolean
  needsAuth: boolean
  tools: McpTool[]
}

export interface McpConnectResult {
  authorizationUrl?: string
  plugin: McpPlugin
}
