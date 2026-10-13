import type { McpPlugin } from '@agent/contracts'
import assert from 'node:assert/strict'
import { expect, test } from '@playwright/test'
import { installApiRoutes, installBrowserStubs } from './fixtures'

const initial: McpPlugin = {
  id: 'cloudflare',
  name: 'Cloudflare',
  description: '管理 Cloudflare 服务',
  configRevision: 'a'.repeat(64),
  url: 'https://mcp.cloudflare.com/mcp',
  icon: null,
  system: true,
  available: true,
  authType: 'oauth',
  headerNames: [],
  oauthClientId: '',
  oauthScopes: '',
  hasClientSecret: false,
  connected: false,
  enabled: false,
  needsAuth: false,
  tools: [],
}
const json = (data: unknown) => ({ json: { success: true, code: 0, message: 'ok', data } })

async function setup(page: import('@playwright/test').Page) {
  await installBrowserStubs(page, { lines: [], holdBeforeIndex: -1 })
  await installApiRoutes(page, () => [])
  let row = { ...initial }
  let connections = 0
  let disconnections = 0
  await page.route(url => url.pathname.startsWith('/api/mcp'), async (route) => {
    const url = new URL(route.request().url())
    if (url.pathname.endsWith('/config'))
      return route.fulfill(json({ callbackUrl: `${url.origin}/api/mcp/oauth/callback` }))
    if (url.pathname.endsWith('/connect')) {
      connections++
      return route.fulfill(json({ plugin: row, authorizationUrl: 'https://oauth.example/authorize' }))
    }
    if (url.pathname.endsWith('/disconnect')) {
      disconnections++
      row = { ...initial }
      return route.fulfill(json(row))
    }
    return route.fulfill(json(url.pathname === '/api/mcp' ? [row] : row))
  })
  await page.context().route('https://oauth.example/authorize', route => route.fulfill({ contentType: 'text/html', body: '<h1>受控的服务商授权页</h1>' }))
  await page.goto('/plugins')
  await page.getByRole('button', { name: /Cloudflare/ }).click()
  return {
    counts: () => ({ connections, disconnections }),
    accept: () => { row = { ...initial, connected: true, enabled: true } },
  }
}

test('OAuth 打开独立无 opener 窗口，防连点，真实回调页面通知原窗口并核对服务端状态', async ({ page }) => {
  const state = await setup(page)
  const popupReady = page.waitForEvent('popup')
  await page.getByRole('button', { name: '连接账号并启用' }).click()
  const popup = await popupReady
  await popup.waitForURL('https://oauth.example/authorize')
  assert.equal(await popup.evaluate(() => window.opener), null)
  await page.getByText('等待账号授权…', { exact: true }).waitFor()
  assert.equal(await page.getByRole('button', { name: '等待授权…', exact: true }).isDisabled(), true)
  assert.equal(state.counts().connections, 1)
  await installApiRoutes(popup, () => [])
  await popup.route(url => url.pathname.startsWith('/api/mcp'), route => route.fulfill(json([])))
  state.accept()
  const origin = new URL(page.url()).origin
  const closed = popup.waitForEvent('close')
  await popup.goto(`${origin}/plugins?oauth=connected`).catch(() => {})
  await closed
  await page.getByRole('button', { name: '停用插件' }).waitFor()
  assert.ok(page.url().endsWith('/plugins'))
  assert.equal(state.counts().connections, 1)
})

test('用户关掉授权窗口后可取消等待，清除待授权连接并允许重试；弹窗拦截不发连接请求', async ({ page }) => {
  const state = await setup(page)
  const popupReady = page.waitForEvent('popup')
  await page.getByRole('button', { name: '连接账号并启用' }).click()
  const popup = await popupReady
  await popup.waitForURL('https://oauth.example/authorize')
  await popup.close()
  await page.getByRole('button', { name: '取消授权', exact: true }).click()
  await page.getByRole('button', { name: '连接账号并启用' }).waitFor({ state: 'visible' })
  assert.equal(state.counts().disconnections, 1)
  await page.evaluate(() => {
    window.open = () => null
  })
  await page.getByRole('button', { name: '连接账号并启用' }).click()
  await page.getByRole('alert').filter({ hasText: '拦截' }).waitFor()
  assert.equal(state.counts().connections, 1)
})

