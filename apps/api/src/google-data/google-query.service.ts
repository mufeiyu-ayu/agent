import type { GoogleDataConnection } from '../generated/prisma/client.js'
import type { Ga4QueryInput, GscQueryInput, MetadataInput } from './google-query-input.js'
import { BadRequestException, ConflictException, Inject, Injectable } from '@nestjs/common'
import { GOOGLE_DATA_URLS, GoogleDataError, object, rows, text } from './google-data-client.js'
import { GoogleDataService } from './google-data.service.js'
import { filterFields } from './google-query-input.js'
import { withinGscSite } from './gsc-inspection.js'

/** 每 Run 一份可信状态；无凭据，仅在首次调用时固定连接，普通聊天无需读 Google。 */
export interface GoogleQueryRun {
  userId: string
  revision?: number
  metadata?: Record<string, unknown>
}
const PT = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' })
function source(row: GoogleDataConnection, service: 'gsc' | 'ga4') {
  return service === 'gsc' ? { siteUrl: row.gscSite } : { property: row.ga4Property, stream: row.ga4Stream }
}
function count(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)
    throw new GoogleDataError(502, 'invalidResponse')
  return value
}

@Injectable()
export class GoogleQueryService {
  constructor(@Inject(GoogleDataService) private readonly google: GoogleDataService) {}

  private async connection(run: GoogleQueryRun, service: 'gsc' | 'ga4', signal: AbortSignal) {
    signal.throwIfAborted()
    const row = await this.google.queryConnection(run.userId, service, run.revision)
    signal.throwIfAborted()
    // 同时到达的首次调用也不能把已固定的连接替换掉。
    if (run.revision !== undefined && row.revision !== run.revision)
      throw new ConflictException('connectionChanged')
    run.revision = row.revision
    return row
  }

  async gsc(input: GscQueryInput, run: GoogleQueryRun, signal: AbortSignal) {
    if (input.dataState === 'hourly_all') {
      const parts = Object.fromEntries(PT.formatToParts(new Date()).map(part => [part.type, part.value]))
      const today = `${parts.year}-${parts.month}-${parts.day}`
      const earliest = new Date(Date.parse(`${today}T00:00:00Z`) - 9 * 86400000).toISOString().slice(0, 10)
      if (input.startDate < earliest || input.endDate > today)
        throw new BadRequestException('hourlyWindow')
    }
    const row = await this.connection(run, 'gsc', signal)
    for (const filter of input.dimensionFilterGroups?.flatMap(group => group.filters) ?? []) {
      if (filter.dimension === 'page' && (filter.operator ?? 'equals') === 'equals') {
        let matches = false
        try {
          matches = withinGscSite(filter.expression, row.gscSite!)
        }
        catch { /* 精确页面筛选必须是所属站点内的完整 URL。 */ }
        if (!matches)
          throw new BadRequestException('pageOutsideSite')
      }
    }
    const query = { dimensions: [] as string[], type: 'web', dataState: 'final', aggregationType: 'auto', rowLimit: 100, startRow: 0, ...input }
    const result = await this.google.queryRequest(row, `${GOOGLE_DATA_URLS.gsc}/sites/${encodeURIComponent(row.gscSite!)}/searchAnalytics/query`, query, signal)
    const data = rows(result.rows)
    if (data.length > query.rowLimit)
      throw new GoogleDataError(502, 'invalidResponse')
    for (const item of data) {
      if (!Array.isArray(item.keys) && query.dimensions.length > 0)
        throw new GoogleDataError(502, 'invalidResponse')
      const keys = item.keys ?? []
      if (!Array.isArray(keys) || keys.length !== query.dimensions.length || keys.some(key => typeof key !== 'string'))
        throw new GoogleDataError(502, 'invalidResponse')
      if (['clicks', 'impressions', 'ctr', 'position'].some(key => typeof item[key] !== 'number' || !Number.isFinite(item[key])))
        throw new GoogleDataError(502, 'invalidResponse')
    }
    return {
      service: 'gsc' as const,
      source: source(row, 'gsc'),
      revision: row.revision,
      query,
      timeZone: 'America/Los_Angeles',
      fetchedAt: new Date().toISOString(),
      responseAggregationType: text(result.responseAggregationType),
      metadata: result.metadata ?? {},
      rows: data,
      apiRowsReturned: data.length,
      warning: 'Search Console 仅返回受限的 top rows；分页结束不证明全量完整。缺行不等于零，CTR/平均排名不能简单平均。',
    }
  }

