import type { McpPluginInput } from '@agent/contracts'
import { Buffer } from 'node:buffer'
import { BadRequestException } from '@nestjs/common'
import { matchesFileSignature } from '../attachments/attachment-files.js'

export function mcpUrl(value: string): URL {
  let url: URL
  try {
    url = new URL(value)
  }
  catch {
    throw new BadRequestException('请填写有效的 MCP 服务地址')
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.hash) {
    throw new BadRequestException('MCP 地址必须为不含账号、密码或片段的 HTTPS 地址')
  }
  if ([...url.searchParams.keys()].some(key => /key|token|secret|password/i.test(key))) {
    throw new BadRequestException('请在认证请求头中填写密钥，不要放在服务地址里')
  }
  return url
}

export function checkHeaderName(name: string): void {
  if (
    !/^[a-z][a-z0-9-]{0,63}$/i.test(name)
    || /^(?:host|cookie|set-cookie|content-length|content-type|connection|transfer-encoding|proxy-.*|sec-.*|mcp-.*|origin|referer|accept)$/i.test(
      name,
    )
  ) {
    throw new BadRequestException('认证请求头名称无效或不被允许')
  }
}

export function checkHeaders(value: Record<string, string>, names: string[]): Record<string, string> {
  if (Object.keys(value).length > 10)
    throw new BadRequestException('认证请求头最多 10 项')
  const headers: Record<string, string> = {}
  for (const [key, content] of Object.entries(value)) {
    checkHeaderName(key)
    if (
      !names.some(name => name.toLowerCase() === key.toLowerCase())
      || typeof content !== 'string'
      || content.length > 4000
      || /[\r\n\0]/.test(content)
    ) {
      throw new BadRequestException('认证请求头的值无效')
    }
    headers[key.toLowerCase()] = content.trim()
  }
  if (names.some(name => !headers[name.toLowerCase()]))
    throw new BadRequestException('请填写全部认证请求头')
  return headers
}

export function checkIcon(value: string | null | undefined): string | null {
  if (!value)
    return null
  const encoded = /^data:image\/png;base64,([A-Za-z0-9+/]+={0,2})$/.exec(value)?.[1]
  if (!encoded)
    throw new BadRequestException('图标必须为 PNG 图片')
  const image = Buffer.from(encoded, 'base64')
  if (
    image.toString('base64') !== encoded
    || image.length < 33
    || image.length > 64 * 1024
    || !matchesFileSignature('icon.png', image)
    || image.subarray(12, 16).toString() !== 'IHDR'
    || image.readUInt32BE(16) < 1
    || image.readUInt32BE(16) > 256
    || image.readUInt32BE(20) < 1
    || image.readUInt32BE(20) > 256
  ) {
    throw new BadRequestException('图标须为 256 × 256 以内、64 KiB 以内的 PNG')
  }
  return value
}

export function parseMcpImport(json: string): Array<{ config: McpPluginInput, headers: Record<string, string> }> {
  let input: unknown
  try {
    input = JSON.parse(json)
  }
  catch {
    throw new BadRequestException('JSON 格式不正确')
  }
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new BadRequestException('请提供包含 mcpServers 的 JSON 对象')
  const servers = (input as Record<string, unknown>).mcpServers
  if (
    !servers
    || typeof servers !== 'object'
    || Array.isArray(servers)
    || Object.keys(servers).length < 1
    || Object.keys(servers).length > 20
  ) {
    throw new BadRequestException('mcpServers 需包含 1–20 个服务')
  }
  return Object.entries(servers).map(([name, raw]) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw))
      throw new BadRequestException('服务配置必须为对象')
    const item = raw as Record<string, unknown>
    if (
      Object.keys(item).some(key => !['url', 'type', 'headers', 'oauth'].includes(key))
      || (item.type !== undefined && !['http', 'streamable-http', 'remote'].includes(String(item.type)))
    ) {
      throw new BadRequestException('仅支持远端 HTTP 配置；command、环境变量及旧 SSE 等配置暂不支持')
    }
    if (typeof item.url !== 'string')
      throw new BadRequestException('服务缺少 URL')
    const url = mcpUrl(item.url).toString()
    const headers = item.headers ?? {}
    if (typeof headers !== 'object' || Array.isArray(headers) || headers === null) {
      throw new BadRequestException('headers 必须为对象')
    }
    const headerNames = Object.keys(headers)
    const checkedHeaders = checkHeaders(headers as Record<string, string>, headerNames)
    if (Object.values(checkedHeaders).some(value => /\$\{|\{\{|\$env/.test(value))) {
      throw new BadRequestException('不支持环境变量引用，请填写实际凭据')
    }
    const oauth = item.oauth
    if (
      oauth !== undefined
      && oauth !== false
      && (typeof oauth !== 'object' || oauth === null || Array.isArray(oauth))
    ) {
      throw new BadRequestException('OAuth 配置无效')
    }
    const options = (oauth || {}) as Record<string, unknown>
    if (
      Object.keys(options).some(key => !['clientId', 'clientSecret', 'scope'].includes(key))
      || Object.values(options).some(value => typeof value !== 'string')
      || (oauth && headerNames.length)
    ) {
      throw new BadRequestException('OAuth 配置包含不支持的字段，或与密钥认证冲突')
    }
    return {
      config: {
        name,
        description: '',
        url,
        authType: oauth ? 'oauth' : headerNames.length ? 'headers' : 'none',
        headerNames,
        oauthClientId: (options.clientId as string) ?? '',
        ...(options.clientSecret ? { oauthClientSecret: options.clientSecret as string } : {}),
        oauthScopes: (options.scope as string) ?? '',
      },
      headers: checkedHeaders,
    }
  })
}
