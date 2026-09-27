import type { AuthUser, GoogleLoginResult } from '@agent/contracts'
import type { JsonWebKey } from 'node:crypto'
import type { Dispatcher } from 'undici'
import type { GoogleIdentity } from './google-id-token.js'
import { Buffer } from 'node:buffer'
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import process from 'node:process'
import { HttpException, HttpStatus, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common'
import { fetch } from 'undici'

import { createOutboundDispatcher } from '../llm/outbound-proxy.js'
import { PrismaService } from '../prisma/prisma.service.js'
import { readAppOrigins } from './auth.guard.js'
import { AuthService, userStatus } from './auth.service.js'
import { checkIdTokenClaims, decodeIdToken, GoogleTokenError, readIdTokenKid, verifyIdTokenSignature } from './google-id-token.js'
import { GOOGLE_FLOW_TTL_SECONDS } from './session-cookie.js'

/** Google 的端点。测试把它们换成本地假服务。 */
export const GOOGLE_ENDPOINTS = {
  authorize: 'https://accounts.google.com/o/oauth2/v2/auth',
  token: 'https://oauth2.googleapis.com/token',
  jwks: 'https://www.googleapis.com/oauth2/v3/certs',
}

export const GOOGLE_CALLBACK_PATH = '/api/auth/google/callback'
/** 所有 Google 登录失败共用一个文案，不暴露账号是停用、被拒还是校验没过。 */
export const GOOGLE_LOGIN_FAILED_MESSAGE = '无法使用该 Google 账号登录'

const REQUEST_TIMEOUT_MS = 10_000
// One Tap 卡片可能挂很久才被点；nonce 一次性，有效期长一些不影响防重放。
const ONE_TAP_NONCE_TTL_MS = 60 * 60 * 1000
// 缓存里没有 token 的 kid（Google 换了签名密钥）时强制重取 JWKS，但一分钟最多一次，乱填 kid 刷不动。
const JWKS_FORCED_REFRESH_MS = 60_000
/** 陌生账号自动建成待审核的上限，挡住有人批量注册 Google 账号来刷。 */
export const PENDING_USER_LIMIT = 50
const ONE_TAP_NONCE_MAX = 10_000
// 每次未登录打开首页或登录页都会取一个 nonce，同一出口 IP 的办公室会取很多次，额度比登录宽。
const ONE_TAP_NONCE_IP_LIMIT = 300

/** 重定向登录的一次流程：存在签名 Cookie 里，回调时取回。 */
interface GoogleFlow {
  state: string
  verifier: string
  nonce: string
  origin: string
  redirect: string
  expiresAt: number
}

export type GoogleSignInOutcome
  = | { status: 'ok', user: AuthUser, token: string }
    | { status: Exclude<GoogleLoginResult, 'failed'> }
    | { status: 'failed', reason: string }

/**
 * Google 登录（Issue #198）：重定向登录（授权码 + PKCE + state + nonce）与 One Tap（GIS 的 ID token 验签），
 * 两者校验完都交给同一个 `signIn`：按 sub → 邮箱匹配 → 按状态处理。
 * 未配置 `GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET` 时整体关闭。
 */
@Injectable()
export class GoogleAuthService {
  private readonly logger = new Logger(GoogleAuthService.name)
  private readonly clientId = process.env.GOOGLE_OAUTH_CLIENT_ID?.trim() || null
  private readonly clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET?.trim() || null
  private readonly origins = readAppOrigins()
  // 本机开发访问 Google 要走代理；线上不配 OUTBOUND_PROXY_URL 就直连。
  private readonly dispatcher: Dispatcher = createOutboundDispatcher()

  // 流程 Cookie 的签名密钥：进程内随机，重启后进行中的登录失效（重新点一次即可）。
  private readonly flowKey = randomBytes(32)
  private jwks: { keys: JsonWebKey[], fetchedAt: number, expiresAt: number } | undefined
  // ponytail: One Tap 的 nonce 只存进程内，单实例有效；多实例部署时换成库表或 Redis。
  private readonly oneTapNonces = new Map<string, number>()

  constructor(
    @Inject(PrismaService)
    private readonly prismaService: PrismaService,
    @Inject(AuthService)
    private readonly authService: AuthService,
  ) {}

  /** 前端据此决定是否显示 Google 按钮、加载 GIS。 */
  get publicClientId(): string | null {
    return this.clientId && this.clientSecret ? this.clientId : null
  }

  /** 生成 state / PKCE / nonce，返回 Google 授权页地址与流程 Cookie 的值。 */
  start(redirect: unknown, referer: string | undefined): { url: string, flowCookie: string } {
    const clientId = this.requireClientId()
    const flow: GoogleFlow = {
      state: randomToken(),
      verifier: randomToken(32),
      nonce: randomToken(),
      origin: this.pickOrigin(referer),
      redirect: safeRedirect(redirect),
      expiresAt: Date.now() + GOOGLE_FLOW_TTL_SECONDS * 1000,
    }
    const url = new URL(GOOGLE_ENDPOINTS.authorize)

    url.search = new URLSearchParams({
      client_id: clientId,
      redirect_uri: `${flow.origin}${GOOGLE_CALLBACK_PATH}`,
      response_type: 'code',
      scope: 'openid email profile',
      state: flow.state,
      nonce: flow.nonce,
      code_challenge: createHash('sha256').update(flow.verifier).digest('base64url'),
      code_challenge_method: 'S256',
      prompt: 'select_account',
    }).toString()

    return { url: url.toString(), flowCookie: this.signFlow(flow) }
  }

  /** 回调：一律返回要跳去的完整地址，成功时带上新 Session 的 token。不抛异常，免得授权码进错误日志。 */
  async callback(
    query: { code?: unknown, state?: unknown },
    flowCookie: string | undefined,
    ip: string,
  ): Promise<{ location: string, token?: string }> {
    this.requireClientId()
    const flow = this.readFlow(flowCookie)
    const origin = flow?.origin ?? this.origins[0]!
    // 没进站时回到发起方的登录页，并带回原目标页：线上管理台在 /admin/ 下，它的路由不含这个前缀。
    const loginUrl = (result: GoogleLoginResult) => {
      const admin = flow?.redirect.startsWith('/admin/') === true
      const params = new URLSearchParams({ google: result, ...(flow ? { redirect: admin ? flow.redirect.slice('/admin'.length) : flow.redirect } : {}) })
      return `${origin}${admin ? '/admin/login' : '/login'}?${params}`
    }

    let outcome: GoogleSignInOutcome

    try {
      this.authService.throttleGoogleAttempt(`google:${ip}`)
      outcome = await this.exchangeAndSignIn(query, flow)
    }
    catch (error) {
      outcome = error instanceof GoogleTokenError
        ? { status: 'failed', reason: error.message }
        : error instanceof HttpException && error.getStatus() === HttpStatus.TOO_MANY_REQUESTS
          ? { status: 'throttled' }
          : { status: 'failed', reason: describeError(error) }
    }

    if (outcome.status === 'failed')
      this.logger.warn(`Google 重定向登录失败：${outcome.reason}`)

    return outcome.status === 'ok'
      ? { location: `${origin}${flow!.redirect}`, token: outcome.token }
      : { location: loginUrl(outcome.status) }
  }

  /**
   * One Tap 每次弹出前取一个一次性 nonce，交给 GIS 初始化；用过或过期即作废。
   * 按 IP 单独限流；池子满了拒绝新签发（429，前端静默跳过 One Tap），不挤掉别人已经拿到的 nonce。
   */
  issueOneTapNonce(ip: string): string {
    this.requireClientId()
    this.authService.throttleGoogleAttempt(`google-nonce:${ip}`, ONE_TAP_NONCE_IP_LIMIT)
    const now = Date.now()

    if (this.oneTapNonces.size >= ONE_TAP_NONCE_MAX) {
      for (const [nonce, expiresAt] of this.oneTapNonces) {
        if (expiresAt <= now)
          this.oneTapNonces.delete(nonce)
      }

      if (this.oneTapNonces.size >= ONE_TAP_NONCE_MAX)
        throw new HttpException('登录尝试过于频繁，请稍后再试', HttpStatus.TOO_MANY_REQUESTS)
    }

    const nonce = randomToken()
    this.oneTapNonces.set(nonce, now + ONE_TAP_NONCE_TTL_MS)
    return nonce
  }

  /** One Tap：验签 → 消费本服务签发的 nonce → 声明校验，然后与回调走同一个 `signIn`。 */
  async oneTap(credential: string, ip: string): Promise<GoogleSignInOutcome> {
    const clientId = this.requireClientId()
    this.authService.throttleGoogleAttempt(`google:${ip}`)

    try {
      const claims = verifyIdTokenSignature(credential, await this.loadJwks(readIdTokenKid(credential)))
      // 验签通过后才消费，免得乱发的 token 烧掉别人的 nonce。token 自带的 nonce 只用来查表，
      // 期望值来自签发记录：查不到（不是本服务签发、已用过）或已过期都拒绝。
      const issuedNonce = typeof claims.nonce === 'string' ? claims.nonce : ''
      const expiresAt = this.oneTapNonces.get(issuedNonce)

      if (!this.oneTapNonces.delete(issuedNonce) || expiresAt! <= Date.now())
        throw new GoogleTokenError('nonce 不是本服务签发的，或已用过 / 过期')

      return await this.signIn(checkIdTokenClaims(claims, { clientId, nonce: issuedNonce }))
    }
    catch (error) {
      const reason = error instanceof GoogleTokenError ? error.message : describeError(error)
      this.logger.warn(`Google One Tap 登录失败：${reason}`)
      return { status: 'failed', reason }
    }
  }

  /**
   * 两种登录方式共用：按 sub 找 → 否则按邮箱找并绑定 sub → 都找不到新建待审核成员；再按账号状态处理。
   * 绑定以 sub 为准：已绑定的账号 Google 侧改了邮箱仍登录原账号；邮箱对上但已绑了别的 sub 时不改绑。
   */
  private async signIn(identity: GoogleIdentity): Promise<GoogleSignInOutcome> {
    const profile = { name: identity.name, avatarUrl: identity.avatarUrl }
    const bySub = await this.prismaService.user.findUnique({ where: { googleSub: identity.sub } })
    // 被拒 / 停用的账号不再跟着 Google 资料变，管理员看到的还是当时的申请人。
    let user = bySub && (bySub.disabled ? bySub : await this.prismaService.user.update({ where: { id: bySub.id }, data: profile }))

    if (!user) {
      const byEmail = await this.prismaService.user.findUnique({ where: { email: identity.email } })

      if (!byEmail)
        return this.createPendingUser(identity)

      if (byEmail.googleSub)
        return { status: 'failed', reason: '该邮箱已绑定另一个 Google 账号' }

      // 条件写：并发的两次首登只有一次绑定成功。
      const { count } = await this.prismaService.user.updateMany({
        where: { id: byEmail.id, googleSub: null },
        data: { googleSub: identity.sub, ...profile },
      })

      if (count === 0)
        return { status: 'failed', reason: '绑定 Google 账号时发生并发冲突' }

      user = { ...byEmail, googleSub: identity.sub, ...profile }
    }

    const status = userStatus(user)

    if (status === 'PENDING')
      return { status: 'pending' }

    if (status === 'DISABLED')
      return { status: 'failed', reason: '账号已停用' }

    const session = await this.authService.createSession(user.id, { resetPasswordLock: false })
    return session ? { status: 'ok', ...session } : { status: 'failed', reason: '发 Session 前账号被停用' }
  }

  private async createPendingUser(identity: GoogleIdentity): Promise<GoogleSignInOutcome> {
    // ponytail: 先数后建，并发时可能略超上限；只为挡批量刷号，不需要精确。
    if (await this.prismaService.user.count({ where: { pendingApproval: true, disabled: false } }) >= PENDING_USER_LIMIT)
      return { status: 'busy' }

    try {
      await this.prismaService.user.create({
        data: {
          email: identity.email,
          googleSub: identity.sub,
          name: identity.name,
          avatarUrl: identity.avatarUrl,
          role: 'MEMBER',
          pendingApproval: true,
          mustChangePassword: false,
        },
      })
    }
    catch (error) {
      if ((error as { code?: unknown }).code === 'P2002')
        return { status: 'failed', reason: '并发首登：邮箱或 sub 已被占用' }
      throw error
    }

    return { status: 'pending' }
  }

  private async exchangeAndSignIn(query: { code?: unknown, state?: unknown }, flow: GoogleFlow | null): Promise<GoogleSignInOutcome> {
    if (!flow)
      throw new GoogleTokenError('缺少或无效的流程 Cookie')

    if (typeof query.state !== 'string' || !safeEqual(query.state, flow.state))
      throw new GoogleTokenError('state 不匹配')

    if (typeof query.code !== 'string' || !query.code)
      throw new GoogleTokenError('Google 没有返回授权码（用户取消或出错）')

    const response = await fetch(GOOGLE_ENDPOINTS.token, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code: query.code,
        client_id: this.clientId!,
        client_secret: this.clientSecret!,
        redirect_uri: `${flow.origin}${GOOGLE_CALLBACK_PATH}`,
        grant_type: 'authorization_code',
        code_verifier: flow.verifier,
      }),
      dispatcher: this.dispatcher,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
    const body = await response.json().catch(() => null) as { id_token?: unknown, error?: unknown } | null

    // 只记 Google 的错误码（如 invalid_grant），响应里的其他内容不进日志。
    if (!response.ok || typeof body?.id_token !== 'string')
      throw new GoogleTokenError(`换 token 失败：HTTP ${response.status} ${typeof body?.error === 'string' ? body.error.slice(0, 64) : ''}`.trim())

    return this.signIn(checkIdTokenClaims(decodeIdToken(body.id_token), { clientId: this.clientId!, nonce: flow.nonce }))
  }

  /** JWKS 按响应头的 max-age 缓存；缓存里没有该 kid 时限频强制重取。取不到时 One Tap 失败，不影响其他登录方式。 */
  private async loadJwks(kid: unknown): Promise<JsonWebKey[]> {
    const now = Date.now()
    const cached = this.jwks

    if (cached && cached.expiresAt > now && (cached.keys.some(key => key.kid === kid) || now - cached.fetchedAt < JWKS_FORCED_REFRESH_MS))
      return cached.keys

    const response = await fetch(GOOGLE_ENDPOINTS.jwks, { dispatcher: this.dispatcher, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) })
    const body = await response.json().catch(() => null) as { keys?: unknown } | null

    if (!response.ok || !Array.isArray(body?.keys))
      throw new GoogleTokenError(`取 Google 公钥失败：HTTP ${response.status}`)

    const maxAge = Number(/max-age=(\d+)/.exec(response.headers.get('cache-control') ?? '')?.[1] ?? 0)
    this.jwks = { keys: body.keys as JsonWebKey[], fetchedAt: now, expiresAt: now + maxAge * 1000 }
    return this.jwks.keys
  }

  private requireClientId(): string {
    if (!this.publicClientId)
      throw new NotFoundException()
    return this.publicClientId
  }

  /** 回调地址只用配置里的站点地址：Referer 在 `APP_ORIGINS` 里就用它（本地前台与管理台端口不同），否则用第一个。 */
  private pickOrigin(referer: string | undefined): string {
    let origin: string | undefined

    try {
      origin = referer ? new URL(referer).origin : undefined
    }
    catch {}

    return origin && this.origins.includes(origin) ? origin : this.origins[0]!
  }

  private signFlow(flow: GoogleFlow): string {
    const payload = Buffer.from(JSON.stringify(flow)).toString('base64url')
    return `${payload}.${this.hmac(payload)}`
  }

  private readFlow(cookie: string | undefined): GoogleFlow | null {
    const [payload, signature] = cookie?.split('.') ?? []

    if (!payload || !signature || !safeEqual(signature, this.hmac(payload)))
      return null

    const flow = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as GoogleFlow
    return flow.expiresAt > Date.now() ? flow : null
  }

  private hmac(value: string): string {
    return createHmac('sha256', this.flowKey).update(value).digest('base64url')
  }
}

/** 登录后回跳只接受本站相对路径，挡住 `https://evil.example`、`//evil.example` 这类开放跳转。 */
export function safeRedirect(value: unknown): string {
  return typeof value === 'string' && value.startsWith('/') && !value.startsWith('//') && !value.startsWith('/\\')
    // 控制字符会被浏览器吃掉（`/\t/evil.example` → `//evil.example`），也进不了 Location 头。
    && !/\p{Cc}/u.test(value)
    // 它会进流程 Cookie，太长浏览器直接丢弃 Cookie，回调必然失败。
    && value.length <= 1024
    ? value
    : '/workspace'
}

function randomToken(bytes = 16): string {
  return randomBytes(bytes).toString('base64url')
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  return left.length === right.length && timingSafeEqual(left, right)
}

/** 日志只记错误类型与消息；fetch 的错误消息里没有请求体，授权码、密钥不会进来。 */
function describeError(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error)
}
