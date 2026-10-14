import type { GoogleDataConnection, GoogleDataResource, GoogleDataSelection, GoogleDataVerification, GoogleDataService as Service } from '@agent/contracts'
import type { AuthContext } from '../auth/auth.decorators.js'
import type { GoogleDataConnection as Connection } from '../generated/prisma/client.js'
import { createHash, randomBytes } from 'node:crypto'
import process from 'node:process'
import { BadRequestException, ConflictException, Inject, Injectable } from '@nestjs/common'
import { readAppOrigins } from '../auth/auth.guard.js'
import { createApiKeyCipher } from '../llm/api-key-cipher.js'
import { resolveLlmEnvConfig } from '../llm/llm-runtime-config.service.js'
import { PrismaService } from '../prisma/prisma.service.js'
import { GOOGLE_DATA_SCOPES, GOOGLE_DATA_URLS, GoogleDataClient, GoogleDataError, rows, text } from './google-data-client.js'

interface Tokens { access: string, refresh: string, expires: number }
interface Pending { verifier: string, session: string, services: Service[], configHash: string }
const hash = (value: string) => createHash('sha256').update(value).digest('hex')
const selection = (row?: Connection | null): GoogleDataSelection => ({ gscSite: row?.gscSite ?? null, ga4Property: row?.ga4Property ?? null, ga4Stream: row?.ga4Stream ?? null })

