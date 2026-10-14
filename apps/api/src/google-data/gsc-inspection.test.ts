import assert from 'node:assert/strict'
import { it } from 'vitest'
import { inspectionBudgetDay, inspectionObservation, inspectionStatus, parseInspection, withinGscSite } from './gsc-inspection.js'

it('收录预算按每次请求的太平洋日记账，包含夏令时与跨午夜边界', () => {
  assert.equal(inspectionBudgetDay(new Date('2026-10-14T06:59:59Z')), '2026-10-13')
  assert.equal(inspectionBudgetDay(new Date('2026-10-14T07:00:00Z')), '2026-10-14')
  assert.equal(inspectionBudgetDay(new Date('2026-12-14T07:59:59Z')), '2026-12-13')
  assert.equal(inspectionBudgetDay(new Date('2026-12-14T08:00:00Z')), '2026-12-14')
})

it('收录参数和站点边界：拒绝跨域、身份字段、凭据、端口、重复和超量', () => {
  assert.equal(withinGscSite('https://example.test/a', 'sc-domain:example.test'), true)
  assert.equal(withinGscSite('https://www.example.test/a', 'sc-domain:example.test'), true)
  for (const url of ['https://badexample.test/a', 'https://example.test.evil.test/a']) assert.equal(withinGscSite(url, 'sc-domain:example.test'), false)
  assert.equal(withinGscSite('https://example.test/blog/a', 'https://example.test/blog/'), true)
  assert.equal(withinGscSite('https://example.test/blogger/a', 'https://example.test/blog/'), false)
  for (const value of [
    { urls: ['https://example.test'], siteUrl: 'sc-domain:other.test' },
    { urls: ['https://example.test', 'https://example.test/'] },
    { urls: ['https://secret@example.test'] },
    { urls: ['https://example.test:123/a'] },
    { urls: ['file:///etc/passwd'] },
    { urls: ['https://example.test/#hash'] },
    { urls: Array.from({ length: 21 }, (_, i) => `https://example.test/${i}`) },
  ]) assert.throws(() => parseInspection(value))
})
it('收录状态保留规范页与未知；错误响应不能解释成未收录', () => {
  const status = (index: Record<string, unknown>) => inspectionStatus({ inspectionResult: { indexStatusResult: index } }, 'https://example.test/a')
  assert.equal(status({ verdict: 'PASS', googleCanonical: 'https://example.test/a' }).status, 'indexed')
  assert.equal(status({ verdict: 'PASS', googleCanonical: 'https://example.test/b' }).status, 'other_canonical')
  assert.equal(status({ verdict: 'PASS' }).status, 'indexed_canonical_unknown')
  assert.equal(status({ verdict: 'VERDICT_UNSPECIFIED' }).status, 'unknown')
  assert.equal(status({ verdict: 'NEUTRAL', coverageState: 'Discovered - currently not indexed' }).status, 'not_indexed')
  assert.throws(() => status({}))
  assert.throws(() => inspectionStatus({}, 'https://example.test/a'))
})

it('NEUTRAL的其他规范页独立分类，长规范URL不能截断后误判为自身', () => {
  const alternate = inspectionStatus({ inspectionResult: { indexStatusResult: { verdict: 'NEUTRAL', googleCanonical: 'https://example.test/original', coverageState: 'Alternate page with proper canonical tag' } } }, 'https://example.test/alternate')
  assert.equal(alternate.status, 'other_canonical')
  const url = `https://example.test/${'a'.repeat(2048 - 'https://example.test/'.length)}`
  const canonical = `${url}/different`
  const long = inspectionStatus({ inspectionResult: { indexStatusResult: { verdict: 'PASS', googleCanonical: canonical } } }, url)
  assert.equal(long.status, 'other_canonical')
  assert.equal(long.googleCanonical, canonical)
})

it('收录输出按完整URL结果裁剪，明确列出省略项且不改变全批计数', () => {
  const rows = Array.from({ length: 20 }, (_, index) => ({ url: `https://example.test/${index}`, status: 'error', checkedAt: null, cached: false, error: 'x'.repeat(500) }))
  const result = {
    service: 'gsc_inspect' as const,
    source: { siteUrl: 'sc-domain:example.test' },
    fetchedAt: '2026-10-14T07:00:00Z',
    rows,
    summary: { targetCount: 20, checkedCount: 0, cachedCount: 0, failedCount: 20, uncheckedCount: 0 },
    budget: { days: ['2026-10-14'], limit: 2000, scope: 'platform' },
    warning: 'not indexed cannot be inferred',
  }
  const content = inspectionObservation(result, 2500)
  const output = JSON.parse(content)
  assert.ok(content.length <= 2500)
  assert.ok(output.returnedCount > 0 && output.returnedCount < 20)
  assert.equal(output.truncated, true)
  assert.equal(output.summary.failedCount, 20)
  assert.deepEqual(output.omittedUrls, rows.slice(output.returnedCount).map(row => row.url))
  assert.throws(() => inspectionObservation(result, 100))
})
