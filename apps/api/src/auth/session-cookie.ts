import type { HttpRequestLike } from '../common/utils/http-request.util.js'
import { createHash, randomBytes } from 'node:crypto'

import { getRequestHeader } from '../common/utils/http-request.util.js'

const SESSION_COOKIE = 'agent_session'
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000

/** 32 字节随机 token 只进 Cookie；库里存它的 SHA-256。 */
export function createSessionToken(): string {
  return randomBytes(32).toString('base64url')
}

export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export function readSessionToken(request: HttpRequestLike): string | undefined {
  const header = getRequestHeader(request, 'cookie') ?? ''

  for (const part of header.split(';')) {
    const [name, ...value] = part.trim().split('=')

    if (name === SESSION_COOKIE)
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

function buildCookie(pair: string, maxAgeSeconds: number, secure: boolean): string {
  return [pair, 'Path=/', `Max-Age=${maxAgeSeconds}`, 'HttpOnly', 'SameSite=Lax', ...(secure ? ['Secure'] : [])].join('; ')
}
