import { createHash } from 'node:crypto'
import { Ajv } from 'ajv'

export interface ArticleQueryInput {
  publishedFrom?: string
  publishedTo?: string
  locale?: string
  q?: string
  offset?: number
  limit?: number
  sourceRevision?: string
  refresh?: boolean
}
const dateSchema = { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' }
export const articleQuerySchema = {
  type: 'object' as const,
  additionalProperties: false,
  properties: {
    publishedFrom: dateSchema,
    publishedTo: dateSchema,
    locale: { type: 'string', pattern: '^(all|[a-z]{2}(?:-[a-z]{2})?)$' },
    q: { type: 'string', minLength: 1, maxLength: 100 },
    offset: { type: 'integer', minimum: 0, maximum: 20000 },
    limit: { type: 'integer', minimum: 1, maximum: 50 },
    sourceRevision: { type: 'string', pattern: '^[a-f0-9]{64}$' },
    refresh: { type: 'boolean' },
  },
}
const validate = new Ajv({ strict: false }).compile<ArticleQueryInput>(articleQuerySchema)
export function parseArticleQuery(value: unknown): ArticleQueryInput {
  if (!validate(value))
    throw new Error('invalid articles_query arguments')
  const input = value as ArticleQueryInput
  for (const day of [input.publishedFrom, input.publishedTo]) {
    if (day && (!Number.isFinite(Date.parse(`${day}T00:00:00Z`)) || new Date(`${day}T00:00:00Z`).toISOString().slice(0, 10) !== day))
      throw new Error('invalid publication date')
  }
  if (input.publishedFrom && input.publishedTo && input.publishedFrom > input.publishedTo)
    throw new Error('invalid publication range')
  return input
}

export interface ArticleEntry { slug: string, publishedAt: string, locales: string[] }
export interface ArticleSource { siteUrl: string, articles: ArticleEntry[], enabledLocales: string[], sourceRevision: string, fetchedAt: string, excludedCount: number }
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('文章源响应无效')
  return value as Record<string, unknown>
}
function publication(value: unknown) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})?$/.test(value))
    throw new Error('文章源缺少有效发布时间')
  const local = value.replace(' ', 'T')
  parseArticleQuery({ publishedFrom: local.slice(0, 10) })
  const time = Date.parse(/(?:Z|[+-]\d{2}:\d{2})$/.test(local) ? local : `${local}+08:00`)
  if (!Number.isFinite(time) || Number(local.slice(11, 13)) > 23)
    throw new Error('文章源发布时间无效')
  return `${new Date(time + 8 * 3600_000).toISOString().slice(0, 19)}+08:00`
}
function locale(value: unknown) {
  if (typeof value !== 'string' || !/^[a-z]{2}(?:-[a-z]{2})?$/.test(value))
    throw new Error('文章源语言无效')
  return value
}
export function normalizeArticleSource(slugs: unknown, languages: unknown, siteUrl: string, excluded: ReadonlySet<string>, now = new Date()): ArticleSource {
  const envelope = record(slugs)
  const languageEnvelope = record(languages)
  const raw = record(envelope.data).articles
  if (envelope.success !== true || languageEnvelope.success !== true || !Array.isArray(raw) || raw.length > 20000
    || !Array.isArray(languageEnvelope.data) || languageEnvelope.data.length > 100) {
    throw new Error('文章源清单无效或超过上限')
  }
  const languageRows = languageEnvelope.data.map(record)
  const defaults = languageRows.filter(row => row.is_default === true)
  if (defaults.length !== 1 || defaults[0]!.code !== 'en')
    throw new Error('文章源默认语言必须为 en')
  const enabledLocales = [...new Set(languageRows.map(row => locale(row.code)))].sort()
  const bySlug = new Map<string, ArticleEntry>()
  let excludedCount = 0
  for (const item of raw) {
    const row = record(item)
    if (typeof row.slug !== 'string' || !/^[a-z0-9][\w-]{0,499}$/i.test(row.slug))
      throw new Error('文章源 slug 无效')
    if (excluded.has(row.slug)) {
      excludedCount++
      continue
    }
    if (!Array.isArray(row.indexable_locales) || row.indexable_locales.length > 100)
      throw new Error('文章源缺少 indexable_locales')
    const locales = [...new Set(row.indexable_locales.map(locale))].filter(code => enabledLocales.includes(code)).sort()
    const entry = { slug: row.slug, publishedAt: publication(row.published_at), locales }
    const previous = bySlug.get(entry.slug)
    if (previous && JSON.stringify(previous) !== JSON.stringify(entry))
      throw new Error('文章源存在冲突的重复 slug')
    bySlug.set(entry.slug, entry)
  }
  const articles = [...bySlug.values()].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt) || a.slug.localeCompare(b.slug))
  const sourceRevision = createHash('sha256').update(JSON.stringify({ siteUrl, articles, enabledLocales })).digest('hex')
  return { siteUrl, articles, enabledLocales, sourceRevision, fetchedAt: now.toISOString(), excludedCount }
}
export function queryArticles(source: ArticleSource, input: ArticleQueryInput) {
  if (input.sourceRevision && input.sourceRevision !== source.sourceRevision)
    throw new Error('文章清单已更新，请从第一页重新查询，不能混合不同版本')
  if (input.locale && input.locale !== 'all' && !source.enabledLocales.includes(input.locale))
    throw new Error('所选语言未在文章源启用')
  const offset = input.offset ?? 0
  const limit = input.limit ?? 20
  const articles = source.articles.filter(article => (!input.publishedFrom || article.publishedAt.slice(0, 10) >= input.publishedFrom)
    && (!input.publishedTo || article.publishedAt.slice(0, 10) <= input.publishedTo)
    && (!input.q || article.slug.toLowerCase().includes(input.q.toLowerCase()))
    && (!input.locale || input.locale === 'all' || article.locales.includes(input.locale)))
  const selectedLocales = (article: ArticleEntry) => article.locales.filter(code => !input.locale || input.locale === 'all' || code === input.locale)
  const languageCounts: Record<string, number> = {}
  for (const article of articles) {
    for (const code of selectedLocales(article)) languageCounts[code] = (languageCounts[code] ?? 0) + 1
  }
  return {
    service: 'articles_query' as const,
    source: { siteUrl: source.siteUrl, catalogUrl: `${source.siteUrl}/api/user/slugs`, languagesUrl: `${source.siteUrl}/api/user/languages` },
    sourceRevision: source.sourceRevision,
    fetchedAt: source.fetchedAt,
    timeZone: 'Asia/Shanghai',
    query: { ...input, offset, limit, locale: input.locale ?? 'all' },
    summary: { articleCount: articles.length, urlCount: Object.values(languageCounts).reduce((a, b) => a + b, 0), languageCounts },
    excludedCount: source.excludedCount,
    articles: articles.slice(offset, offset + limit).map(article => ({
      slug: article.slug,
      publishedAt: article.publishedAt,
      urls: selectedLocales(article).map(code => ({ locale: code, url: `${source.siteUrl}/${code === 'en' ? '' : `${code}/`}blogs/detail/${encodeURIComponent(article.slug)}` })),
    })),
    warning: '当前已发布清单；published_at 可能随重新发布改变，不代表首次发布或译文上线时间。语言来自公开 API 的翻译记录与启用语言交集，未独立验证标题/正文完整性，不代表已收录。未返回文章标题，不猜测标题或运营归属。',
  }
}
export function articleObservation(result: ReturnType<typeof queryArticles>, budget = 22000) {
  let count = result.articles.length
  while (count >= 0) {
    const next = result.query.offset + count
    const output = JSON.stringify({ ...result, articles: result.articles.slice(0, count), returnedCount: count, truncated: count < result.articles.length, nextOffset: next < result.summary.articleCount ? next : null })
    if (output.length <= budget && (count > 0 || result.articles.length === 0))
      return output
    count--
  }
  throw new Error('文章结果超过输出上限，请缩小语言范围')
}
