import type { McpTool } from '@agent/contracts'
import type { CallToolResult, FetchLike, OAuthClientProvider } from '@modelcontextprotocol/client'
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { Ajv2020 } from 'ajv/dist/2020.js'
import { mcpFetch } from './mcp-network.js'

export function compileMcpSchema(schema: Record<string, unknown>) {
  if (JSON.stringify(schema).length > 24_000)
    throw new Error('工具参数规格过大')
  const active = new Set<object>()
  const checked = new Set<object>()
  const visit = (value: unknown, depth: number): void => {
    if (depth > 20)
      throw new Error('工具参数规格嵌套过深')
    if (!value || typeof value !== 'object')
      return
    if (active.has(value))
      throw new Error('暂不支持递归参数引用')
    if (checked.has(value))
      return
    active.add(value)
    for (const [key, child] of Object.entries(value)) {
      // 自定义服务的正则可能阻塞 Node 主线程；首版明确拒绝，不放宽校验后执行。
      if (['pattern', 'patternProperties', '$data'].includes(key))
        throw new Error('暂不支持含正则或动态表达式的参数规格')
      if (key === '$dynamicRef' || key === '$recursiveRef' || (key === '$id' && value !== schema))
        throw new Error('暂不支持动态引用或嵌套 schema 身份')
      if (key === '$ref') {
        if (typeof child !== 'string' || !child.startsWith('#/'))
          throw new Error('不支持远端或根递归参数引用')
        let target: unknown = schema
        for (const segment of decodeURIComponent(child.slice(2)).split('/')) {
          const name = segment.replaceAll('~1', '/').replaceAll('~0', '~')
          if (!target || typeof target !== 'object' || !Object.hasOwn(target, name))
            throw new Error('参数引用目标不存在')
          target = (target as Record<string, unknown>)[name]
        }
        // $ref 可以把 examples/default 等位置的对象变成 schema，必须按同样规则校验目标。
        visit(target, depth + 1)
      }
      // properties/$defs 的键是用户参数名，const/default/enum 中的对象是数据，都不是 schema 关键字。
      if (
        ['properties', '$defs', 'definitions', 'dependentSchemas', 'dependencies'].includes(key)
        && child
        && typeof child === 'object'
      ) {
        for (const nested of Object.values(child)) {
          if (!Array.isArray(nested))
            visit(nested, depth + 1)
        }
      }
      else if (['allOf', 'anyOf', 'oneOf', 'prefixItems'].includes(key) && Array.isArray(child)) {
        child.forEach(nested => visit(nested, depth + 1))
      }
      else if (
        [
          'items',
          'contains',
          'additionalProperties',
          'unevaluatedProperties',
          'unevaluatedItems',
          'propertyNames',
          'not',
          'if',
          'then',
          'else',
          'contentSchema',
        ].includes(key)
      ) {
        visit(child, depth + 1)
      }
    }
    active.delete(value)
    checked.add(value)
  }
  visit(schema, 0)
  // 不加载远端 $ref，不改写模型参数；format 属于注解，基本类型与结构仍严格验证。
  return new Ajv2020({
    strict: false,
    validateFormats: false,
    allErrors: false,
  }).compile(schema)
}

export async function withMcpClient<T>(
  url: string,
  headers: Record<string, string>,
  provider: OAuthClientProvider | undefined,
  signal: AbortSignal,
  operation: (client: Client) => Promise<T>,
  fetcher: FetchLike = mcpFetch,
): Promise<T> {
  const client = new Client(
    { name: 'Kuro', version: '1.0.0' },
    {
      capabilities: {},
      versionNegotiation: { mode: 'auto' },
      jsonSchemaValidator: {
        getValidator<TValue>(schema: Record<string, unknown>) {
          const validate = compileMcpSchema(schema)
          return (input: unknown) =>
            validate(input)
              ? {
                  valid: true as const,
                  data: input as TValue,
                  errorMessage: undefined,
                }
              : {
                  valid: false as const,
                  data: undefined,
                  errorMessage: 'MCP 返回内容与声明的规格不一致',
                }
        },
      },
    },
  )
  const transport = new StreamableHTTPClientTransport(new URL(url), {
    requestInit: { headers, redirect: 'error', signal },
    ...(provider ? { authProvider: provider } : {}),
    fetch: fetcher,
    onInsufficientScope: 'throw',
    reconnectionOptions: {
      maxRetries: 0,
      initialReconnectionDelay: 1000,
      maxReconnectionDelay: 1000,
      reconnectionDelayGrowFactor: 1,
    },
  })
  const abort = () => {
    void client.close().catch(() => {})
  }
  signal.throwIfAborted()
  signal.addEventListener('abort', abort, { once: true })
  try {
    await client.connect(transport, { timeout: 15_000 })
    signal.throwIfAborted()
    return await operation(client)
  }
  finally {
    signal.removeEventListener('abort', abort)
    await client.close().catch(() => {})
  }
}

export async function discoverMcpTools(client: Client, signal: AbortSignal): Promise<McpTool[]> {
  const tools: McpTool[] = []
  const cursors = new Set<string>()
  // 显式 cursor 使用单页 API，避免 SDK 自动遍历时接受无限目录。
  let cursor = ''
  for (let page = 0; page < 10; page++) {
    const result = await client.listTools({ cursor }, { signal, timeout: 15_000 })
    for (const tool of result.tools) {
      if (!tool.name || tool.name.length > 128 || tools.some(item => item.name === tool.name)) {
        throw new Error('工具目录存在无效或重复名称')
      }
      if (tool.inputSchema.type !== 'object')
        throw new Error('工具参数必须为对象')
      compileMcpSchema(tool.inputSchema)
      tools.push({
        name: tool.name,
        description: (tool.description ?? '').slice(0, 4000),
        inputSchema: tool.inputSchema,
      })
    }
    if (tools.length > 100 || JSON.stringify(tools).length > 200_000)
      throw new Error('插件工具目录超过限制')
    if (!result.nextCursor)
      return tools
    if (result.nextCursor.length > 2048 || cursors.has(result.nextCursor))
      throw new Error('工具目录分页无效')
    cursor = result.nextCursor
    cursors.add(cursor)
  }
  throw new Error('插件工具目录超过页数限制')
}

export function mcpResultText(result: CallToolResult): string {
  const parts: string[] = []
  for (const block of result.content ?? []) {
    if (block.type === 'text')
      parts.push(block.text)
    else parts.push(`[暂不支持内联读取 ${block.type} 类型的工具结果]`)
  }
  if (result.structuredContent !== undefined)
    parts.push(JSON.stringify(result.structuredContent))
  return parts.join('\n') || (result.isError ? 'MCP 工具返回执行失败。' : '工具执行完成，未返回正文。')
}
