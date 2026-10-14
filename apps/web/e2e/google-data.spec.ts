import type { GoogleDataConnection } from '@agent/contracts'
import { expect, test } from '@playwright/test'
import { installApiRoutes, installBrowserStubs } from './fixtures'

const initial: GoogleDataConnection = { configured: true, connected: false, needsAuth: false, authorizing: false, email: null, services: [], selection: { gscSite: null, ga4Property: null, ga4Stream: null }, revision: 0 }
const json = (data: unknown) => ({ json: { success: true, code: 0, data } })
async function setup(page: import('@playwright/test').Page, seed: Partial<GoogleDataConnection> = {}) {
  await installBrowserStubs(page, { lines: [] })
  await installApiRoutes(page, () => [])
  const state = { ...structuredClone(initial), ...seed }
  const calls: Array<{ path: string, body: Record<string, unknown> }> = []
  let release: (() => void) | undefined
  let gate: Promise<void> | undefined
  let denied = false
  let ga4Unavailable = false
  let expiredOnResource = false
  await page.route(url => url.pathname.startsWith('/api/mcp'), route => route.fulfill(json(route.request().url().endsWith('/config') ? { callbackUrl: 'http://localhost:5173/api/mcp/oauth/callback' } : [])))
  await page.route(url => url.pathname.startsWith('/api/google-data'), async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    const path = url.pathname
    const body = request.postData() ? request.postDataJSON() : {}
    if (request.method() === 'POST') {
      calls.push({ path, body })
      if (gate)
        await gate
    }
    if (path.endsWith('/connect')) {
      state.authorizing = true
      return route.fulfill(json({ authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth?state=fixture' }))
    }
    if (path.endsWith('/cancel'))
      state.authorizing = false
    if (path.endsWith('/disconnect'))
      Object.assign(state, structuredClone(initial), { revision: state.revision + 1 })
    if (path.endsWith('/resources')) {
      if (expiredOnResource) {
        state.needsAuth = true
        state.revision++
        return route.fulfill({ status: 502, json: { success: false, message: 'needsAuth' } })
      }
      if (ga4Unavailable && url.searchParams.get('service') === 'ga4')
        return route.fulfill({ status: 502, json: { success: false, message: 'permissionDenied' } })
      return route.fulfill(json(url.searchParams.get('service') === 'gsc'
        ? [{ id: 'sc-domain:topuplist.com', name: 'sc-domain:topuplist.com' }]
        : url.searchParams.has('property')
          ? [{ id: 'properties/42/dataStreams/7', name: '生产流', url: 'https://topuplist.com' }]
          : [{ id: 'properties/42', name: 'Topuplist' }]))
    }
    if (path.endsWith('/selection')) {
      if (body.service === 'gsc') {
        state.selection.gscSite = body.resource
      }
      else {
        state.selection.ga4Property = body.resource
        state.selection.ga4Stream = body.stream
      }
      state.revision++
    }
    if (path.endsWith('/verify')) {
      if (body.revision !== state.revision)
        return route.fulfill({ status: 409, json: { success: false, message: 'connectionChanged' } })
      if (denied)
        return route.fulfill({ status: 502, json: { success: false, message: 'permissionDenied' } })
      return route.fulfill(json({ revision: state.revision, service: body.service, checkedAt: '2026-10-14T02:00:00Z', hasData: false }))
    }
    return route.fulfill(json(state))
  })
  return { state, calls, expire: () => {
    expiredOnResource = true
  }, failGa4: () => {
    ga4Unavailable = true
  }, deny: () => {
    denied = true
  }, hold: () => {
    gate = new Promise<void>((resolve) => {
      release = resolve
    })
  }, release: () => {
    gate = undefined
    release?.()
  } }
}
async function open(page: import('@playwright/test').Page) {
  await page.goto('/plugins')
  await page.locator('[data-connection-id="google-data"] button').click()
  await expect(page.getByRole('dialog')).toBeVisible()
}

test('系统目录发现，缺少平台配置不要求用户填密钥，搜索与个人目录正常', async ({ page }) => {
  await setup(page, { configured: false })
  await open(page)
  await expect(page.getByText('平台尚未配置 Google 数据授权，请联系管理员。你无需提供密钥。')).toBeVisible()
  await expect(page.getByRole('dialog').getByRole('textbox')).toHaveCount(0)
  await page.getByRole('dialog').getByRole('button', { name: '关闭', exact: true }).click()
  await page.getByRole('searchbox').fill('GSC')
  await expect(page.locator('[data-connection-id="google-data"]')).toBeVisible()
  await page.getByRole('searchbox').fill('unrelated')
  await expect(page.locator('[data-connection-id="google-data"]')).toBeHidden()
  await page.getByRole('searchbox').fill('')
  await page.getByRole('tab', { name: /个人/ }).click()
  await expect(page.locator('[data-connection-id="google-data"]')).toBeHidden()
})

test('授权防重，整页返回后恢复状态，可取消授权；失败回调不伪报成功', async ({ page }) => {
  const fixture = await setup(page)
  await page.route('https://accounts.google.com/**', route => route.fulfill({ contentType: 'text/html', body: '<h1>Google 授权</h1>' }))
  await open(page)
  fixture.hold()
  await page.getByRole('button', { name: '连接 Google', exact: true }).click()
  await expect(page.getByRole('button', { name: '处理中…' })).toBeDisabled()
  expect(fixture.calls.filter(call => call.path.endsWith('/connect'))).toHaveLength(1)
  fixture.release()
  await expect(page).toHaveURL(/accounts.google.com/)
  await page.goBack()
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })))
  if (!await page.getByRole('dialog').isVisible())
    await page.locator('[data-connection-id="google-data"] button').click()
  await page.getByRole('button', { name: '取消本次授权' }).click()
  await expect(page.getByRole('button', { name: '连接 Google', exact: true })).toBeEnabled()
  await page.goto('/plugins?googleData=failed')
  await expect(page.getByRole('dialog')).toBeVisible()
  await expect(page.getByText('授权未完成或已过期，请重新连接。')).toBeVisible()
})