test('缺少平台 OAuth 应用显示配置提示，保留 API Key 插件的密钥表单', async ({ page }) => {
  await setup(page)
  await page.getByRole('button', { name: '关闭插件详情' }).click()
  const github = { ...initial, id: 'github', name: 'GitHub', setupMessage: '需要管理员配置 OAuth 应用。' }
  const key = { ...initial, id: 'key', name: 'Google 开发文档', authType: 'headers', headerNames: ['X-Goog-Api-Key'] }
  await page.route(url => url.pathname.startsWith('/api/mcp'), route => route.fulfill(json(new URL(route.request().url()).pathname === '/api/mcp' ? [github, key] : new URL(route.request().url()).pathname.endsWith('github') ? github : key)))
  await page.getByRole('button', { name: '刷新插件' }).click()
  await page.getByRole('button', { name: /GitHub/ }).click()
  await page.getByText(/需要先配置 OAuth 应用的 Client ID/).waitFor()
  assert.equal(await page.getByRole('button', { name: '连接账号并启用' }).isDisabled(), true)
  await page.getByRole('button', { name: '关闭插件详情' }).click()
  await page.getByRole('button', { name: /Google 开发文档/ }).click()
  await page.getByLabel('X-Goog-Api-Key').waitFor()
  assert.equal(await page.getByRole('button', { name: '连接并启用' }).isEnabled(), true)
})

test('英文 OAuth 拦截、配置提示和返回状态', async ({ page }) => {
  await setup(page)
  await page.addInitScript(() => localStorage.setItem('agent-web-locale', 'en-US'))
  await page.reload()
  await page.getByRole('button', { name: /^Cloudflare/ }).click()
  await page.evaluate(() => {
    window.open = () => null
  })
  await page.getByRole('button', { name: 'Connect account and enable' }).click()
  await page.getByRole('alert').filter({ hasText: 'authorization window was blocked' }).waitFor()
  await page.goto('/plugins?oauth=failed')
  await page.getByRole('status').filter({ hasText: 'Authorization was not completed or has expired' }).waitFor()
})

test('取消请求迟到时保持写入锁，不能让旧回执结束下一次授权', async ({ page }) => {
  const state = await setup(page)
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  await page.route('**/api/mcp/cloudflare/disconnect', async (route) => {
    await gate
    await route.fulfill(json(initial))
  })
  try {
    const ready = page.waitForEvent('popup')
    await page.getByRole('button', { name: '连接账号并启用' }).click()
    const popup = await ready
    await popup.waitForURL('https://oauth.example/authorize')
    await installApiRoutes(popup, () => [])
    await popup.route(url => url.pathname.startsWith('/api/mcp'), route => route.fulfill(json([])))
    await page.getByRole('button', { name: '取消授权', exact: true }).click()
    state.accept()
    const closed = popup.waitForEvent('close')
    await popup.goto(`${new URL(page.url()).origin}/plugins?oauth=connected`).catch(() => {})
    await closed
    await expect(page.getByRole('button', { name: '停用插件' })).toBeDisabled()
    await expect(page.getByRole('button', { name: '关闭插件详情' })).toBeDisabled()
    release()
    await expect(page.getByRole('button', { name: '连接账号并启用' })).toBeEnabled()
    const nextReady = page.waitForEvent('popup')
    await page.getByRole('button', { name: '连接账号并启用' }).click()
    const nextPopup = await nextReady
    await nextPopup.waitForURL('https://oauth.example/authorize')
    await page.getByText('等待账号授权…', { exact: true }).waitFor()
    assert.equal(nextPopup.isClosed(), false)
    assert.equal(state.counts().connections, 2)
  }
  finally {
    release()
  }
})

test('不提供 randomUUID 的 HTTP 浏览器仍可打开 OAuth 并显示等待', async ({ page }) => {
  const state = await setup(page)
  await page.evaluate(() => Object.defineProperty(crypto, 'randomUUID', { value: undefined, configurable: true }))
  const ready = page.waitForEvent('popup')
  await page.getByRole('button', { name: '连接账号并启用' }).click()
  const popup = await ready
  await expect.poll(() => state.counts().connections, { timeout: 2000 }).toBe(1)
  await popup.waitForURL('https://oauth.example/authorize')
  await page.getByText('等待账号授权…', { exact: true }).waitFor()
})
