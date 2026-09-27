import type { HttpRequestLike } from '../common/utils/http-request.util.js'
import { createHash, randomBytes } from 'node:crypto'

import { getRequestHeader } from '../common/utils/http-request.util.js'

const SESSION_COOKIE = 'agent_session'
export const GOOGLE_FLOW_COOKIE = 'agent_google_flow'
/** Google 重定向登录一次流程的有效期：Cookie 的 Max-Age 与签名载荷里的过期时间共用它。 */
export const GOOGLE_FLOW_TTL_SECONDS = 600
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000

/** 32 字节随机 token 只进 Cookie；库里存它的 SHA-256。 */
export function createSessionToken(): string {
  return randomBytes(32).toString('base64url')
}

export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export function readSessionToken(request: HttpRequestLike): string | undefined {
  return readCookie(request, SESSION_COOKIE)
}

export function readCookie(request: HttpRequestLike, cookieName: string): string | undefined {
  const header = getRequestHeader(request, 'cookie') ?? ''

  for (const part of header.split(';')) {
    const [name, ...value] = part.trim().split('=')

    if (name === cookieName)
      return value.join('=') || undefined
  }

  return undefined
}

/** `secure` 取请求是否经 HTTPS：本地 http 开发能用，线上经 HTTPS 自动带上 Secure。 */
export function serializeSessionCookie(token: string, secure: boolean): string {
  return buildCookie(`${SESSION_COOKIE}=${token}`, SESSION_TTL_MS / 1000, secure)
}

export function serializeClearedSessionCookie(secure: boolean): string {
  return buildCookie(`${SESSION_COOKIE}=`, 0, secure)
}

/**
 * Google 重定向登录的流程 Cookie：10 分钟、只发往 `/api/auth/google`；值为空时清除。
 * SameSite=Lax 足够：从 Google 跳回回调是顶层 GET 导航，会带上它。
 */
export function serializeFlowCookie(value: string, secure: boolean): string {
  return buildCookie(`${GOOGLE_FLOW_COOKIE}=${value}`, value ? GOOGLE_FLOW_TTL_SECONDS : 0, secure, '/api/auth/google')
}

function buildCookie(pair: string, maxAgeSeconds: number, secure: boolean, path = '/'): string {
  return [pair, `Path=${path}`, `Max-Age=${maxAgeSeconds}`, 'HttpOnly', 'SameSite=Lax', ...(secure ? ['Secure'] : [])].join('; ')
}