@Injectable()
export class GoogleDataService {
  private readonly cipher = createApiKeyCipher(resolveLlmEnvConfig(process.env).secretKey)
  readonly callbackUrl = `${readAppOrigins()[0]}/api/google-data/oauth/callback`
  private readonly configHash = hash(`${process.env.GOOGLE_DATA_CLIENT_ID ?? ''}\0${process.env.GOOGLE_DATA_CLIENT_SECRET ?? ''}\0${this.callbackUrl}`)
  // shortcut: 单实例内合并刷新；部署多个 API 副本前改用数据库互斥。
  private readonly refreshing = new Map<string, Promise<Connection>>()

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService, @Inject(GoogleDataClient) private readonly client: GoogleDataClient) {}

  async detail(userId: string): Promise<GoogleDataConnection> {
    const row = await this.prisma.googleDataConnection.findUnique({ where: { userId } })
    const validConfig = row?.configHash === this.configHash
    return {
      configured: this.client.configured,
      connected: !!row?.credentials,
      needsAuth: !!row?.credentials && (!validConfig || !!row.needsAuth),
      authorizing: !!(row?.pending && row.authExpiresAt && row.authExpiresAt.getTime() > Date.now()),
      email: row?.email ?? null,
      services: row ? this.services(row) : [],
      selection: selection(row),
      revision: row?.revision ?? 0,
    }
  }

  async start(auth: AuthContext, services: Service[]) {
    if (!this.client.configured)
      throw new BadRequestException('notConfigured')
    const state = randomBytes(32).toString('base64url')
    const verifier = randomBytes(48).toString('base64url')
    const pending: Pending = { verifier, session: hash(auth.sessionId), services, configHash: this.configHash }
    const data = {
      authState: hash(state),
      authExpiresAt: new Date(Date.now() + 600_000),
      pending: this.cipher.encrypt(JSON.stringify(pending)),
    }
    await this.prisma.googleDataConnection.upsert({
      where: { userId: auth.user.id },
      create: { userId: auth.user.id, configHash: this.configHash, revision: 1, ...data },
      update: { ...data, revision: { increment: 1 } },
    })
    const url = new URL(GOOGLE_DATA_URLS.authorize)
    url.search = new URLSearchParams({
      client_id: this.client.clientId,
      redirect_uri: this.callbackUrl,
      response_type: 'code',
      scope: ['openid', 'email', ...services.map(service => GOOGLE_DATA_SCOPES[service])].join(' '),
      state,
      code_challenge: createHash('sha256').update(verifier).digest('base64url'),
      code_challenge_method: 'S256',
      access_type: 'offline',
      prompt: 'consent select_account',
    }).toString()
    return { authorizationUrl: url.toString() }
  }

  async callback(auth: AuthContext, query: { state?: string, code?: string, error?: string }) {
    if (!this.client.configured || !query.state || query.state.length > 256)
      throw new BadRequestException('authorizationFailed')
    const row = await this.prisma.googleDataConnection.findFirst({ where: { userId: auth.user.id, authState: hash(query.state) } })
    if (!row?.pending || !row.authExpiresAt || row.authExpiresAt.getTime() <= Date.now())
      throw new BadRequestException('authorizationFailed')
    const pending = JSON.parse(this.cipher.decrypt(row.pending)) as Pending
    if (pending.session !== hash(auth.sessionId) || pending.configHash !== this.configHash)
      throw new BadRequestException('authorizationFailed')
    const claim = await this.prisma.googleDataConnection.updateMany({
      where: { userId: row.userId, revision: row.revision, authState: row.authState },
      data: { authState: null },
    })
    if (claim.count !== 1)
      throw new BadRequestException('authorizationFailed')
    try {
      if (query.error || !query.code || query.code.length > 4096)
        throw new BadRequestException('authorizationFailed')
      const result = await this.client.exchange({ code: query.code, code_verifier: pending.verifier, redirect_uri: this.callbackUrl, grant_type: 'authorization_code' })
      const scopes = text(result.scope).split(' ')
      if (!pending.services.some(service => scopes.includes(GOOGLE_DATA_SCOPES[service])))
        throw new BadRequestException('missingScope')
      const access = text(result.access_token)
      const identity = await this.client.request(GOOGLE_DATA_URLS.identity, access)
      const sub = text(identity.sub)
      const email = text(identity.email)
      if (identity.email_verified !== true)
        throw new BadRequestException('authorizationFailed')
      const previous = row.credentials && row.googleSub === sub && row.configHash === this.configHash
        ? JSON.parse(this.cipher.decrypt(row.credentials)) as Tokens
        : undefined
      const tokens = this.tokens(result, previous?.refresh)
      const updated = await this.prisma.googleDataConnection.updateMany({
        where: { userId: row.userId, revision: row.revision, pending: row.pending },
        data: {
          credentials: this.cipher.encrypt(JSON.stringify(tokens)),
          googleSub: sub,
          email,
          scopes,
          configHash: this.configHash,
          needsAuth: false,
          pending: null,
          authExpiresAt: null,
          revision: { increment: 1 },
          gscSite: row.googleSub === sub && scopes.includes(GOOGLE_DATA_SCOPES.gsc) ? row.gscSite : null,
          ga4Property: row.googleSub === sub && scopes.includes(GOOGLE_DATA_SCOPES.ga4) ? row.ga4Property : null,
          ga4Stream: row.googleSub === sub && scopes.includes(GOOGLE_DATA_SCOPES.ga4) ? row.ga4Stream : null,
        },
      })
      if (updated.count !== 1)
        throw new ConflictException('connectionChanged')
    }
    finally {
      await this.prisma.googleDataConnection.updateMany({ where: { userId: row.userId, revision: row.revision }, data: { pending: null, authState: null, authExpiresAt: null } })
    }
  }

  async cancel(userId: string) {
    await this.prisma.googleDataConnection.updateMany({ where: { userId }, data: { pending: null, authState: null, authExpiresAt: null, revision: { increment: 1 } } })
    return this.detail(userId)
  }

  async disconnect(userId: string) {
    // 保留递增 revision，防止断开后重新连接与旧请求发生 ABA。
    await this.prisma.googleDataConnection.updateMany({ where: { userId }, data: {
      credentials: null,
      googleSub: null,
      email: null,
      scopes: [],
      needsAuth: false,
      pending: null,
      authState: null,
      authExpiresAt: null,
      gscSite: null,
      ga4Property: null,
      ga4Stream: null,
      revision: { increment: 1 },
    } })
    return this.detail(userId)
  }

  async resources(userId: string, service: Service, property?: string) {
    const row = await this.authorized(userId, service)
    const resources = await this.list(row, service, property)
    await this.current(row)
    return resources
  }

  async select(userId: string, service: Service, revision: number, resource: string, stream?: string) {
    const row = await this.authorized(userId, service)
    if (row.revision !== revision)
      throw new ConflictException('connectionChanged')
    if (!(await this.list(row, service)).some(item => item.id === resource))
      throw new BadRequestException('invalidResource')
    if (service === 'ga4' && (!stream || !(await this.list(row, service, resource)).some(item => item.id === stream)))
      throw new BadRequestException('invalidResource')
    const changed = await this.prisma.googleDataConnection.updateMany({
      where: { userId, revision: row.revision, credentials: { not: null }, needsAuth: false, pending: null },
      data: { ...(service === 'gsc' ? { gscSite: resource } : { ga4Property: resource, ga4Stream: stream! }), revision: { increment: 1 } },
    })
    if (changed.count !== 1)
      throw new ConflictException('connectionChanged')
    return this.detail(userId)
  }

  async verify(userId: string, service: Service, revision: number): Promise<GoogleDataVerification> {
    const row = await this.authorized(userId, service)
    if (row.revision !== revision)
      throw new ConflictException('connectionChanged')
    let result: Record<string, unknown>
    if (service === 'gsc') {
      if (!row.gscSite)
        throw new BadRequestException('selectResource')
      const date = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10)
      result = await this.api(row, `${GOOGLE_DATA_URLS.gsc}/sites/${encodeURIComponent(row.gscSite)}/searchAnalytics/query`, {
        startDate: date(10),
        endDate: date(3),
        dataState: 'final',
        rowLimit: 1,
      })
    }
    else {
      if (!row.ga4Property || !row.ga4Stream)
        throw new BadRequestException('selectResource')
      result = await this.api(row, `${GOOGLE_DATA_URLS.data}/${row.ga4Property}:runReport`, {
        dateRanges: [{ startDate: '7daysAgo', endDate: 'yesterday' }],
        metrics: [{ name: 'sessions' }],
        limit: '1',
        dimensionFilter: { filter: { fieldName: 'streamId', stringFilter: { matchType: 'EXACT', value: row.ga4Stream.split('/').at(-1) } } },
      })
    }
    const hasData = rows(result.rows).length > 0
    await this.current(row)
    return { revision: row.revision, service, checkedAt: new Date().toISOString(), hasData }
  }

  private services(row: Connection): Service[] {
    return (['gsc', 'ga4'] as const).filter(service => row.scopes.includes(GOOGLE_DATA_SCOPES[service]))
  }

  private tokens(result: Record<string, unknown>, previousRefresh?: string): Tokens {
    const lifetime = result.expires_in
    if (typeof lifetime !== 'number' || !Number.isFinite(lifetime) || lifetime <= 0 || lifetime > 86_400)
      throw new GoogleDataError(502, 'invalidResponse')
    return { access: text(result.access_token), refresh: text(result.refresh_token ?? previousRefresh), expires: Date.now() + lifetime * 1000 }
  }

  private async authorized(userId: string, service: Service): Promise<Connection> {
    const row = await this.prisma.googleDataConnection.findUnique({ where: { userId } })
    if (!this.client.configured || !row?.credentials || row.needsAuth || row.configHash !== this.configHash)
      throw new BadRequestException('needsAuth')
    if (row.pending) {
      if (row.authExpiresAt && row.authExpiresAt.getTime() <= Date.now()) {
        await this.prisma.googleDataConnection.updateMany({ where: { userId, revision: row.revision }, data: { pending: null, authState: null, authExpiresAt: null, revision: { increment: 1 } } })
        throw new ConflictException('connectionChanged')
      }
      throw new ConflictException('authorizationPending')
    }
    if (!this.services(row).includes(service))
      throw new BadRequestException('missingScope')
    const tokens = JSON.parse(this.cipher.decrypt(row.credentials)) as Tokens
    if (tokens.expires > Date.now() + 60_000)
      return row
    const key = `${userId}:${row.revision}`
    let task = this.refreshing.get(key)
    if (!task) {
      task = this.refresh(row, tokens)
      this.refreshing.set(key, task)
    }
    try {
      return await task
    }
    finally {
      if (this.refreshing.get(key) === task)
        this.refreshing.delete(key)
    }
  }

  private async refresh(row: Connection, tokens: Tokens) {
    let exchanged = false
    try {
      const result = await this.client.exchange({ grant_type: 'refresh_token', refresh_token: tokens.refresh })
      exchanged = true
      const credentials = this.cipher.encrypt(JSON.stringify(this.tokens(result, tokens.refresh)))
      const changed = await this.prisma.googleDataConnection.updateMany({ where: { userId: row.userId, revision: row.revision, credentials: row.credentials, needsAuth: false }, data: { credentials } })
      if (changed.count !== 1)
        throw new ConflictException('connectionChanged')
      return { ...row, credentials }
    }
    catch (error) {
      if (exchanged && !(error instanceof ConflictException)) {
        await this.prisma.googleDataConnection.updateMany({ where: { userId: row.userId, revision: row.revision, credentials: row.credentials }, data: { needsAuth: true, revision: { increment: 1 } } })
      }
      await this.authFailure(row, error)
      throw error
    }
  }

  private async authFailure(row: Connection, error: unknown) {
    if (error instanceof GoogleDataError && error.reason === 'needsAuth') {
      await this.prisma.googleDataConnection.updateMany({ where: { userId: row.userId, revision: row.revision, credentials: row.credentials }, data: { needsAuth: true, revision: { increment: 1 } } })
    }
  }

  private async current(row: Connection) {
    const current = await this.prisma.googleDataConnection.findFirst({ where: { userId: row.userId, revision: row.revision, credentials: { not: null }, needsAuth: false, pending: null } })
    if (!current)
      throw new ConflictException('connectionChanged')
  }

  private async api(row: Connection, url: string, body?: Record<string, unknown>, signal?: AbortSignal) {
    await this.current(row)
    const tokens = JSON.parse(this.cipher.decrypt(row.credentials!)) as Tokens
    try {
      return await this.client.request(url, tokens.access, body, signal)
    }
    catch (error) {
      await this.authFailure(row, error)
      throw error
    }
  }

  private async list(row: Connection, service: Service, property?: string): Promise<GoogleDataResource[]> {
    if (service === 'gsc') {
      const result = await this.api(row, `${GOOGLE_DATA_URLS.gsc}/sites`)
      return rows(result.siteEntry).filter(item => ['siteOwner', 'siteFullUser', 'siteRestrictedUser'].includes(String(item.permissionLevel))).map(item => ({ id: text(item.siteUrl), name: text(item.siteUrl) }))
    }
    if (property && !/^properties\/\d+$/.test(property))
      throw new BadRequestException('invalidResource')
    const base = property ? `${GOOGLE_DATA_URLS.admin}/${property}/dataStreams` : `${GOOGLE_DATA_URLS.admin}/accountSummaries`
    const result: GoogleDataResource[] = []
    let pageToken = ''
    const signal = AbortSignal.timeout(30_000)
    for (let page = 0;
      page < 10;
      page++) {
      const url = new URL(base)
      url.search = new URLSearchParams({ pageSize: '200', ...(pageToken ? { pageToken } : {}) }).toString()
      const response = await this.api(row, url.toString(), undefined, signal)
      if (property) {
        for (const item of rows(response.dataStreams)) {
          if (item.type !== 'WEB_DATA_STREAM')
            continue
          const web = item.webStreamData as Record<string, unknown> | undefined
          const id = text(item.name)
          if (!new RegExp(`^${property}/dataStreams/\\d+$`).test(id))
            throw new GoogleDataError(502, 'invalidResponse')
          result.push({ id, name: text(item.displayName), ...(web?.defaultUri ? { url: text(web.defaultUri) } : {}) })
        }
      }
      else {
        for (const account of rows(response.accountSummaries)) {
          for (const item of rows(account.propertySummaries)) {
            const id = text(item.property)
            if (!/^properties\/\d+$/.test(id))
              throw new GoogleDataError(502, 'invalidResponse')
            result.push({ id, name: text(item.displayName) })
          }
        }
      }
      if (result.length > 1000)
        throw new GoogleDataError(502, 'tooManyResources')
      if (!response.nextPageToken)
        return result
      pageToken = text(response.nextPageToken)
    }
    throw new GoogleDataError(502, 'tooManyResources')
  }
}
