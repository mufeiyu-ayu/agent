import { Buffer } from 'node:buffer'
import process from 'node:process'
import { BadGatewayException, Injectable } from '@nestjs/common'
import { fetch } from 'undici'
import { createOutboundDispatcher } from '../llm/outbound-proxy.js'

export const GOOGLE_DATA_SCOPES = {
  gsc: 'https://www.googleapis.com/auth/webmasters.readonly',
  ga4: 'https://www.googleapis.com/auth/analytics.readonly',
}
export const GOOGLE_DATA_URLS = {
  authorize: 'https://accounts.google.com/o/oauth2/v2/auth',
  token: 'https://oauth2.googleapis.com/token',
  identity: 'https://openidconnect.googleapis.com/v1/userinfo',
  gsc: 'https://www.googleapis.com/webmasters/v3',
  admin: 'https://analyticsadmin.googleapis.com/v1beta',
  data: 'https://analyticsdata.googleapis.com/v1beta',
}

export class GoogleDataError extends BadGatewayException {
  constructor(readonly upstreamStatus: number, readonly reason: string) {
    super(reason)
  }
}

export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new GoogleDataError(502, 'invalidResponse')
  return value as Record<string, unknown>
}
export function text(value: unknown): string {
  if (typeof value !== 'string' || !value || value.length > 4096)
    throw new GoogleDataError(502, 'invalidResponse')
  return value
}
export function rows(value: unknown): Record<string, unknown>[] {
  if (value === undefined)
    return []
  if (!Array.isArray(value) || value.length > 1000)
    throw new GoogleDataError(502, 'invalidResponse')
  return value.map(object)
}

@Injectable()
export class GoogleDataClient {
  readonly clientId = process.env.GOOGLE_DATA_CLIENT_ID?.trim() ?? ''
  private readonly clientSecret = process.env.GOOGLE_DATA_CLIENT_SECRET?.trim() ?? ''
  private readonly dispatcher = createOutboundDispatcher()
  readonly fetch = fetch

  get configured() { return !!(this.clientId && this.clientSecret) }

  async exchange(parameters: Record<string, string>) {
    return this.request(GOOGLE_DATA_URLS.token, undefined, new URLSearchParams({
      ...parameters,
      client_id: this.clientId,
      client_secret: this.clientSecret,
    }))
  }

  async request(url: string, token?: string, body?: URLSearchParams | Record<string, unknown>, signal?: AbortSignal): Promise<Record<string, unknown>> {
    // 出口固定为 Google；不接受模型、浏览器或 Google 响应提供的新主机。
    const target = new URL(url)
    if (target.protocol !== 'https:' || target.username || target.password || target.port
      || !Object.values(GOOGLE_DATA_URLS).some(base => target.origin === new URL(base).origin)) {
      throw new GoogleDataError(400, 'invalidResponse')
    }
    const timeout = AbortSignal.timeout(15_000)
    try {
      const response = await this.fetch(target, {
        method: body ? 'POST' : 'GET',
        redirect: 'error',
        dispatcher: this.dispatcher,
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(body ? { 'Content-Type': body instanceof URLSearchParams ? 'application/x-www-form-urlencoded' : 'application/json' } : {}),
        },
        ...(body ? { body: body instanceof URLSearchParams ? body.toString() : JSON.stringify(body) } : {}),
      })
      const reader = response.body?.getReader()
      if (!reader)
        throw new GoogleDataError(502, 'invalidResponse')
      let size = 0
      const chunks: Uint8Array[] = []
      try {
        for (;;) {
          const chunk = await reader.read()
          if (chunk.done)
            break
          size += chunk.value.byteLength
          if (size > 1_048_576)
            throw new GoogleDataError(502, 'tooManyResources')
          chunks.push(chunk.value)
        }
      }
      finally { await reader.cancel().catch(() => {}) }
      const result = object(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      if (!response.ok) {
        const reason = result.error === 'invalid_grant'
          ? 'needsAuth'
          : response.status === 401
            ? 'needsAuth'
            : response.status === 403
              ? 'permissionDenied'
              : response.status === 429
                ? 'quotaExceeded'
                : response.status === 400 && (target.pathname.endsWith(':runReport') || target.pathname.endsWith('/searchAnalytics/query')) ? 'queryRejected' : 'upstreamFailed'
        throw new GoogleDataError(response.status, reason)
      }
      return result
    }
    catch (error) {
      if (error instanceof GoogleDataError)
        throw error
      throw new GoogleDataError(502, timeout.aborted || signal?.aborted ? 'timeout' : 'upstreamFailed')
    }
  }
}
