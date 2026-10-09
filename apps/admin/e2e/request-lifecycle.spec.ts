import type { AdminLlmModel, AdminLlmProvider, AdminUser } from '@agent/contracts'
import type { Page, Route } from '@playwright/test'
import assert from 'node:assert/strict'
import { expect, test } from '@playwright/test'
import { E2E_ADMIN } from './fixtures'

function fulfill(route: Route, data: unknown, status = 200) {
  return route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify({ success: status === 200, code: status === 200 ? 0 : status, data, message: status === 200 ? 'ok' : 'fixture 操作失败' }),
  })
}

async function authenticate(page: Page) {
  // 未明确提供的 API 不穿透到真实管理服务。
  await page.route('**/api/**', route => fulfill(route, null, 500))
  await page.route('**/api/auth/me', route => fulfill(route, E2E_ADMIN))
}

test('概览刷新在余额未结束时保持 loading，切换统计窗口不重取余额，失败后仍可刷新', async ({ page }) => {
  await authenticate(page)
  let statsRequests = 0
  const balances: Route[] = []
  await page.route('**/api/admin/overview/stats?*', (route) => {
    statsRequests++
    return fulfill(route, null, 502)
  })
  await page.route('**/api/admin/overview/balance', (route) => {
    balances.push(route)
  })
  await page.goto('/overview')
  await expect(page.getByText('fixture 操作失败')).toBeVisible()
  const refresh = page.getByRole('button', { name: /刷\s*新$/ })
  await expect(refresh).toHaveClass(/ant-btn-loading/)
  await refresh.dispatchEvent('click')
  assert.equal(statsRequests, 1)
  assert.equal(balances.length, 1)
  await page.getByText('近 7 天', { exact: true }).click()
  await expect.poll(() => statsRequests).toBe(2)
  assert.equal(balances.length, 1)
  await fulfill(balances[0]!, null, 502)
  await expect(refresh).not.toHaveClass(/ant-btn-loading/)
  await refresh.click()
  await expect.poll(() => statsRequests).toBe(3)
  await expect.poll(() => balances.length).toBe(2)
  await fulfill(balances[1]!, { available: false, currency: null, totalBalance: null })
  await expect(refresh).not.toHaveClass(/ant-btn-loading/)
})

test('用户审核只有当前行 loading、防重复，另一行仍可操作，失败复位且不额外加载列表', async ({ page }) => {
  await authenticate(page)
  const users: AdminUser[] = ['a', 'b'].map(id => ({
    id,
    email: `${id}@example.com`,
    name: null,
    avatarUrl: null,
    role: 'MEMBER',
    status: 'PENDING',
    mustChangePassword: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    lastLoginAt: null,
  }))
  let reads = 0
  const writes: Route[] = []
  await page.route('**/api/admin/users', (route) => {
    reads++
    return fulfill(route, users)
  })
  await page.route('**/api/admin/users/*', (route) => {
    writes.push(route)
  })
  await page.goto('/users')
  const first = page.getByRole('row').filter({ hasText: 'a@example.com' }).getByRole('button', { name: /通\s*过$/ })
  const second = page.getByRole('row').filter({ hasText: 'b@example.com' }).getByRole('button', { name: /通\s*过$/ })
  await first.click()
  await expect(first).toHaveClass(/ant-btn-loading/)
  await first.dispatchEvent('click')
  await second.click()
  await expect.poll(() => writes.length).toBe(2)
  await expect(second).toHaveClass(/ant-btn-loading/)
  await fulfill(writes[0]!, null, 502)
  await expect(page.getByText('fixture 操作失败')).toBeVisible()
  await expect(first).not.toHaveClass(/ant-btn-loading/)
  await expect(second).toHaveClass(/ant-btn-loading/)
  await first.click()
  await expect.poll(() => writes.length).toBe(3)
  await fulfill(writes[2]!, { ...users[0], status: 'ACTIVE' })
  await fulfill(writes[1]!, { ...users[1], status: 'ACTIVE' })
  await expect(page.getByRole('button', { name: /通\s*过$/ })).toHaveCount(0)
  assert.equal(reads, 1)
})