  private async metadata(row: GoogleDataConnection, run: GoogleQueryRun, signal: AbortSignal) {
    if (!run.metadata) {
      const response = await this.google.queryRequest(row, `${GOOGLE_DATA_URLS.data}/${row.ga4Property}/metadata`, undefined, signal)
      if (!Array.isArray(response.dimensions) || !Array.isArray(response.metrics))
        throw new GoogleDataError(502, 'invalidResponse')
      for (const item of [...rows(response.dimensions), ...rows(response.metrics)]) text(item.apiName)
      run.metadata = response
    }
    // 命中本轮缓存仍复核权限与连接版本，不让旧 metadata 重新授予访问。
    await this.connection(run, 'ga4', signal)
    return run.metadata
  }

  async fields(input: MetadataInput, run: GoogleQueryRun, signal: AbortSignal) {
    const row = await this.connection(run, 'ga4', signal)
    const metadata = await this.metadata(row, run, signal)
    const search = input.search?.toLowerCase() ?? ''
    const fields = ['dimensions', 'metrics'].flatMap(kind => rows(metadata[kind]).map(item => ({
      kind,
      apiName: text(item.apiName),
      uiName: typeof item.uiName === 'string' ? item.uiName : '',
      description: typeof item.description === 'string' ? item.description : '',
      customDefinition: item.customDefinition === true,
      type: item.type ?? null,
      blockedReasons: item.blockedReasons ?? [],
      deprecatedApiNames: item.deprecatedApiNames ?? [],
    }))).filter(item => (!(input.customOnly ?? true) || item.customDefinition)
      && `${item.apiName} ${item.uiName} ${item.description}`.toLowerCase().includes(search))
    return {
      service: 'ga4_metadata' as const,
      source: source(row, 'ga4'),
      revision: row.revision,
      query: { customOnly: true, ...input },
      fetchedAt: new Date().toISOString(),
      fields: fields.slice(0, 100),
      matchedCount: fields.length,
      warning: '字段来自当前资源；未列出的字段不代表不存在。结果截断时请缩小 search；字段存在不代表任意组合兼容。',
    }
  }

