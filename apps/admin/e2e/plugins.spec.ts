import { expect, test } from '@playwright/test'
import { E2E_ADMIN } from './fixtures'

test('系统插件管理：真实表单输入、防连点、停用和测试反馈', async ({ page }) => {
  const rows: Array<Record<string, unknown>> = []
  const writes: unknown[] = []
  let releaseList!: () => void
  const initialList = new Promise<void>((resolve) => {
    releaseList = resolve
  })
  let reads = 0
  const json = (data: unknown) => ({ json: { success: true, code: 0, data } })
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  await page.route('**/api/auth/me', route => route.fulfill(json(E2E_ADMIN)))
  await page.route('**/api/admin/mcp**', async (route) => {
    const request = route.request()
    if (request.method() === 'GET') {
      if (reads++ === 0)
        await initialList
      await route.fulfill(json(rows))
      return
    }
    const body = request.postDataJSON()
    writes.push(body)
    if (request.url().endsWith('/test')) {
      await route.fulfill({
        status: 400,
        json: { success: false, message: '请先完成授权' },
      })
      return
    }
    if (request.url().endsWith('/enabled')) {
      rows[0]!.available = body.enabled
      await route.fulfill(json(rows[0]))
      return
    }
    await gate
    const plugin = {
      ...body,
      id: 'system-test',
      configRevision: 'a'.repeat(64),
      available: true,
      system: true,
      connected: false,
      enabled: false,
      needsAuth: false,
      tools: [],
    }
    rows.push(plugin)
    await route.fulfill(json(plugin))
  })
  await page.goto('/plugins')
  await page.getByRole('button', { name: '新增插件' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.locator('input:not([type="file"])').first().fill('服务目录')
  await dialog.getByPlaceholder('https://example.com/mcp').fill('https://example.com/mcp')
  await dialog.getByRole('button', { name: /保\s*存/, exact: true }).click()
  await expect(dialog.getByPlaceholder('https://example.com/mcp')).toBeDisabled()
  await expect(dialog.getByRole('button', { name: /取\s*消/ })).toBeDisabled()
  expect(writes).toHaveLength(1)
  release()
  await expect(page.getByText('服务目录', { exact: true })).toBeVisible()
  releaseList()
  await expect(page.getByRole('button', { name: /刷\s*新/ })).not.toHaveClass(/ant-btn-loading/)
  await page.getByRole('switch', { name: '上架状态：服务目录' }).click()
  await expect(page.getByRole('switch', { name: '上架状态：服务目录' })).not.toBeChecked()
  await page.getByRole('button', { name: /测\s*试/, exact: true }).click()
  await page.getByRole('button', { name: '测试连接', exact: true }).click()
  await expect(page.getByRole('dialog').getByText('请先完成授权')).toBeVisible()
})

test('上架状态为独立开关列：慢请求防连点、失败保持原状态、成功不移动行', async ({ page }) => {
  const rows = [
    { id: 'first', name: '第一个插件', description: '', authType: 'none', available: true, system: true },
    { id: 'second', name: '第二个插件', description: '', authType: 'none', available: false, system: true },
  ]
  const writes: unknown[] = []
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const json = (data: unknown) => ({ json: { success: true, code: 0, data } })
  await page.route('**/api/auth/me', route => route.fulfill(json(E2E_ADMIN)))
  await page.route('**/api/admin/mcp**', async (route) => {
    if (route.request().method() === 'GET')
      return route.fulfill(json(rows))
    const body = route.request().postDataJSON()
    writes.push(body)
    if (writes.length === 1)
      await gate
    if (writes.length === 2)
      return route.fulfill({ status: 500, json: { success: false, code: 500, message: '本次更新失败' } })
    rows[0]!.available = body.enabled
    return route.fulfill(json(rows[0]))
  })
  await page.goto('/plugins')
  const toggle = page.getByRole('switch', { name: '上架状态：第一个插件' })
  const other = page.getByRole('switch', { name: '上架状态：第二个插件' })
  await expect(page.getByRole('columnheader', { name: '上架状态' })).toBeVisible()
  await expect(page.getByRole('button', { name: /^(上架|停用)$/ })).toHaveCount(0)
  await expect(toggle).toBeChecked()
  await toggle.click()
  await expect(toggle).toBeDisabled()
  await expect(toggle).toHaveClass(/ant-switch-loading/)
  await expect(other).toBeDisabled()
  await expect(other).not.toHaveClass(/ant-switch-loading/)
  await toggle.evaluate(element => (element as HTMLButtonElement).click())
  expect(writes).toEqual([{ enabled: false }])
  release()
  await expect(toggle).not.toBeChecked()
  await expect(toggle).toBeEnabled()
  const names = () => page.locator('.plugin-name').allTextContents()
  await expect.poll(names).toEqual(['第一个插件', '第二个插件'])
  await toggle.click()
  await expect(page.getByText('本次更新失败', { exact: true })).toBeVisible()
  await expect(toggle).not.toBeChecked()
  await expect(toggle).toBeEnabled()
  await toggle.click()
  await expect(toggle).toBeChecked()
  await expect.poll(names).toEqual(['第一个插件', '第二个插件'])
})

const testPluginRow = {
  id: 'oauth-test',
  name: '授权测试插件',
  description: '',
  url: 'https://example.com/mcp',
  configRevision: 'a'.repeat(64),
  authType: 'oauth',
  headerNames: [],
  available: true,
  system: true,
  connected: false,
  enabled: false,
  needsAuth: false,
  tools: [],
}
const response = (data: unknown) => ({ json: { success: true, code: 0, data } })

async function openConnectionTest(page: import('@playwright/test').Page) {
  await page.route('**/api/auth/me', route => route.fulfill(response(E2E_ADMIN)))
  await page.goto('/plugins')
  await page.getByRole('button', { name: /测\s*试/, exact: true }).click()
  return page.getByRole('dialog')
}

test('连接反馈只认服务端 connected，零工具成功，重试失败清除旧成功', async ({ page }) => {
  let attempts = 0
  await page.route('**/api/admin/mcp**', async (route) => {
    if (route.request().method() === 'GET')
      return route.fulfill(response([testPluginRow]))
    attempts++
    if (attempts === 2)
      return route.fulfill({ status: 400, json: { success: false, message: '本次测试失败' } })
    return route.fulfill(response({ plugin: { ...testPluginRow, connected: attempts === 1 } }))
  })
  const dialog = await openConnectionTest(page)
  const button = dialog.getByRole('button', { name: '测试连接', exact: true })
  await button.click()
  await expect(dialog.getByText(/连接成功，发现 0 个工具/)).toBeVisible()
  await button.click()
  await expect(dialog.getByText('本次测试失败')).toBeVisible()
  await expect(dialog.getByText(/连接成功/)).toHaveCount(0)
  await button.click()
  await expect(dialog.getByText('连接尚未完成，请重新测试。')).toBeVisible()
  await expect(dialog.getByText(/连接成功/)).toHaveCount(0)
})

test('OAuth 跳转前显示等待且防连点，浏览器后退后没有未经确认的成功', async ({ page }) => {
  let writes = 0
  await page.route('**/api/admin/mcp**', (route) => {
    if (route.request().method() === 'GET')
      return route.fulfill(response([testPluginRow]))
    writes++
    return route.fulfill(response({ plugin: testPluginRow, authorizationUrl: 'https://oauth.example.test/authorize' }))
  })
  await page.route('https://oauth.example.test/authorize', route =>
    route.fulfill({ contentType: 'text/html; charset=utf-8', body: '<h1>模拟授权页</h1>' }))
  const dialog = await openConnectionTest(page)
  // 仅拦截第一次导航，观察离页前反馈；随后实际跳转并后退。
  await page.evaluate(() => window.navigation.addEventListener('navigate', event => event.preventDefault(), { once: true }))
  const button = dialog.getByRole('button', { name: /测试连接/ })
  await button.click()
  await expect(dialog.getByText('正在跳转授权，完成授权后请重新测试连接。')).toBeVisible()
  await expect(dialog.getByText(/连接成功/)).toHaveCount(0)
  await expect(button).toHaveClass(/ant-btn-loading/)
  await expect(dialog.getByRole('button', { name: /关\s*闭/, exact: true })).toBeDisabled()
  expect(writes).toBe(1)
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })))
  await expect(button).not.toHaveClass(/ant-btn-loading/)
  await expect(dialog.getByText('正在跳转授权，完成授权后请重新测试连接。')).toHaveCount(0)
  await button.click()
  await page.waitForURL('https://oauth.example.test/authorize')
  await page.goBack()
  await expect(page.getByText('授权测试插件', { exact: true })).toBeVisible()
  await expect(page.getByText(/连接成功/)).toHaveCount(0)
  await expect(page.getByText('正在跳转授权，完成授权后请重新测试连接。')).toHaveCount(0)
})

test('模拟 bfcache pageshow 恢复清除旧成功，重新读取服务端连接状态', async ({ page }) => {
  let reads = 0
  await page.route('**/api/admin/mcp**', (route) => {
    if (route.request().method() === 'GET') {
      reads++
      return route.fulfill(response([{ ...testPluginRow, name: reads > 1 ? '恢复后服务端插件' : testPluginRow.name }]))
    }
    return route.fulfill(response({ plugin: { ...testPluginRow, connected: true } }))
  })
  const dialog = await openConnectionTest(page)
  await dialog.getByRole('button', { name: /测试连接/ }).click()
  await expect(dialog.getByText(/连接成功/)).toBeVisible()
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })))
  await expect(page.getByText('恢复后服务端插件', { exact: true })).toBeVisible()
  await expect(dialog.getByText(/连接成功/)).toHaveCount(0)
  await expect(dialog.getByRole('button', { name: /测试连接/ })).not.toHaveClass(/ant-btn-loading/)
})
