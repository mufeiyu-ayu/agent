import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import dns from 'node:dns'
import { Readable } from 'node:stream'
import * as undici from 'undici'
import { afterEach, describe, it, vi } from 'vitest'
import { mcpFetch } from './mcp-network.js'

vi.mock('undici', async original => ({ ...(await original<typeof undici>()), request: vi.fn() }))
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  vi.mocked(undici.request).mockReset()
})

describe('MCP 公网出口与代理边界', () => {
  it('私网、云元数据、HTTP 和地址内凭据在发请求前拒绝', async () => {
    const send = vi.mocked(undici.request)
    for (const address of ['127.0.0.1', '10.0.0.1', '169.254.169.254']) {
      vi.spyOn(dns.promises, 'lookup').mockResolvedValue([{ address, family: 4 }] as never)
      await assert.rejects(mcpFetch('https://controlled.example/mcp'))
    }
    await assert.rejects(mcpFetch('http://example.com'))
    await assert.rejects(mcpFetch('https://user:secret@example.com'))
    assert.equal(send.mock.calls.length, 0)
  })

  it('OAuth metadata/令牌请求同样阻止跳转，不向新域名转发凭据', async () => {
    vi.stubEnv('OUTBOUND_PROXY_URL', '')
    vi.spyOn(dns.promises, 'lookup').mockResolvedValue([{ address: '8.8.8.8', family: 4 }] as never)
    const send = vi.mocked(undici.request).mockResolvedValue({
      statusCode: 302,
      headers: { location: 'http://127.0.0.1/private' },
      body: Readable.from([]),
    } as never)
    await assert.rejects(
      mcpFetch('https://example.com/token', { method: 'POST', body: 'client_secret=test-secret' }),
      /redirects/,
    )
    assert.equal(send.mock.calls.length, 1)
  })

  it('代理 CONNECT 使用校验后的 IP，HTTP Host 保留原域名', async () => {
    vi.stubEnv('OUTBOUND_PROXY_URL', 'http://127.0.0.1:7890')
    vi.spyOn(dns.promises, 'lookup').mockResolvedValue([{ address: '8.8.8.8', family: 4 }] as never)
    vi.spyOn(dns, 'lookup').mockImplementation(((
      _hostname: string,
      _options: dns.LookupOptions,
      callback: (error: null, addresses: dns.LookupAddress[]) => void,
    ) => {
      callback(null, [{ address: '8.8.8.8', family: 4 }])
    }) as unknown as typeof dns.lookup)
    const send = vi.mocked(undici.request).mockResolvedValue({
      statusCode: 200,
      headers: { 'content-type': 'application/json' },
      body: Readable.from([Buffer.from('{"ok":true}')]),
    } as never)
    const response = await mcpFetch('https://example.com/mcp', { headers: { Authorization: 'Bearer test' } })
    assert.deepEqual(await response.json(), { ok: true })
    assert.equal(String(send.mock.calls[0]![0]), 'https://8.8.8.8/mcp')
    assert.deepEqual(send.mock.calls[0]![1]?.headers, { authorization: 'Bearer test', host: 'example.com' })
  })

  it('响应超过限制时中止，不把无界流交给 SDK', async () => {
    vi.stubEnv('OUTBOUND_PROXY_URL', '')
    vi.spyOn(dns.promises, 'lookup').mockResolvedValue([{ address: '8.8.8.8', family: 4 }] as never)
    vi.mocked(undici.request).mockResolvedValue({
      statusCode: 200,
      headers: {},
      body: Readable.from([Buffer.alloc(2 * 1024 * 1024 + 1)]),
    } as never)
    const response = await mcpFetch('https://example.com/mcp')
    await assert.rejects(response.text(), /大小限制/)
  })
})
