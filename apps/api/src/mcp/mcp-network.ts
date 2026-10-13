import type { FetchLike } from '@modelcontextprotocol/client'
import type { Dispatcher } from 'undici'
import process from 'node:process'
import { Readable } from 'node:stream'
import { Agent, ProxyAgent, request } from 'undici'
import { resolveOutboundProxyConfig } from '../llm/outbound-proxy.js'
import { assertPublicHost, guardedLookup } from '../tools/web/ssrf-guard.js'
import { mcpUrl } from './mcp-config.js'

const dispatcher = new Agent({
  connect: { lookup: guardedLookup },
  headersTimeout: 15_000,
  bodyTimeout: 30_000,
})

/** MCP 与 OAuth 发现/换令牌共用出口；任何重定向都不携带凭据继续跳转。 */
export const mcpFetch: FetchLike = async (input, init) => {
  const url = mcpUrl(String(input))
  await assertPublicHost(url)
  const proxy = resolveOutboundProxyConfig(process.env)
  let proxyAgent: ProxyAgent | undefined
  const target = new URL(url)
  const headers = new Headers(init?.headers)
  if (proxy) {
    // CONNECT 使用已校验 IP，TLS 仍校验原域名；代理不能再次解析域名绕过 SSRF 防护。
    const address = await new Promise<string>((resolve, reject) =>
      guardedLookup(url.hostname, { family: 4 }, (error, address) =>
        error ? reject(error) : resolve(typeof address === 'string' ? address : address[0]!.address)),
    )
    target.hostname = address
    headers.set('Host', url.host)
    proxyAgent = new ProxyAgent({
      uri: proxy.url,
      requestTls: { servername: url.hostname },
    })
  }
  const close = () => {
    void proxyAgent?.close().catch(() => {})
  }
  let response: Awaited<ReturnType<typeof request>>
  try {
    if (init?.body != null && typeof init.body !== 'string' && !(init.body instanceof URLSearchParams)) {
      throw new Error('Unsupported MCP request body')
    }
    response = await request(target, {
      method: (init?.method ?? 'GET') as Dispatcher.HttpMethod,
      headers: Object.fromEntries(headers),
      ...(init?.body != null ? { body: String(init.body) } : {}),
      dispatcher: proxyAgent ?? dispatcher,
      signal: AbortSignal.any([...(init?.signal ? [init.signal] : []), AbortSignal.timeout(30_000)]),
    })
    if (response.statusCode >= 300 && response.statusCode < 400) {
      response.body.destroy()
      throw new Error('MCP redirects are not supported')
    }
  }
  catch (error) {
    close()
    throw error
  }
  const reader = (Readable.toWeb(response.body) as ReadableStream<Uint8Array>).getReader()
  let bytes = 0
  const body = reader
    ? new ReadableStream<Uint8Array>({
        async pull(controller) {
          try {
            const chunk = await reader.read()
            if (chunk.done) {
              close()
              controller.close()
              return
            }
            bytes += chunk.value.byteLength
            if (bytes > 2 * 1024 * 1024) {
              await reader.cancel()
              throw new Error('MCP 响应超过大小限制')
            }
            controller.enqueue(chunk.value)
          }
          catch (error) {
            close()
            controller.error(error)
          }
        },
        cancel() {
          close()
          return reader.cancel()
        },
      })
    : null
  const responseHeaders = new Headers()
  for (const [name, value] of Object.entries(response.headers)) {
    if (value !== undefined) {
      responseHeaders.set(name, Array.isArray(value) ? value.join(', ') : String(value))
    }
  }
  if ([204, 205, 304].includes(response.statusCode)) {
    await reader.cancel()
    close()
    return new Response(null, {
      status: response.statusCode,
      headers: responseHeaders,
    })
  }
  return new Response(body, {
    status: response.statusCode,
    headers: responseHeaders,
  })
}
