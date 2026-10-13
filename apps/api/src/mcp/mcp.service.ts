import type { McpConnectResult, McpPlugin, McpPluginInput, McpTool } from '@agent/contracts'
import type {
  OAuthClientProvider,
  OAuthDiscoveryState,
  StoredOAuthClientInformation,
  StoredOAuthTokens,
} from '@modelcontextprotocol/client'
import type { McpConnection, McpPlugin as PluginRow, Prisma } from '../generated/prisma/client.js'
import type { RegisteredTool } from '../tools/core/tool.types.js'
import { createHash, randomBytes } from 'node:crypto'
import process from 'node:process'
import {
  auth,
  InsufficientScopeError,
  OAuthError,
  SdkHttpError,
  UnauthorizedError,
} from '@modelcontextprotocol/client'
import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common'
import { readAppOrigins } from '../auth/auth.guard.js'
import { createApiKeyCipher } from '../llm/api-key-cipher.js'
import { resolveLlmEnvConfig } from '../llm/llm-runtime-config.service.js'
import { PrismaService } from '../prisma/prisma.service.js'
import { compileMcpSchema, discoverMcpTools, mcpResultText, withMcpClient } from './mcp-client.js'
import { checkHeaderName, checkHeaders, checkIcon, mcpUrl } from './mcp-config.js'
import { mcpFetch } from './mcp-network.js'

interface Credentials {
  headers?: Record<string, string>
  client?: StoredOAuthClientInformation
  tokens?: StoredOAuthTokens
  verifier?: string
  discovery?: OAuthDiscoveryState
}
type Connection = McpConnection & { plugin: PluginRow }
export interface RunMcpTools {
  tools: Map<string, RegisteredTool>
  snapshot: Array<{
    pluginId: string
    pluginName: string
    name: string
    remoteName: string
    description: string
    inputSchema: Record<string, unknown>
  }>
}

@Injectable()
export class McpService {
  private readonly cipher = createApiKeyCipher(resolveLlmEnvConfig(process.env).secretKey)

  // shortcut: 令牌刷新在当前单实例内串行；增加 API 副本前改用数据库级互斥。
  private readonly pending = new Map<string, Promise<unknown>>()
  readonly callbackUrl = `${readAppOrigins()[0]}/api/mcp/oauth/callback`
  // 注入出口仅供实际协议测试替换；生产始终使用公网校验出口。
  readonly fetch = mcpFetch

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async list(userId: string, admin = false): Promise<McpPlugin[]> {
    const plugins = await this.prisma.mcpPlugin.findMany({
      where: admin
        ? { userId: null }
        : {
            OR: [
              { userId },
              {
                userId: null,
                OR: [{ enabled: true }, { connections: { some: { userId } } }],
              },
            ],
          },
      include: { connections: { where: { userId } } },
      orderBy: { createdAt: 'asc' },
    })
    return plugins.map(plugin => this.view(plugin, plugin.connections[0], admin))
  }

  async detail(userId: string, id: string, admin = false): Promise<McpPlugin> {
    const plugin = await this.plugin(userId, id, admin)
    const connection = await this.prisma.mcpConnection.findUnique({
      where: { userId_pluginId: { userId, pluginId: id } },
    })
    return this.view(plugin, connection, admin)
  }

