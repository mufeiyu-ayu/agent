import type { Page } from '@playwright/test'

import { expect, test } from '@playwright/test'

import { E2E_USER, installApiRoutes } from './fixtures'

function json(status: number, data: unknown, message = 'ok') {
  return {
    status,
    contentType: 'application/json',
    body: JSON.stringify(status < 400
      ? { success: true, code: 0, message, data }
      : { success: false, code: status, message, error: { statusCode: status, error: 'Error' } }),
  }
}

/** 未登录起步：me 返回 401，登录成功后 me 返回 `userAfterLogin`。 */
async function installLoggedOut(page: Page, userAfterLogin: typeof E2E_USER) {
  let user: typeof E2E_USER | null = null
  const requests: unknown[] = []

  await installApiRoutes(page, () => [])
  await page.route('**/api/auth/me', route => route.fulfill(user ? json(200, user) : json(401, null, '请先登录')))
  await page.route('**/api/auth/login', async (route) => {
    requests.push(route.request().postDataJSON())
    user = userAfterLogin
    await route.fulfill(json(200, user))
  })
  await page.route('**/api/auth/change-password', async (route) => {
    requests.push(route.request().postDataJSON())
    user = { ...userAfterLogin, mustChangePassword: false }
    await route.fulfill(json(200, user))
  })

  return requests
}

test('未登录访问 /workspace 跳 /login，登录后回到 /workspace', async ({ page }) => {
  const requests = await installLoggedOut(page, E2E_USER)

  await page.goto('/workspace')
  await expect(page).toHaveURL(/\/login\?redirect=(%2F|\/)workspace$/)

  await page.getByLabel('邮箱').fill('operator@example.com')
  await page.getByLabel('密码').fill('operator-password')
  await page.getByRole('button', { name: '登录' }).click()

  await expect(page).toHaveURL(/\/workspace$/)
  await expect(page.getByRole('textbox').first()).toBeVisible()
  expect(requests).toEqual([{ email: 'operator@example.com', password: 'operator-password' }])
})

test('落地页不登录可访问', async ({ page }) => {
  await installLoggedOut(page, E2E_USER)

  await page.goto('/')
  await expect(page).toHaveURL(/\/$/)
})

test('登录错误时留在登录页并显示后端文案', async ({ page }) => {
  await installApiRoutes(page, () => [])
  await page.route('**/api/auth/me', route => route.fulfill(json(401, null, '请先登录')))
  await page.route('**/api/auth/login', route => route.fulfill(json(401, null, '邮箱或密码错误')))

  await page.goto('/login')
  await page.getByLabel('邮箱').fill('operator@example.com')
  await page.getByLabel('密码').fill('wrong-password')
  await page.getByRole('button', { name: '登录' }).click()

  await expect(page.getByRole('alert')).toHaveText('邮箱或密码错误')
  await expect(page).toHaveURL(/\/login$/)
})

test('必须改密码的账号登录后先进改密码页，改完进入工作区', async ({ page }) => {
  const requests = await installLoggedOut(page, { ...E2E_USER, mustChangePassword: true })

  await page.goto('/workspace')
  await page.getByLabel('邮箱').fill('operator@example.com')
  await page.getByLabel('密码').fill('temp-password')
  await page.getByRole('button', { name: '登录' }).click()

  await expect(page).toHaveURL(/\/change-password\?redirect=(%2F|\/)workspace$/)
  await page.getByLabel('当前密码').fill('temp-password')
  await page.getByLabel(/^新密码/).fill('final-password')
  await page.getByLabel('确认新密码').fill('final-password')
  await page.getByRole('button', { name: '保存新密码' }).click()

  await expect(page).toHaveURL(/\/workspace$/)
  expect(requests.at(-1)).toEqual({ currentPassword: 'temp-password', newPassword: 'final-password' })
})

test('会话中接口返回 401 时跳登录页', async ({ page }) => {
  await installApiRoutes(page, () => [])
  await page.route('**/api/conversations?*', route => route.fulfill(json(401, null, '请先登录')))

  await page.goto('/workspace')
  await expect(page).toHaveURL(/\/login\?redirect=(%2F|\/)workspace$/)
})