test('B10：初始列表等待中创建用户，旧 GET 返回后新用户仍可见', async ({ page }) => {
  await authenticate(page)
  const pending: Route[] = []
  let creates = 0
  const user: AdminUser = { id: 'new-user', email: 'new-user@example.com', name: null, avatarUrl: null, role: 'MEMBER', status: 'ACTIVE', mustChangePassword: true, lastLoginAt: null, createdAt: '2026-10-07T00:00:00Z' }
  await page.route('**/api/admin/users', (route) => {
    if (route.request().method() === 'GET') {
      pending.push(route)
      return
    }
    creates++
    return fulfill(route, user)
  })
  await page.goto('/users')
  await expect.poll(() => pending.length).toBe(1)
  await page.getByRole('button', { name: /新建用户$/ }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('邮箱').fill(user.email)
  await dialog.getByLabel('初始密码', { exact: true }).fill('fixture-password-123')
  await dialog.getByRole('button', { name: /新建用户$/ }).click()
  await expect(dialog).not.toBeVisible()
  assert.equal(creates, 1)
  await fulfill(pending[0]!, [])
  await expect(page.getByRole('row').filter({ hasText: user.email })).toBeVisible()
  assert.equal(pending.length, 1)
})

test('模型写入防重且可重试；模型与服务商编辑开关只切换一次并正确保存', async ({ page }) => {
  await authenticate(page)
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  let provider: AdminLlmProvider = {
    id: 'p',
    family: 'openai',
    note: 'fixture',
    baseUrl: 'https://fixture.invalid',
    apiKeyLast4: '1234',
    enabled: true,
    useProxy: false,
    modelCount: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
  let model: AdminLlmModel = {
    id: 'm',
    providerId: 'p',
    wireName: 'fixture-model',
    displayName: 'fixture-model',
    contextWindowTokens: 65536,
    maxInputTokens: 32000,
    maxOutputTokens: 8192,
    reasoningEffort: null,
    supportsImageInput: false,
    visible: true,
    isDefault: false,
    sortOrder: 0,
    lastProbeOk: null,
    lastProbeError: null,
    lastProbedAt: null,
    createdAt: provider.createdAt,
    updatedAt: provider.updatedAt,
  }
  let modelReads = 0
  const writes: Route[] = []
  await page.route('**/api/admin/llm/providers', route => fulfill(route, [provider]))
  await page.route('**/api/admin/llm/providers/p', (route) => {
    provider = { ...provider, ...route.request().postDataJSON() }
    return fulfill(route, provider)
  })
  await page.route('**/api/admin/llm/models', (route) => {
    modelReads++
    return fulfill(route, [model])
  })
  await page.route('**/api/admin/llm/models/m', (route) => {
    writes.push(route)
  })
  await page.goto('/llm-models')
  const visible = page.getByRole('row').filter({ hasText: 'fixture-model' }).getByRole('switch', { name: '前台可见' })
  await page.locator('.provider-card').click()
  assert.equal(modelReads, 1)
  await visible.click()
  await expect(visible).toHaveClass(/ant-switch-loading/)
  await expect(visible).toBeDisabled()
  await visible.dispatchEvent('click')
  await expect.poll(() => writes.length).toBe(1)
  await fulfill(writes[0]!, null, 502)
  await expect(page.getByText('fixture 操作失败')).toBeVisible()
  await expect(visible).toBeEnabled()
  await expect(visible).toBeChecked()
  await visible.click()
  await expect.poll(() => writes.length).toBe(2)
  model = { ...model, visible: false }
  await fulfill(writes[1]!, model)
  await expect(visible).not.toBeChecked()
  await expect(visible).toBeEnabled()
  assert.equal(modelReads, 2)

  const row = page.getByRole('row').filter({ hasText: 'fixture-model' })
  await row.locator('.action-icon-btn').filter({ has: page.locator('[aria-label="edit"]') }).click()
  const modelDialog = page.getByRole('dialog', { name: '编辑模型' })
  for (const label of ['前台可见', '设为默认模型', '图片输入']) {
    const card = modelDialog.locator('.toggle-card').filter({ hasText: label })
    const toggle = card.getByRole('switch')
    await expect(toggle).not.toBeChecked()
    await toggle.click()
    await expect(toggle).toBeChecked()
    await card.getByText(label, { exact: true }).click()
    await expect(toggle).not.toBeChecked()
    await toggle.press('Space')
    await expect(toggle).toBeChecked()
  }
  assert.deepEqual(errors, [])
  await modelDialog.getByRole('button', { name: /确\s*定$/ }).click()
  await expect.poll(() => writes.length).toBe(3)
  const input = writes[2]!.request().postDataJSON()
  assert.deepEqual([input.visible, input.isDefault, input.supportsImageInput], [true, true, true])
  model = { ...model, ...input }
  await fulfill(writes[2]!, model)
  await expect(modelDialog).not.toBeVisible()
  await expect(row.getByRole('switch', { name: '图片输入' })).toBeChecked()

  await page.locator('.provider-card .footer-actions .action-btn').filter({ has: page.locator('[aria-label="edit"]') }).click()
  const providerDialog = page.getByRole('dialog', { name: '编辑服务商' })
  const statusCard = providerDialog.locator('.status-toggle-card')
  const enabled = statusCard.getByRole('switch')
  await expect(enabled).toBeChecked()
  await enabled.click()
  await expect(enabled).not.toBeChecked()
  await statusCard.locator('.status-label').click()
  await expect(enabled).toBeChecked()
  await enabled.press('Space')
  await expect(enabled).not.toBeChecked()
  assert.deepEqual(errors, [])
  await providerDialog.getByRole('button', { name: /确\s*定$/ }).click()
  await expect(providerDialog).not.toBeVisible()
  assert.equal(provider.enabled, false)
})