  async save(userId: string, input: McpPluginInput, id?: string, admin = false): Promise<McpPlugin> {
    const name = input.name.trim()
    if (!name)
      throw new BadRequestException('请输入插件名称')
    const url = mcpUrl(input.url.trim()).toString()
    input.headerNames.forEach(checkHeaderName)
    if (new Set(input.headerNames.map(name => name.toLowerCase())).size !== input.headerNames.length) {
      throw new BadRequestException('认证请求头名称重复')
    }
    if (input.authType === 'headers' && !input.headerNames.length)
      throw new BadRequestException('请添加至少一个认证请求头名称')
    const oauthClientId = input.oauthClientId?.trim() ?? ''
    const oauthScopes = input.oauthScopes?.trim() ?? ''
    if (admin && input.headers) {
      throw new BadRequestException('系统目录不保存共享用户凭据，请使用连接测试入口')
    }
    if (input.authType !== 'headers' && input.headers && Object.keys(input.headers).length)
      throw new BadRequestException('仅密钥认证方式可保存认证请求头')
    const headers
      = input.authType === 'headers' && input.headers ? checkHeaders(input.headers, input.headerNames) : undefined
    const data = {
      name,
      description: input.description.trim(),
      url,
      icon: checkIcon(input.icon),
      authType: input.authType,
      headerNames: input.authType === 'headers' ? input.headerNames : [],
      oauthClientId: input.authType === 'oauth' ? oauthClientId : '',
      oauthScopes: input.authType === 'oauth' ? oauthScopes : '',
    }
    const plugin = await this.prisma.$transaction(async (tx) => {
      if (id)
        await tx.$queryRaw`SELECT id FROM "McpPlugin" WHERE id = ${id} FOR UPDATE`
      const existing = id ? await this.plugin(userId, id, admin, true, tx) : undefined
      const identityChanged = existing && (url !== existing.url || oauthClientId !== existing.oauthClientId)
      const secret
        = input.oauthClientSecret === undefined
          ? identityChanged
            ? null
            : (existing?.oauthClientSecret ?? null)
          : input.oauthClientSecret
            ? this.cipher.encrypt(input.oauthClientSecret)
            : null
      const credentialsChanged
        = existing
          && (url !== existing.url
            || input.authType !== existing.authType
            || JSON.stringify(input.headerNames) !== JSON.stringify(existing.headerNames)
            || oauthClientId !== existing.oauthClientId
            || oauthScopes !== existing.oauthScopes
            || input.oauthClientSecret !== undefined)
      const write = { ...data, oauthClientSecret: input.authType === 'oauth' ? secret : null }
      const row = existing
        ? await tx.mcpPlugin.update({ where: { id: existing.id }, data: write })
        : await tx.mcpPlugin.create({
            data: { ...write, userId: admin ? null : userId },
          })
      if (credentialsChanged) {
        await tx.mcpConnection.updateMany({
          where: { pluginId: row.id },
          data: this.disconnected(),
        })
      }
      if (headers) {
        await tx.mcpConnection.upsert({
          where: { userId_pluginId: { userId, pluginId: row.id } },
          create: {
            userId,
            pluginId: row.id,
            credentials: this.cipher.encrypt(JSON.stringify({ headers })),
          },
          update: {
            ...this.disconnected(),
            credentials: this.cipher.encrypt(JSON.stringify({ headers })),
          },
        })
      }
      return row
    })
    return this.detail(userId, plugin.id, admin)
  }

  async remove(userId: string, id: string, admin = false) {
    await this.plugin(userId, id, admin, true)
    await this.prisma.mcpPlugin.delete({ where: { id } })
    return { id }
  }

  async toggleSystem(userId: string, id: string, enabled: boolean) {
    await this.plugin(userId, id, true, true)
    await this.prisma.$transaction(async (tx) => {
      await tx.mcpPlugin.update({ where: { id }, data: { enabled } })
      if (!enabled) {
        await tx.mcpConnection.updateMany({
          where: { pluginId: id },
          data: {
            enabled: false,
            authState: null,
            authExpiresAt: null,
            revision: { increment: 1 },
          },
        })
      }
    })
    return this.detail(userId, id, true)
  }

  async setEnabled(userId: string, id: string, enabled: boolean): Promise<McpPlugin> {
    const plugin = await this.plugin(userId, id)
    if (enabled && !plugin.enabled)
      throw new BadRequestException('插件已被平台停用')
    const where = {
      userId,
      pluginId: id,
      ...(enabled ? { connected: true, needsAuth: false } : {}),
    }
    const result = await this.prisma.mcpConnection.updateMany({
      where,
      data: {
        enabled,
        revision: { increment: 1 },
        authState: null,
        authExpiresAt: null,
      },
    })
    if (enabled && !result.count)
      throw new BadRequestException('请先连接并完成授权')
    return this.detail(userId, id)
  }

