import assert from 'node:assert/strict'
import { it } from 'vitest'
import { ga4QuerySchema, parseGa4Query, parseGscQuery, parseMetadata } from './google-query-input.js'
import { queryObservation } from './google-query.service.js'

const range = { startDate: '2026-10-01', endDate: '2026-10-07' }
it('查询参数：日期、越权字段、边界与GSC聚合/小时组合', () => {
  assert.equal(parseGscQuery(range).startDate, range.startDate)
  for (const patch of [
    { startDate: '2026-02-30' },
    { endDate: '2026-09-01' },
    { endDate: '2028-01-01' },
    { siteUrl: 'sc-domain:other.test' },
    { userId: 'other' },
    { rowLimit: 1001 },
    { startRow: -1 },
    { dimensions: ['date', 'date'] },
    { dimensions: ['hour'] },
    { dataState: 'hourly_all' },
    { dimensions: ['page'], aggregationType: 'byProperty' },
    { type: 'discover', aggregationType: 'byProperty' },
  ]) assert.throws(() => parseGscQuery({ ...range, ...patch }))
  assert.equal(parseGscQuery({ ...range, dimensions: ['hour'], dataState: 'hourly_all' }).dataState, 'hourly_all')
  assert.deepEqual(parseMetadata({ customOnly: false, search: 'sessions' }), { customOnly: false, search: 'sessions' })
  assert.throws(() => parseMetadata({ propertyId: '123' }))
})
it('GA4逻辑过滤逐层校验，拒绝混用字段类型、非法数字和深度，Schema不指数膨胀', () => {
  const base = { dateRanges: [range], metrics: ['sessions'] }
  const leaf = { filter: { fieldName: 'country', stringFilter: { matchType: 'EXACT', value: 'Japan' } } }
  assert.ok(parseGa4Query({ ...base, dimensionFilter: { andGroup: { expressions: [leaf, { notExpression: leaf }] } } }))
  const number = { filter: { fieldName: 'sessions', numericFilter: { operation: 'GREATER_THAN', value: { doubleValue: 5 } } } }
  assert.ok(parseGa4Query({ ...base, metricFilter: number }))
  for (const patch of [
    { propertyId: 'other' },
    { streamId: 'other' },
    { limit: 0 },
    { offset: 100001 },
    { metrics: [] },
    { currencyCode: 'usd' },
    { dateRanges: [range, range] },
    { dimensions: ['date', 'date'] },
    { dimensionFilter: number },
    { metricFilter: leaf },
    { dimensionFilter: { andGroup: { expressions: [{ ...leaf, bypass: true }] } } },
    { metricFilter: { filter: { fieldName: 'sessions', numericFilter: { operation: 'EQUAL', value: { doubleValue: Infinity } } } } },
    { metricFilter: { filter: { fieldName: 'sessions', numericFilter: { operation: 'EQUAL', value: { int64Value: '9223372036854775808' } } } } },
    { dimensionFilter: { notExpression: { notExpression: { notExpression: { notExpression: leaf } } } } },
    { orderBys: [{ metric: { metricName: 'purchaseRevenue' } }] },
  ]) assert.throws(() => parseGa4Query({ ...base, ...patch }))
  assert.ok(JSON.stringify(ga4QuerySchema).length < 6000)
})
it('结构化截短按实际返回行推进游标，不返回半份JSON或跳过被裁掉的行', () => {
  const result = {
    service: 'gsc' as const,
    source: { siteUrl: 'sc-domain:example.test' },
    revision: 1,
    query: { ...range, dimensions: ['page'], type: 'web', dataState: 'final', aggregationType: 'auto', rowLimit: 100, startRow: 10 },
    timeZone: 'America/Los_Angeles',
    fetchedAt: '2026-10-14T00:00:00Z',
    responseAggregationType: 'byPage',
    metadata: { first_incomplete_date: '2026-10-07' },
    rows: Array.from({ length: 100 }, (_, index) => ({ keys: [`https://example.test/${index}/${'x'.repeat(100)}`], clicks: 1, impressions: 2, ctr: 0.5, position: 1 })),
    apiRowsReturned: 100,
    warning: 'not exhaustive',
  }
  const output = queryObservation(result, 1500)
  const data = JSON.parse(output)
  assert.ok(output.length <= 1500)
  assert.ok(data.rows.length > 0 && data.rows.length < 100)
  assert.equal(data.nextOffset, 10 + data.rows.length)
  assert.equal(data.truncated, true)
  assert.equal(data.metadata.first_incomplete_date, '2026-10-07')
  assert.throws(() => queryObservation(result, 100), /resultTooLarge/)
})

it('GA4 双日期区间整组截短，分页按基础维度组推进', () => {
  const result = {
    service: 'ga4' as const,
    source: { property: 'properties/42', stream: 'properties/42/dataStreams/7' },
    revision: 1,
    query: { dimensions: ['date'], metrics: ['sessions'], dateRanges: [range, { ...range, name: 'comparison' }], offset: 3, limit: 2, dimensionFilter: { filter: { fieldName: 'streamId', stringFilter: { matchType: 'EXACT', value: '7' } } } },
    fetchedAt: '2026-10-14T00:00:00Z',
    dimensionHeaders: [{ name: 'date' }, { name: 'dateRange' }],
    metricHeaders: [{ name: 'sessions', type: 'TYPE_INTEGER' }],
    rows: ['20261001', '20261002'].flatMap(date => ['current', 'comparison'].map(value => ({ dimensionValues: [{ value: date }, { value }], metricValues: [{ value: '7' }] }))),
    rowCount: 14,
    metadata: { timeZone: 'Asia/Shanghai' },
    propertyQuota: {},
    apiRowsReturned: 4,
    warning: 'quality',
  }
  const full = JSON.parse(queryObservation(result))
  assert.equal(full.returnedCount, 4)
  assert.equal(full.nextOffset, 5)
  let cropped
  for (let budget = 600; budget < 1600; budget += 20) {
    try {
      const value = JSON.parse(queryObservation(result, budget))
      if (value.returnedGroups === 1) {
        cropped = value
        break
      }
    }
    catch { /* 尚不足以放下一整组。 */ }
  }
  assert.ok(cropped)
  assert.equal(cropped.returnedCount, 2)
  assert.equal(cropped.nextOffset, 4)
  assert.equal(cropped.truncated, true)
})
