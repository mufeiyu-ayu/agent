import type { AdminUser } from '@agent/contracts'
import type { Page, Route } from '@playwright/test'

import { expect, test } from '@playwright/test'

import { E2E_ADMIN } from './fixtures'

function fulfill(route: Route, status: number, data: unknown, message = 'ok') {
  return route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(status < 400
      ? { success: true, code: 0, message, data }
      : { success: false, code: status, message, error: { statusCode: status, error: 'Error' } }),
  })
}

/** 未登录起步，登录后 me 返回 `userAfterLogin`；记录所有 /api/admin/* 请求。 */
async function installLoggedOut(page: Page, userAfterLogin: typeof E2E_ADMIN) {
  let user: typeof E2E_ADMIN | null = null
  const adminRequests: string[] = []

  await page.route('**/api/admin/**', (route) => {
    adminRequests.push(route.request().url())
    return fulfill(route, 403, null, '需要管理员权限')
  })
  await page.route('**/api/auth/me', route => user ? fulfill(route, 200, user) : fulfill(route, 401, null, '请先登录'))
  await page.route('**/api/auth/login', (route) => {
    user = userAfterLogin
    return fulfill(route, 200, user)
  })

  return adminRequests
}

test('成员登录管理台只看到「无权限」，不进入任何页面', async ({ page }) => {
  const adminRequests = await installLoggedOut(page, { ...E2E_ADMIN, role: 'MEMBER', email: 'member@example.com' })

  await page.goto('/overview')
  await expect(page).toHaveURL(/\/login\?redirect=(%2F|\/)overview$/)

  await page.getByLabel('邮箱').fill('member@example.com')
  await page.getByLabel('密码').fill('member-password')
  await page.getByRole('button', { name: '登 录' }).click()

  await expect(page).toHaveURL(/\/forbidden$/)
  await expect(page.getByText('无权限')).toBeVisible()
  await expect(page.getByText('member@example.com 不是管理员')).toBeVisible()
  await expect(page.locator('.admin-sidebar')).toHaveCount(0)
  expect(adminRequests).toEqual([])
})

test('管理员在「系统管理 → 用户列表」查看并新建用户', async ({ page }) => {
  const users: AdminUser[] = [{
    id: 'admin-1',
    email: 'admin@example.com',
    role: 'ADMIN',
    disabled: false,
    mustChangePassword: false,
    lastLoginAt: '2026-09-27T01:00:00.000Z',
    createdAt: '2026-09-27T00:00:00.000Z',
  }]
  const created: unknown[] = []

  await page.route('**/api/auth/me', route => fulfill(route, 200, E2E_ADMIN))
  await page.route('**/api/admin/users', async (route) => {
    if (route.request().method() === 'GET')
      return fulfill(route, 200, users)

    const body = route.request().postDataJSON() as { email: string, role: AdminUser['role'] }
    created.push(body)
    return fulfill(route, 201, { ...users[0], id: 'user-2', email: body.email, role: body.role, mustChangePassword: true, lastLoginAt: null })
  })

  await page.goto('/users')
  await expect(page.getByText('系统管理')).toBeVisible()
  await expect(page.getByRole('link', { name: '用户列表' })).toHaveAttribute('aria-current', 'page')
  await expect(page.getByRole('cell', { name: 'admin@example.com' })).toBeVisible()

  await page.getByRole('button', { name: '新建用户' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('邮箱').fill('operator@example.com')
  await dialog.getByLabel('初始密码').fill('operator-initial')
  await dialog.getByRole('button', { name: '新建用户' }).click()

  await expect(page.getByRole('cell', { name: 'operator@example.com' })).toBeVisible()
  await expect(page.getByText('待改密码')).toBeVisible()
  expect(created).toEqual([{ email: 'operator@example.com', password: 'operator-initial', role: 'MEMBER' }])
})
