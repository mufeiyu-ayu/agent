import { Ajv } from 'ajv'
import { GoogleDataError, object } from './google-data-client.js'

export interface InspectionInput { urls: string[], refresh?: boolean }
const PT = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' })
export function inspectionBudgetDay(now = new Date()) {
  const parts = Object.fromEntries(PT.formatToParts(now).map(part => [part.type, part.value]))
  return `${parts.year}-${parts.month}-${parts.day}`
}
export const inspectionSchema = {
  type: 'object' as const,
  additionalProperties: false,
  required: ['urls'],
  properties: { urls: { type: 'array', minItems: 1, maxItems: 20, uniqueItems: true, items: { type: 'string', minLength: 1, maxLength: 2048 } }, refresh: { type: 'boolean' } },
}
const validate = new Ajv().compile<InspectionInput>(inspectionSchema)
export function inspectionUrl(value: string) {
  const url = new URL(value)
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.port || url.hash)
    throw new Error('URL 必须是无凭据、无端口和锚点的 http/https 地址')
  return url.href
}
export function parseInspection(value: unknown): InspectionInput {
  if (!validate(value) || JSON.stringify(value).length > 12000)
    throw new Error('invalid gsc_inspect arguments')
  const urls = value.urls.map(inspectionUrl)
  if (new Set(urls).size !== urls.length)
    throw new Error('duplicate inspection URLs')
  return { urls, ...(value.refresh === undefined ? {} : { refresh: value.refresh }) }
}
export function withinGscSite(value: string, site: string) {
  const url = new URL(inspectionUrl(value))
  if (site.startsWith('sc-domain:')) {
    const domain = site.slice('sc-domain:'.length).toLowerCase()
    return url.hostname === domain || url.hostname.endsWith(`.${domain}`)
  }
  const prefix = new URL(site)
  return url.origin === prefix.origin && url.pathname.startsWith(prefix.pathname)
}
function field(row: Record<string, unknown>, key: string) {
  const value = row[key]
  if (typeof value !== 'string')
    return null
  if (value.length > 4096)
    throw new GoogleDataError(502, 'invalidResponse')
  return value
}
export function inspectionStatus(result: Record<string, unknown>, url: string) {
  const envelope = object(result.inspectionResult)
  const index = object(envelope.indexStatusResult)
  if (!['PASS', 'FAIL', 'NEUTRAL', 'VERDICT_UNSPECIFIED'].includes(String(index.verdict)))
    throw new GoogleDataError(502, 'invalidResponse')
  const googleCanonical = field(index, 'googleCanonical')
  let status = index.verdict === 'VERDICT_UNSPECIFIED' ? 'unknown' : 'not_indexed'
  if (index.verdict === 'PASS')
    status = googleCanonical ? 'indexed' : 'indexed_canonical_unknown'
  if (googleCanonical) {
    try {
      const canonical = new URL(googleCanonical)
      if (!['http:', 'https:'].includes(canonical.protocol))
        throw new Error('invalid canonical URL')
      if (canonical.href.split('#')[0] !== url)
        status = 'other_canonical'
    }
    catch { throw new GoogleDataError(502, 'invalidResponse') }
  }
  const link = field(envelope, 'inspectionResultLink')
  return {
    status,
    verdict: String(index.verdict),
    googleCanonical,
    coverageState: field(index, 'coverageState'),
    lastCrawlTime: field(index, 'lastCrawlTime'),
    userCanonical: field(index, 'userCanonical'),
    robotsTxtState: field(index, 'robotsTxtState'),
    indexingState: field(index, 'indexingState'),
    pageFetchState: field(index, 'pageFetchState'),
    inspectionResultLink: link?.startsWith('https://search.google.com/search-console/') ? link : null,
  }
}
export type InspectionStatus = ReturnType<typeof inspectionStatus>
export interface InspectionRow {
  url: string
  status: string
  cached: boolean
  checkedAt: string | null
  index?: InspectionStatus
  error?: string
}
export interface InspectionResult {
  service: 'gsc_inspect'
  source: { siteUrl: string }
  fetchedAt: string
  rows: InspectionRow[]
  summary: { targetCount: number, checkedCount: number, cachedCount: number, failedCount: number, uncheckedCount: number }
  budget: { days: string[], limit: number, scope: string }
  warning: string
}
export function inspectionObservation(result: InspectionResult, budget = 22000) {
  for (let count = result.rows.length; count > 0; count--) {
    const output = JSON.stringify({ ...result, rows: result.rows.slice(0, count), returnedCount: count, truncated: count < result.rows.length, omittedUrls: result.rows.slice(count).map(row => row.url) })
    if (output.length <= budget)
      return output
  }
  throw new GoogleDataError(502, 'resultTooLarge')
}