test('GSC 选择、验证无数据和错误、断开后删除连接状态', async ({ page }) => {
  const fixture = await setup(page, { connected: true, email: 'operator@example.test', services: ['gsc'] })
  await open(page)
  await expect(page.getByRole('button', { name: '验证连接' })).toBeDisabled()
  await page.getByLabel('GSC 站点').selectOption('sc-domain:topuplist.com')
  await page.getByRole('button', { name: '保存选择' }).click()
  await expect(page.getByRole('button', { name: '验证连接' })).toBeEnabled()
  await page.getByRole('button', { name: '验证连接' }).click()
  await expect(page.getByText(/本次时间窗未返回数据，不代表流量为零/)).toBeVisible()
  await page.screenshot({ path: '/tmp/kuro-google-data-desktop.png', fullPage: true })
  fixture.deny()
  await page.getByRole('button', { name: '验证连接' }).click()
  await expect(page.getByRole('alert')).toContainText('Google 拒绝访问')
  await page.getByRole('button', { name: '断开 Google 数据', exact: true }).click()
  await page.getByRole('button', { name: '确认断开' }).click()
  await expect(page.getByRole('button', { name: '连接 Google', exact: true })).toBeVisible()
  await expect(page.getByText('operator@example.test')).toHaveCount(0)
})

test('窄屏 GA4 生产流选择与真实状态回调，未保存选择不能验证', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  const fixture = await setup(page, { connected: true, email: 'operator@example.test', services: ['ga4'] })
  await page.goto('/plugins?googleData=connected')
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.getByLabel('GA4 资源').selectOption('properties/42')
  await page.getByLabel('Web 数据流').selectOption('properties/42/dataStreams/7')
  await expect(page.getByRole('button', { name: '验证连接' })).toBeDisabled()
  await page.getByRole('button', { name: '保存选择' }).click()
  await expect(page.getByRole('button', { name: '验证连接' })).toBeEnabled()
  expect(fixture.state.selection.ga4Stream).toBe('properties/42/dataStreams/7')
  await page.getByRole('button', { name: '验证连接' }).click()
  await expect(page.getByText(/本次时间窗未返回数据/)).toBeVisible()
  await page.screenshot({ path: '/tmp/kuro-google-data-mobile.png', fullPage: true })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy()
})

test('GA4 列表失败不阻断 GSC，旧标签页不能验证其他版本的资源', async ({ page }) => {
  const fixture = await setup(page, { connected: true, email: 'operator@example.test', services: ['gsc', 'ga4'] })
  fixture.failGa4()
  await open(page)
  await expect(page.getByRole('alert')).toContainText('Google 拒绝访问')
  await page.getByLabel('GSC 站点').selectOption('sc-domain:topuplist.com')
  await page.getByRole('button', { name: '保存选择' }).first().click()
  await expect(page.getByRole('button', { name: '验证连接' }).first()).toBeEnabled()
  fixture.state.revision++
  await page.getByRole('button', { name: '验证连接' }).first().click()
  await expect(page.getByText('连接已发生变化，请刷新后重试。')).toBeVisible()
  await expect(page.getByText(/验证成功：/)).toHaveCount(0)
})

test('资源刷新发现授权失效立即更新连接状态并清除旧验证提示', async ({ page }) => {
  const fixture = await setup(page, { connected: true, email: 'operator@example.test', services: ['gsc'], selection: { gscSite: 'sc-domain:topuplist.com', ga4Property: null, ga4Stream: null } })
  await open(page)
  await page.getByRole('button', { name: '验证连接' }).click()
  await expect(page.getByText(/验证成功：/)).toBeVisible()
  fixture.expire()
  await page.getByRole('button', { name: '刷新资源列表' }).click()
  await expect(page.getByRole('dialog').getByText('需要重新授权', { exact: true })).toBeVisible()
  await expect(page.getByText(/验证成功：/)).toHaveCount(0)
  await expect(page.getByRole('button', { name: '重新授权 / 更换账号' })).toBeEnabled()
})