  async disconnect(userId: string, id: string): Promise<McpPlugin> {
    await this.plugin(userId, id)
    await this.prisma.mcpConnection.updateMany({
      where: { userId, pluginId: id },
      data: this.disconnected(),
    })
    return this.detail(userId, id)
  }

  async connect(
    userId: string,
    id: string,
    headers?: Record<string, string>,
    admin = false,
    expectedRevision?: string,
  ): Promise<McpConnectResult> {
    return this.serial(`${userId}:${id}`, async () => {
      const state = randomBytes(32).toString('hex')
      const connection = await this.prisma.$transaction(async (tx) => {
        // 与配置写入使用同一行锁，不能组合旧服务身份和新连接 revision。
        await tx.$queryRaw`SELECT id FROM "McpPlugin" WHERE id = ${id} FOR UPDATE`
        const plugin = await this.plugin(userId, id, admin, false, tx)
        if (expectedRevision && expectedRevision !== configRevision(plugin))
          throw new ConflictException('插件配置已变化，请刷新核对后再连接')
        if (!plugin.enabled && !admin)
          throw new BadRequestException('插件已停用')
        const row = await tx.mcpConnection.upsert({
          where: { userId_pluginId: { userId, pluginId: id } },
          create: { userId, pluginId: id, authState: hash(state), authExpiresAt: new Date(Date.now() + 600_000) },
          update: {
            enabled: false,
            connected: false,
            revision: { increment: 1 },
            authState: hash(state),
            authExpiresAt: new Date(Date.now() + 600_000),
          },
        })
        return { ...row, plugin }
      })
      const { plugin } = connection
      const credentials = this.credentials(connection)
      if (plugin.authType === 'headers') {
        credentials.headers = checkHeaders(headers ?? credentials.headers ?? {}, plugin.headerNames)
      }
      await this.saveCredentials(connection, credentials)
      let authorizationUrl: string | undefined
      const provider
        = plugin.authType === 'oauth'
          ? this.provider(connection, credentials, state, async (url) => {
              mcpUrl(url.href)
              authorizationUrl = url.href
            })
          : undefined
      try {
        if (
          provider
          && (await auth(provider, {
            serverUrl: plugin.url,
            ...(plugin.oauthScopes ? { scope: plugin.oauthScopes } : {}),
            fetchFn: this.fetch,
          })) === 'REDIRECT'
        ) {
          if (!authorizationUrl)
            throw new Error('missing redirect')
          return {
            authorizationUrl,
            plugin: await this.detail(userId, id, admin),
          }
        }
        const tools = await this.discover(connection, credentials, provider)
        await this.accept(connection, tools, !admin)
        return { plugin: await this.detail(userId, id, admin) }
      }
      catch (error) {
        if (needsAuthorization(error))
          await this.markNeedsAuth(connection)
        throw new BadRequestException('连接失败，请核对服务地址、凭据和 OAuth 应用配置后重试')
      }
    })
  }

  async callback(userId: string, params: URLSearchParams): Promise<void> {
    const state = params.get('state')
    if (!state || state.length > 256)
      throw new BadRequestException('授权已失效，请重新连接')
    const row = await this.prisma.mcpConnection.findFirst({
      where: {
        userId,
        authState: hash(state),
        authExpiresAt: { gt: new Date() },
      },
      include: { plugin: true },
    })
    if (!row)
      throw new BadRequestException('授权已失效，请重新连接')
    await this.serial(`${userId}:${row.pluginId}`, async () => {
      const consumed = await this.prisma.mcpConnection.updateMany({
        where: {
          id: row.id,
          revision: row.revision,
          authState: hash(state),
          authExpiresAt: { gt: new Date() },
        },
        data: { authState: null, authExpiresAt: null },
      })
      if (!consumed.count)
        throw new BadRequestException('授权已使用或已取消')
      if (!row.plugin.enabled || params.has('error') || !params.get('code'))
        throw new BadRequestException('授权未完成，请重新连接')
      const credentials = this.credentials(row)
      const provider = this.provider(row, credentials, state)
      try {
        await auth(provider, {
          serverUrl: row.plugin.url,
          authorizationCode: params.get('code')!,
          ...(params.get('iss') ? { iss: params.get('iss')! } : {}),
          fetchFn: this.fetch,
        })
        const tools = await this.discover(row, credentials, provider)
        await this.accept(row, tools, true)
      }
      catch {
        await this.markNeedsAuth(row)
        throw new BadRequestException('授权连接失败，请重新连接')
      }
    })
  }

