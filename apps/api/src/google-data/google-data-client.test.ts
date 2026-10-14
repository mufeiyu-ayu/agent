import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { ReadableStream } from 'node:stream/web'
import { Response } from 'undici'
import { afterEach, it, vi } from 'vitest'
import { GoogleDataClient } from './google-data-client.js'

afterEach(() => vi.restoreAllMocks())
it('固定 Google 出口、禁止重定向、请求超时信号与响应大小限制', async () => {
  const client = new GoogleDataClient()
  const fetch = vi.spyOn(client, 'fetch')
  await assert.rejects(client.request('https://evil.test', 'secret'), /invalidResponse/)
  await assert.rejects(client.request('https://www.googleapis.com:444/', 'secret'), /invalidResponse/)
  assert.equal(fetch.mock.calls.length, 0)
  fetch.mockResolvedValue(new Response('{}', { status: 200 }))
  await client.request('https://www.googleapis.com/webmasters/v3/sites', 'secret')
  assert.equal(fetch.mock.calls[0]![1]!.redirect, 'error')
  assert.ok(fetch.mock.calls[0]![1]!.signal instanceof AbortSignal)
  fetch.mockResolvedValue(new Response(new ReadableStream({ start(controller) {
    controller.enqueue(Buffer.alloc(1_048_577))
    controller.close()
  } })))
  await assert.rejects(client.request('https://www.googleapis.com/webmasters/v3/sites', 'secret'), /tooManyResources/)
})
it('上游原文、网络错误和密钥不进入业务错误；无效 JSON 不能伪报成功', async () => {
  const client = new GoogleDataClient()
  const fetch = vi.spyOn(client, 'fetch')
  fetch.mockResolvedValue(new Response(JSON.stringify({ error: 'invalid_grant', secret: 'private-token' }), { status: 400 }))
  await assert.rejects(client.request('https://oauth2.googleapis.com/token'), /^GoogleDataError: needsAuth$/)
  fetch.mockRejectedValue(new Error('private-token network failure'))
  await assert.rejects(client.request('https://oauth2.googleapis.com/token'), /^GoogleDataError: upstreamFailed$/)
  fetch.mockResolvedValue(new Response('<html>bad</html>', { status: 200 }))
  await assert.rejects(client.request('https://www.googleapis.com/webmasters/v3/sites'), /upstreamFailed/)
})