  async ga4(input: Ga4QueryInput, run: GoogleQueryRun, signal: AbortSignal) {
    const row = await this.connection(run, 'ga4', signal)
    const metadata = await this.metadata(row, run, signal)
    const dimensionNames = new Set(rows(metadata.dimensions).map(item => text(item.apiName)))
    const metricNames = new Set(rows(metadata.metrics).map(item => text(item.apiName)))
    if ([...(input.dimensions ?? []), ...filterFields(input.dimensionFilter)].some(name => !dimensionNames.has(name))
      || [...input.metrics, ...filterFields(input.metricFilter)].some(name => !metricNames.has(name))) {
      throw new BadRequestException('unknownField')
    }
    const streamFilter = { filter: { fieldName: 'streamId', stringFilter: { matchType: 'EXACT', value: row.ga4Stream!.split('/').at(-1)! } } }
    const query = { dimensions: [] as string[], limit: 100, offset: 0, ...input }
    const effectiveFilter = input.dimensionFilter ? { andGroup: { expressions: [streamFilter, input.dimensionFilter] } } : streamFilter
    const result = await this.google.queryRequest(row, `${GOOGLE_DATA_URLS.data}/${row.ga4Property}:runReport`, {
      ...query,
      dimensions: query.dimensions.map(name => ({ name })),
      metrics: query.metrics.map(name => ({ name })),
      dimensionFilter: effectiveFilter,
      limit: String(query.limit),
      offset: String(query.offset),
      keepEmptyRows: false,
      returnPropertyQuota: true,
    }, signal)
    const dimensionHeaders = rows(result.dimensionHeaders)
    const metricHeaders = rows(result.metricHeaders)
    const expectedDimensions = [...query.dimensions, ...(query.dateRanges.length > 1 ? ['dateRange'] : [])]
    if (dimensionHeaders.length !== expectedDimensions.length || dimensionHeaders.some((header, index) => header.name !== expectedDimensions[index])
      || metricHeaders.length !== input.metrics.length || metricHeaders.some((header, index) => header.name !== input.metrics[index] || typeof header.type !== 'string')) {
      throw new GoogleDataError(502, 'invalidResponse')
    }
    const data = result.rows === undefined ? [] : Array.isArray(result.rows) ? result.rows.map(object) : undefined
    if (!data || data.length > query.limit * query.dateRanges.length)
      throw new GoogleDataError(502, 'invalidResponse')
    for (const item of data) {
      if (rows(item.dimensionValues).length !== dimensionHeaders.length || rows(item.metricValues).length !== metricHeaders.length
        || [...rows(item.dimensionValues), ...rows(item.metricValues)].some(value => typeof value.value !== 'string')) {
        throw new GoogleDataError(502, 'invalidResponse')
      }
    }
    const totalRows = count(result.rowCount ?? 0)
    if (data.length && totalRows === 0)
      throw new GoogleDataError(502, 'invalidResponse')
    const quality = object(result.metadata)
    text(quality.timeZone)
    return {
      service: 'ga4' as const,
      source: source(row, 'ga4'),
      revision: row.revision,
      query: { ...query, dimensionFilter: effectiveFilter },
      fetchedAt: new Date().toISOString(),
      dimensionHeaders,
      metricHeaders,
      rows: data,
      rowCount: totalRows,
      metadata: quality,
      propertyQuota: result.propertyQuota ?? {},
      apiRowsReturned: data.length,
      warning: '按所选数据流过滤；缺行不等于零，去重用户不能跨行相加，总计请用无分组查询。金额币种和数据质量以 metadata 为准。',
    }
  }
}

/** 按整行/整字段裁剪，保留可解析 JSON 与继续位置，不能交给外层切半截。 */
export function queryObservation(result: Awaited<ReturnType<GoogleQueryService['gsc'] | GoogleQueryService['ga4'] | GoogleQueryService['fields']>>, budget = 22000): string {
  const items = result.service === 'ga4_metadata' ? result.fields : result.rows
  const groups: Record<string, unknown>[][] = []
  if (result.service === 'ga4' && result.query.dateRanges.length > 1) {
    const rangeColumn = result.dimensionHeaders.findIndex(header => header.name === 'dateRange')
    const byKey = new Map<string, Record<string, unknown>[]>()
    for (const item of result.rows) {
      const values = rows(item.dimensionValues)
      const key = JSON.stringify(values.filter((_, index) => index !== rangeColumn))
      const group = byKey.get(key)
      if (group) {
        group.push(item)
      }
      else {
        const next = [item]
        byKey.set(key, next)
        groups.push(next)
      }
    }
  }
  else {
    groups.push(...items.map(item => [item]))
  }
  const payload = (size: number) => {
    const selected = groups.slice(0, size).flat()
    const truncated = size < groups.length || (result.service === 'ga4_metadata' && selected.length < result.matchedCount)
    if (result.service === 'ga4_metadata')
      return { ...result, fields: selected, returnedCount: selected.length, truncated }
    const offset = result.service === 'gsc' ? result.query.startRow : result.query.offset
    const next = offset + size
    const more = size < groups.length || (result.service === 'gsc' ? result.apiRowsReturned === result.query.rowLimit : next < result.rowCount || groups.length === result.query.limit)
    return { ...result, rows: selected, returnedCount: selected.length, returnedGroups: size, paginationLimitReached: more && next > 100000, paginationUnit: result.service === 'ga4' && result.query.dateRanges.length > 1 ? 'dimensionGroups' : 'rows', truncated, nextOffset: more && size && next <= 100000 ? next : null }
  }
  let lo = 0
  let hi = groups.length
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2)
    const candidate = payload(mid)
    if (candidate.returnedCount <= 1000 && JSON.stringify(candidate).length <= budget)
      lo = mid
    else hi = mid - 1
  }
  const output = JSON.stringify(payload(lo))
  if (output.length > budget || (items.length > 0 && lo === 0))
    throw new BadRequestException('resultTooLarge')
  return output
}
