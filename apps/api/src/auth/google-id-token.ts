import type { JsonWebKey } from 'node:crypto'
import { Buffer } from 'node:buffer'
import { createPublicKey, verify } from 'node:crypto'

/** id_token 里登录要用的声明；已校验过 iss / aud / exp / nonce / email_verified。 */
export interface GoogleIdentity {
  sub: string
  email: string
  name: string | null
  avatarUrl: string | null
}

const GOOGLE_ISSUERS = new Set(['https://accounts.google.com', 'accounts.google.com'])

/** 校验失败一律抛它；原因只进日志，不含 token 本身。 */
export class GoogleTokenError extends Error {}

/** 只解码不验签：授权码流程的 id_token 经 TLS 直接从 token 端点取得，OIDC Core 3.1.3.7 允许以此代替验签。 */
export function decodeIdToken(token: string): Record<string, unknown> {
  const payload = token.split('.')[1]

  if (!payload)
    throw new GoogleTokenError('id_token 格式不对')

  return parseJsonSegment(payload)
}

/** 取 JWT 头里的 kid，用来判断缓存的 JWKS 里有没有这把钥匙；解析不了返回 undefined，交给验签报错。 */
export function readIdTokenKid(token: string): unknown {
  try {
    return parseJsonSegment(token.split('.')[0] ?? '').kid
  }
  catch {
    return undefined
  }
}

/** One Tap 的 token 经浏览器转交，必须用 Google 公布的 JWKS 验 RS256 签名。 */
export function verifyIdTokenSignature(token: string, keys: JsonWebKey[]): Record<string, unknown> {
  const [header, payload, signature, ...rest] = token.split('.')

  if (!header || !payload || !signature || rest.length > 0)
    throw new GoogleTokenError('id_token 格式不对')

  const { alg, kid } = parseJsonSegment(header)
  const jwk = keys.find(key => key.kid === kid && key.kty === 'RSA')

  if (alg !== 'RS256' || !jwk)
    throw new GoogleTokenError('id_token 的签名算法或 kid 不认识')

  const valid = verify('RSA-SHA256', Buffer.from(`${header}.${payload}`), createPublicKey({ key: jwk, format: 'jwk' }), Buffer.from(signature, 'base64url'))

  if (!valid)
    throw new GoogleTokenError('id_token 签名不对')

  return parseJsonSegment(payload)
}

/** 两种登录方式共用的声明校验；`nonce` 由调用方给出本次期望的值。 */
export function checkIdTokenClaims(
  claims: Record<string, unknown>,
  expected: { clientId: string, nonce: string, now?: number },
): GoogleIdentity {
  const { iss, aud, exp, nonce, sub, email, email_verified: emailVerified, name, picture } = claims

  if (typeof iss !== 'string' || !GOOGLE_ISSUERS.has(iss))
    throw new GoogleTokenError('iss 不对')

  if (aud !== expected.clientId)
    throw new GoogleTokenError('aud 不是本应用')

  if (typeof exp !== 'number' || exp * 1000 <= (expected.now ?? Date.now()))
    throw new GoogleTokenError('id_token 已过期')

  if (nonce !== expected.nonce)
    throw new GoogleTokenError('nonce 不匹配')

  if (emailVerified !== true)
    throw new GoogleTokenError('邮箱未验证')

  if (typeof sub !== 'string' || !sub || typeof email !== 'string' || !email.includes('@'))
    throw new GoogleTokenError('缺少 sub 或 email')

  return {
    sub,
    email: email.trim().toLowerCase(),
    name: typeof name === 'string' && name.trim() ? name.trim() : null,
    // 只存 https 地址：它会原样进 <img src>。
    avatarUrl: typeof picture === 'string' && picture.startsWith('https://') ? picture : null,
  }
}

function parseJsonSegment(segment: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'))

    if (typeof value === 'object' && value !== null && !Array.isArray(value))
      return value as Record<string, unknown>
  }
  catch {}

  throw new GoogleTokenError('id_token 不是合法的 JSON')
}
