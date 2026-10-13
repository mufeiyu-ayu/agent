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
  await page.getByRole('button', { name: /停\s*用/, exact: true }).click()
  await expect(page.getByText('已停用', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: /测\s*试/, exact: true }).click()
  await page.getByRole('button', { name: '测试连接', exact: true }).click()
  await expect(page.getByRole('dialog').getByText('请先完成授权')).toBeVisible()
})