  async snapshot(userId: string, signal?: AbortSignal): Promise<RunMcpTools> {
    const rows = await this.prisma.mcpConnection.findMany({
      where: {
        userId,
        enabled: true,
        connected: true,
        needsAuth: false,
        plugin: { enabled: true, OR: [{ userId: null }, { userId }] },
      },
      include: { plugin: true },
    })
    if (rows.length > 10)
      throw new BadRequestException('请将启用的插件减少到 10 个以内')
    const result: RunMcpTools = { tools: new Map(), snapshot: [] }
    for (const row of rows) {
      signal?.throwIfAborted()
      const tools = await this.serial(`${userId}:${row.pluginId}`, async () => {
        const current = await this.activeConnection(row.id, row.revision)
        const credentials = this.credentials(current)
        try {
          const tools = await this.discover(current, credentials, this.oauthProvider(current, credentials), signal)
          await this.prisma.mcpConnection.updateMany({
            where: { id: row.id, revision: row.revision },
            data: { tools: tools as unknown as Prisma.InputJsonValue },
          })
          return tools
        }
        catch (error) {
          if (needsAuthorization(error))
            await this.markNeedsAuth(current)
          signal?.throwIfAborted()
          throw new BadRequestException(`插件「${row.plugin.name}」暂不可用，请在插件页检查连接或停用后重试`)
        }
      })
      for (const tool of tools) {
        const name = `mcp_${hash(row.pluginId).slice(0, 8)}_${tool.name.replace(/[^\w-]/g, '_').slice(0, 32)}_${hash(tool.name).slice(0, 8)}`
        const validate = compileMcpSchema(tool.inputSchema)
        const description = `${row.plugin.name} · ${tool.name}\n${tool.description}`
        result.snapshot.push({
          pluginId: row.pluginId,
          pluginName: row.plugin.name,
          name,
          remoteName: tool.name,
          description,
          inputSchema: tool.inputSchema,
        })
        result.tools.set(name, {
          definition: {
            name,
            version: '1',
            description,
            input: {
              schema: tool.inputSchema as RegisteredTool['definition']['input']['schema'],
              parse: (input) => {
                if (!validate(input))
                  throw new Error('invalid MCP arguments')
                return input
              },
            },
            timeoutMs: 30_000,
            maxObservationChars: 30_000,
          },
          executor: {
            execute: async ({ input }, context) =>
              this.invoke(row, tool.name, input as Record<string, unknown>, context.signal),
          },
        })
      }
    }
    return result
  }

  private async invoke(row: Connection, name: string, input: Record<string, unknown>, signal: AbortSignal) {
    return this.serial(`${row.userId}:${row.pluginId}`, async () => {
      signal.throwIfAborted()
      const current = await this.activeConnection(row.id, row.revision)
      const credentials = this.credentials(current)
      try {
        return await withMcpClient(
          current.plugin.url,
          credentials.headers ?? {},
          this.oauthProvider(current, credentials),
          signal,
          async (client) => {
            await this.activeConnection(row.id, row.revision)
            signal.throwIfAborted()
            const result = await client.callTool(
              { name, arguments: input },
              { signal, timeout: 30_000, resetTimeoutOnProgress: false },
            )
            const content = this.redact(mcpResultText(result), current, credentials)
            return result.isError
              ? {
                  ok: false as const,
                  code: 'execution_failed' as const,
                  modelContent: content,
                }
              : {
                  ok: true as const,
                  modelContent: content,
                  display: { title: `${row.plugin.name} · ${name}` },
                }
          },
          this.fetch,
        )
      }
      catch (error) {
        if (signal.aborted)
          throw signal.reason
        if (needsAuthorization(error))
          await this.markNeedsAuth(current)
        return {
          ok: false as const,
          code: 'execution_failed' as const,
          modelContent: '插件调用未成功确认。请核对连接；如果涉及写入，结果可能未知，不要自动重复执行同一操作。',
        }
      }
    })
  }

