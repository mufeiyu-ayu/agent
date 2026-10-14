import assert from 'node:assert/strict'
import { it } from 'vitest'
import { articleObservation, normalizeArticleSource, parseArticleQuery, queryArticles } from './article-query.js'

const languages = { success: true, data: [{ code: 'en', is_default: true }, { code: 'fr', is_default: false }] }
const article = (slug: string, indexable_locales: string[] = ['en', 'fr']) => ({ slug, indexable_locales, published_at: '2026-10-07 12:00:00' })
const source = (articles: unknown[]) => normalizeArticleSource({ success: true, data: { articles } }, languages, 'https://example.test', new Set(['privacy-policy']))

it('文章按篇去重，语言取启用交集，保留零URL文章与准确分页计数', () => {
  const snapshot = source([article('b'), article('a', ['en', 'de']), article('b'), article('c', []), article('privacy-policy')])
  const data = queryArticles(snapshot, { publishedFrom: '2026-10-07', publishedTo: '2026-10-07', limit: 1 })
  assert.deepEqual(data.summary, { articleCount: 3, urlCount: 3, languageCounts: { en: 2, fr: 1 } })
  assert.equal(data.excludedCount, 1)
  assert.deepEqual(data.articles[0]!.urls, [{ locale: 'en', url: 'https://example.test/blogs/detail/a' }])
  const next = queryArticles(snapshot, { offset: 1, limit: 1, sourceRevision: data.sourceRevision })
  assert.equal(next.articles[0]!.urls[1]!.url, 'https://example.test/fr/blogs/detail/b')
  assert.equal(queryArticles(snapshot, { locale: 'fr' }).summary.articleCount, 1)
  assert.throws(() => queryArticles(source([article('d')]), { sourceRevision: data.sourceRevision }), /已更新/)
  assert.throws(() => queryArticles(snapshot, { locale: 'ja' }), /未在文章源启用/)
})
it('拒绝日期与身份覆盖，来源缺语言不回退到全语言，重复冲突不静默选一条', () => {
  for (const patch of [{ publishedFrom: '2026-02-30' }, { publishedFrom: '2026-10-08', publishedTo: '2026-10-07' }, { limit: 51 }, { url: 'https://other.test' }, { userId: 'other' }])
    assert.throws(() => parseArticleQuery(patch))
  for (const rows of [[{ slug: 'a', published_at: '2026-10-07 12:00:00' }], [article('../escape')], [article('a', ['EN'])], [article('a'), article('a', ['en'])], [{ ...article('a'), published_at: '2026-02-30 12:00:00' }]])
    assert.throws(() => source(rows))
  const snapshot = source([{ ...article('a'), published_at: '2026-10-07T20:00:00Z' }])
  assert.equal(snapshot.articles[0]!.publishedAt, '2026-10-08T04:00:00+08:00')
  assert.equal(queryArticles(snapshot, { publishedTo: '2026-10-07' }).summary.articleCount, 0)
})
it('文章输出裁剪只保留完整文章，摘要仍覆盖筛选全集且续读不跳行', () => {
  const result = queryArticles(source(Array.from({ length: 20 }, (_, i) => article(`page-${i}-${'a'.repeat(150)}`))), { limit: 20 })
  const observed = JSON.parse(articleObservation(result, 3000))
  assert.equal(observed.summary.articleCount, 20)
  assert.ok(observed.returnedCount > 0 && observed.returnedCount < 20)
  assert.equal(observed.nextOffset, observed.returnedCount)
  assert.equal(observed.truncated, true)
  assert.throws(() => articleObservation(result, 100), /超过输出上限/)
})
