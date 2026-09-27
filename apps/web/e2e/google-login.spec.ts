import type { Page } from '@playwright/test'

import { expect, test } from '@playwright/test'

import { E2E_USER, installApiRoutes } from './fixtures'

/** Issue #198：首页登录弹窗、Google 按钮、One Tap 前端链路与头像回退。Google 与 API 全部由 page.route 提供。 */

const CLIENT_ID = 'e2e-client.apps.googleusercontent.com'

function json(status: number, data: unknown, message = 'ok') {
  return {
    status,
    contentType: 'application/json',
    body: JSON.stringify(status < 400
      ? { success: true, code: 0, message, data }
      : { success: false, code: status, message, error: { statusCode: status, error: 'Error' } }),
  }
}

/** 未登录起步；密码登录或 One Tap 成功后 me 返回 E2E_USER。返回 GIS 脚本被请求的次数。 */
async function installLoggedOut(page: Page, options: { googleClientId?: string | null, oneTap?: unknown } = {}) {
  let user: typeof E2E_USER | null = null
  const calls = { gis: 0, oneTap: [] as unknown[] }

  await installApiRoutes(page, () => [])
  await page.route('**/api/auth/config', route => route.fulfill(json(200, { googleClientId: options.googleClientId ?? null })))
  await page.route('**/api/auth/me', route => route.fulfill(user ? json(200, user) : json(401, null, '请先登录')))
  await page.route('**/api/auth/login', async (route) => {
    user = E2E_USER
    await route.fulfill(json(200, user))
  })
  await page.route('**/api/auth/google/one-tap/nonce', route => route.fulfill(json(200, { nonce: 'nonce-1' })))
  await page.route('**/api/auth/google/one-tap', async (route) => {
    calls.oneTap.push(route.request().postDataJSON())
    const result = options.oneTap ?? { status: 'ok', user: E2E_USER }

    if ((result as { status: string }).status === 'ok')
      user = E2E_USER

    await route.fulfill(json(200, result))
  })
  // 假 GIS：prompt 时立刻回调一个 credential，模拟用户点了 One Tap 卡片。
  await page.route('https://accounts.google.com/gsi/client', (route) => {
    calls.gis += 1
    return route.fulfill({
      contentType: 'text/javascript',
      body: `window.google = { accounts: { id: {
        initialize(config) { window.__gis = config },
        prompt() { window.__gis.callback({ credential: 'header.payload.signature' }) },
        cancel() {},
      } } }`,
    })
  })

  return calls
}

test('AC-17 未登录时 Log in 与三处 Start asking 都弹同一个登录框，地址栏不变；登录后进入工作台', async ({ page }) => {
  await installLoggedOut(page)
  await page.goto('/')
  const dialog = page.getByRole('dialog')
  const openers = [
    page.locator('.nav').getByRole('button', { name: 'Log in' }),
    page.locator('.nav').getByRole('button', { name: 'Start asking' }),
    page.locator('.hero').getByRole('button', { name: 'Start asking' }),
    page.locator('.final').getByRole('button', { name: 'Start asking' }),
  ]

  for (const opener of openers) {
    await opener.click()
    await expect(dialog.getByRole('heading', { name: '登录', level: 1 })).toBeVisible()
    await expect(page).toHaveURL(/\/$/)
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
  }

  await openers[2]!.click()
  await dialog.getByLabel('邮箱').fill('operator@example.com')
  await dialog.getByLabel('密码').fill('operator-password')
  await dialog.getByRole('button', { name: '登录', exact: true }).click()

  await expect(page).toHaveURL(/\/workspace$/)
  await expect(page.getByRole('textbox').first()).toBeVisible()
})

test('AC-17 已登录时导航显示 Open workspace，Start asking 直达工作台', async ({ page }) => {
  await installApiRoutes(page, () => [])
  await page.goto('/')

  await expect(page.locator('.nav').getByRole('link', { name: 'Open workspace' })).toBeVisible()
  await expect(page.locator('.nav').getByRole('button', { name: 'Log in' })).toHaveCount(0)
  await page.locator('.final').getByRole('link', { name: 'Start asking' }).click()
  await expect(page).toHaveURL(/\/workspace$/)
})

test('AC-14 One Tap：未登录打开首页即弹出，点一下登录并进入工作台；nonce 与客户端 ID 交给 GIS', async ({ page }) => {
  const calls = await installLoggedOut(page, { googleClientId: CLIENT_ID })

  await page.goto('/')

  await expect(page).toHaveURL(/\/workspace$/)
  expect(calls.oneTap).toEqual([{ credential: 'header.payload.signature' }])
  expect(await page.evaluate(() => {
    const config = (window as unknown as { __gis?: { client_id: string, nonce: string } }).__gis
    return config && { clientId: config.client_id, nonce: config.nonce }
  })).toEqual({ clientId: CLIENT_ID, nonce: 'nonce-1' })
})