  private async discover(
    row: Connection,
    credentials: Credentials,
    provider?: OAuthClientProvider,
    signal?: AbortSignal,
  ) {
    const deadline = AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(30_000)])
    return withMcpClient(
      row.plugin.url,
      credentials.headers ?? {},
      provider,
      deadline,
      async (client) => {
        const tools = await discoverMcpTools(client, deadline)
        const serialized = JSON.stringify(tools)
        if (this.redact(serialized, row, credentials) !== serialized)
          throw new BadRequestException('服务在工具目录中返回了认证凭据，已拒绝加载')
        return tools
      },
      this.fetch,
    )
  }

  private oauthProvider(row: Connection, credentials: Credentials) {
    return row.plugin.authType === 'oauth' ? this.provider(row, credentials, '') : undefined
  }

  private provider(
    row: Connection,
    credentials: Credentials,
    state: string,
    redirect?: (url: URL) => Promise<void>,
  ): OAuthClientProvider {
    const persist = () => this.saveCredentials(row, credentials)
    return {
      redirectUrl: this.callbackUrl,
      clientMetadata: {
        client_name: 'Kuro',
        redirect_uris: [this.callbackUrl],
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        token_endpoint_auth_method: row.plugin.oauthClientSecret ? 'client_secret_post' : 'none',
        ...(row.plugin.oauthScopes ? { scope: row.plugin.oauthScopes } : {}),
      },
      state: () => state,
      clientInformation: ctx =>
        row.plugin.oauthClientId
          ? {
              client_id: row.plugin.oauthClientId,
              ...(row.plugin.oauthClientSecret
                ? {
                    client_secret: this.cipher.decrypt(row.plugin.oauthClientSecret),
                  }
                : {}),
              ...(ctx ? { issuer: ctx.issuer } : {}),
            }
          : !ctx || credentials.client?.issuer === ctx.issuer
              ? credentials.client
              : undefined,
      saveClientInformation: async (client) => {
        credentials.client = client
        await persist()
      },
      tokens: ctx => (ctx && credentials.tokens?.issuer !== ctx.issuer ? undefined : credentials.tokens),
      saveTokens: async (tokens) => {
        credentials.tokens = tokens
        try {
          await persist()
        }
        catch {
          await this.markNeedsAuth(row).catch(() => {})
          throw new UnauthorizedError('授权凭据未能保存，请重新连接')
        }
      },
      redirectToAuthorization: async (url) => {
        if (!redirect) {
          await this.markNeedsAuth(row)
          throw new UnauthorizedError('需要重新连接插件')
        }
        await redirect(url)
      },
      saveCodeVerifier: async (value) => {
        credentials.verifier = value
        await persist()
      },
      codeVerifier: () => {
        if (!credentials.verifier)
          throw new Error('missing verifier')
        return credentials.verifier
      },
      saveDiscoveryState: async (value) => {
        credentials.discovery = value
        await persist()
      },
      discoveryState: () => credentials.discovery,
      invalidateCredentials: async (scope) => {
        if (scope === 'all' || scope === 'tokens')
          delete credentials.tokens
        if (scope === 'all' || scope === 'client')
          delete credentials.client
        if (scope === 'all' || scope === 'verifier')
          delete credentials.verifier
        if (scope === 'all' || scope === 'discovery')
          delete credentials.discovery
        await persist()
      },
    }
  }

  private async saveCredentials(row: Connection, credentials: Credentials) {
    const saved = await this.prisma.mcpConnection.updateMany({
      where: { id: row.id, revision: row.revision },
      data: { credentials: this.cipher.encrypt(JSON.stringify(credentials)) },
    })
    if (!saved.count)
      throw new ConflictException('连接状态已变化，请刷新核对')
  }

  private async accept(row: Connection, tools: McpTool[], enabled: boolean) {
    const saved = await this.prisma.mcpConnection.updateMany({
      where: { id: row.id, revision: row.revision },
      data: {
        connected: true,
        enabled,
        needsAuth: false,
        authState: null,
        authExpiresAt: null,
        tools: tools as unknown as Prisma.InputJsonValue,
      },
    })
    if (!saved.count)
      throw new ConflictException('连接状态已变化，请刷新核对')
  }

  private async markNeedsAuth(row: Connection) {
    await this.prisma.mcpConnection.updateMany({
      where: { id: row.id, revision: row.revision },
      data: { needsAuth: row.plugin.authType !== 'none' },
    })
  }

  private credentials(row: McpConnection): Credentials {
    return row.credentials ? (JSON.parse(this.cipher.decrypt(row.credentials)) as Credentials) : {}
  }

  private redact(text: string, row: Connection, credentials: Credentials): string {
    const secrets = [
      ...Object.values(credentials.headers ?? {}).flatMap(value => [value, value.replace(/^Bearer\s+/i, '')]),
      credentials.tokens?.access_token,
      credentials.tokens?.refresh_token,
      credentials.client?.client_secret,
      row.plugin.oauthClientSecret ? this.cipher.decrypt(row.plugin.oauthClientSecret) : undefined,
    ]
    for (const secret of secrets) {
      if (secret)
        text = text.replaceAll(secret, '[REDACTED]')
    }
    return text
  }

  private async activeConnection(id: string, revision: number): Promise<Connection> {
    const row = await this.prisma.mcpConnection.findFirst({
      where: {
        id,
        revision,
        enabled: true,
        connected: true,
        needsAuth: false,
        plugin: { enabled: true },
      },
      include: { plugin: true },
    })
    if (!row)
      throw new ConflictException('插件连接已停用或断开')
    return row
  }

  private async plugin(
    userId: string,
    id: string,
    admin = false,
    write = false,
    database: Prisma.TransactionClient = this.prisma,
  ): Promise<PluginRow> {
    const row = await database.mcpPlugin.findFirst({
      where: {
        id,
        ...(admin
          ? { userId: null }
          : write
            ? { userId }
            : {
                OR: [
                  { userId },
                  {
                    userId: null,
                    OR: [{ enabled: true }, { connections: { some: { userId } } }],
                  },
                ],
              }),
      },
    })
    if (!row)
      throw new NotFoundException('插件不存在或不可用')
    return row
  }

  private view(row: PluginRow, connection?: McpConnection | null, admin = false): McpPlugin {
    return {
      id: row.id,
      configRevision: configRevision(row),
      name: row.name,
      description: row.description,
      url: row.url,
      icon: row.icon,
      system: row.userId === null,
      available: row.enabled,
      authType: row.authType as McpPlugin['authType'],
      headerNames: row.headerNames,
      oauthClientId: admin || row.userId ? row.oauthClientId : '',
      oauthScopes: row.oauthScopes,
      hasClientSecret: !!row.oauthClientSecret,
      connected: !!connection?.connected,
      enabled: !!connection?.enabled,
      needsAuth: !!connection?.needsAuth,
      tools: (connection?.tools ?? []) as unknown as McpTool[],
    }
  }

  private disconnected() {
    return {
      enabled: false,
      connected: false,
      needsAuth: false,
      credentials: null,
      tools: [] as Prisma.InputJsonValue,
      authState: null,
      authExpiresAt: null,
      revision: { increment: 1 },
    }
  }

  private async serial<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.pending.get(key)
    const current = (async () => {
      await previous?.catch(() => {})
      return operation()
    })()
    this.pending.set(key, current)
    try {
      return await current
    }
    finally {
      if (this.pending.get(key) === current)
        this.pending.delete(key)
    }
  }
}

function configRevision(plugin: PluginRow): string {
  return hash(JSON.stringify([plugin.url, plugin.authType, plugin.headerNames, plugin.oauthClientId, plugin.oauthClientSecret, plugin.oauthScopes]))
}

function hash(value: string) {
  return createHash('sha256').update(value).digest('hex')
}

function needsAuthorization(error: unknown) {
  return (
    error instanceof UnauthorizedError
    || error instanceof InsufficientScopeError
    || error instanceof OAuthError
    || (error instanceof SdkHttpError && [401, 403].includes(error.status))
  )
}
