import assert from 'node:assert/strict'
import { afterEach, it, vi } from 'vitest'
import { ArticleService } from './article.service.js'

afterEach(() => vi.unstubAllEnvs())
it('只请求固定公开元数据，复用缓存和原时间，强制刷新失败不返回旧成功', async () => {
  vi.stubEnv('ARTICLE_SITE_URL', 'https://example.test')
  vi.stubEnv('OUTBOUND_PROXY_URL', '')
  const service = new ArticleService()
  const paths: string[] = []
  let fail = false
  Object.defineProperty(service, 'fetch', { value: async (url: string, init: RequestInit) => {
    paths.push(new URL(url).pathname)
    assert.equal(init.redirect, 'error')
    assert.equal((init.headers as Record<string, string>).Authorization, undefined)
    if (fail)
      return new Response('{"token":"do-not-expose"}', { status: 503 })
    return Response.json({ success: true, data: url.endsWith('/languages') ? [{ code: 'en', is_default: true }] : { articles: [{ slug: 'one', published_at: '2026-10-07 00:00:00', indexable_locales: ['en'] }] } })
  } })
  const signal = new AbortController().signal
  const first = await service.query({}, signal)
  const second = await service.query({}, signal)
  assert.deepEqual(paths, ['/api/user/slugs', '/api/user/languages'])
  assert.equal(first.fetchedAt, second.fetchedAt)
  fail = true
  await assert.rejects(service.query({ refresh: true }, signal), error => error instanceof Error && !error.message.includes('do-not-expose'))
  const abort = new AbortController()
  abort.abort()
  await assert.rejects(service.query({}, abort.signal))
  vi.stubEnv('ARTICLE_SITE_URL', 'https://name:secret@example.test')
  await assert.rejects(service.query({}, signal), /无凭据/)
})