test('AC-14 已登录时首页与 /login 都不加载 One Tap', async ({ page }) => {
  const calls = await installLoggedOut(page, { googleClientId: CLIENT_ID })
  await page.route('**/api/auth/me', route => route.fulfill(json(200, E2E_USER)))

  await page.goto('/')
  await expect(page.locator('.nav').getByRole('link', { name: 'Open workspace' })).toBeVisible()
  await page.goto('/login')
  await expect(page.getByRole('button', { name: '使用 Google 登录' })).toBeVisible()

  expect(calls.gis).toBe(0)
  expect(calls.oneTap).toEqual([])
})

test('AC-16 One Tap 得到待审核时，首页弹框显示等待管理员审核', async ({ page }) => {
  await installLoggedOut(page, { googleClientId: CLIENT_ID, oneTap: { status: 'pending' } })

  await page.goto('/')

  await expect(page.getByRole('dialog').getByRole('heading', { name: '等待管理员审核', level: 1 })).toBeVisible()
  await expect(page).toHaveURL(/\/$/)
})

test('AC-19 GIS 脚本不可达时首页与登录页照常可用，没有未处理异常', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await installLoggedOut(page, { googleClientId: CLIENT_ID })
  await page.route('https://accounts.google.com/**', route => route.abort('connectionrefused'))

  await page.goto('/')
  await page.locator('.nav').getByRole('button', { name: 'Log in' }).click()
  await expect(page.getByRole('dialog').getByRole('button', { name: '使用 Google 登录' })).toBeVisible()
  await page.keyboard.press('Escape')

  await page.goto('/login')
  await page.getByLabel('邮箱').fill('operator@example.com')
  await page.getByLabel('密码').fill('operator-password')
  await page.getByRole('button', { name: '登录', exact: true }).click()
  await expect(page).toHaveURL(/\/workspace$/)
  expect(errors).toEqual([])
})

test('登录页：未开启 Google 不显示按钮；开启后点按钮带回跳地址去 /api/auth/google/start；回调结果显示在登录页', async ({ page }) => {
  await installLoggedOut(page)
  await page.goto('/login')
  await expect(page.getByRole('button', { name: '登录', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '使用 Google 登录' })).toHaveCount(0)

  await page.route('**/api/auth/config', route => route.fulfill(json(200, { googleClientId: CLIENT_ID })))
  await page.route('https://accounts.google.com/**', route => route.abort())
  let started = ''
  await page.route('**/api/auth/google/start?**', (route) => {
    started = route.request().url()
    return route.fulfill({ status: 200, contentType: 'text/html', body: 'redirecting' })
  })

  await page.goto('/login?redirect=%2Fworkspace%3Fc%3D1')
  await page.getByRole('button', { name: '使用 Google 登录' }).click()
  await expect.poll(() => started).toContain('/api/auth/google/start?redirect=%2Fworkspace%3Fc%3D1')

  await page.goto('/login?google=pending')
  await expect(page.getByRole('heading', { name: '等待管理员审核' })).toBeVisible()
  await page.getByRole('button', { name: '返回登录' }).click()
  await expect(page.getByRole('heading', { name: '登录' })).toBeVisible()

  await page.goto('/login?google=failed')
  await expect(page.getByRole('alert')).toHaveText('无法使用该 Google 账号登录')
})

test('AC-20 / AC-21 工作台显示昵称与头像；没有昵称显示邮箱前缀，头像不可达回退为首字母', async ({ page }) => {
  await installApiRoutes(page, () => [])
  const sidebarUser = page.getByRole('button', { name: '用户设置' })

  await page.route('**/api/auth/me', route => route.fulfill(json(200, { ...E2E_USER, name: '小运营', avatarUrl: 'https://lh3.googleusercontent.com/a/ok' })))
  await page.route('https://lh3.googleusercontent.com/a/ok', route => route.fulfill({
    contentType: 'image/svg+xml',
    body: '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><rect width="8" height="8" fill="red"/></svg>',
  }))
  await page.goto('/workspace')
  await expect(sidebarUser).toContainText('小运营')
  await expect(sidebarUser.locator('img')).toHaveAttribute('src', 'https://lh3.googleusercontent.com/a/ok')

  await page.route('**/api/auth/me', route => route.fulfill(json(200, { ...E2E_USER, avatarUrl: 'https://lh3.googleusercontent.com/a/broken' })))
  await page.route('https://lh3.googleusercontent.com/a/broken', route => route.abort())
  await page.goto('/workspace')
  await expect(sidebarUser).toContainText('operator')
  await expect(sidebarUser.locator('[data-slot="avatar-fallback"]')).toHaveText('O')
  // 加载失败的图片被隐藏（v-show），不显示破图
  await expect(sidebarUser.locator('img')).toBeHidden()
})
