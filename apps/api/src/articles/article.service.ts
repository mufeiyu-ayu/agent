import type { ArticleQueryInput, ArticleSource } from './article-query.js'
import { Buffer } from 'node:buffer'
import process from 'node:process'
import { Injectable } from '@nestjs/common'
import { fetch } from 'undici'
import { createOutboundDispatcher } from '../llm/outbound-proxy.js'
import { normalizeArticleSource, queryArticles } from './article-query.js'

@Injectable()
export class ArticleService {
  readonly fetch = fetch
  private readonly dispatcher = createOutboundDispatcher()
  private cached?: ArticleSource
  private sequence = 0

  private origin() {
    const raw = process.env.ARTICLE_SITE_URL?.trim()
    if (!raw)
      throw new Error('文章数据源未配置，请联系管理员')
    let url: URL
    try {
      url = new URL(raw)
    }
    catch { throw new Error('文章数据源配置无效') }
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.pathname !== '/' || url.search || url.hash)
      throw new Error('文章数据源必须是无凭据的 HTTPS 站点根地址')
    return url.origin
  }

  private async request(url: string, signal: AbortSignal): Promise<unknown> {
    const timeout = AbortSignal.timeout(15_000)
    try {
      const response = await this.fetch(url, { redirect: 'error', dispatcher: this.dispatcher, headers: { Accept: 'application/json' }, signal: AbortSignal.any([signal, timeout]) })
      if (!response.ok || !response.body) {
        await response.body?.cancel()
        throw new Error('文章源请求失败')
      }
      const reader = response.body.getReader()
      const chunks: Uint8Array[] = []
      let size = 0
      try {
        for (;;) {
          const chunk = await reader.read()
          if (chunk.done)
            break
          size += chunk.value.byteLength
          if (size > 5_000_000)
            throw new Error('文章源响应超过上限')
          chunks.push(chunk.value)
        }
      }
      finally { await reader.cancel().catch(() => {}) }
      return JSON.parse(Buffer.concat(chunks).toString('utf8'))
    }
    catch {
      signal.throwIfAborted()
      throw new Error(timeout.aborted ? '文章源请求超时，请稍后重试' : '文章源请求失败或响应无效，未取得本次清单')
    }
  }

  async query(input: ArticleQueryInput, signal: AbortSignal) {
    signal.throwIfAborted()
    const origin = this.origin()
    if (!input.refresh && this.cached?.siteUrl === origin && Date.now() - Date.parse(this.cached.fetchedAt) < 300_000)
      return queryArticles(this.cached, input)
    const sequence = ++this.sequence
    const [slugs, languages] = await Promise.all([
      this.request(`${origin}/api/user/slugs`, signal),
      this.request(`${origin}/api/user/languages`, signal),
    ])
    signal.throwIfAborted()
    const excluded = new Set((process.env.ARTICLE_EXCLUDED_SLUGS ?? '').split(',').map(value => value.trim()).filter(Boolean))
    const source = normalizeArticleSource(slugs, languages, origin, excluded)
    if (sequence === this.sequence)
      this.cached = source
    return queryArticles(source, input)
  }
}
