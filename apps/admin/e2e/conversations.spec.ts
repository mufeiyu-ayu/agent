import type { AdminConversationDetail, AdminConversationListItem, AdminUser } from '@agent/contracts'
import type { Page, Route } from '@playwright/test'

import { expect, test } from '@playwright/test'

import { E2E_ADMIN } from './fixtures'

/** #201：会话记录按用户查找。接口由 page.route 按 userId 过滤，记录每次请求的查询参数。 */

const GOOGLE_USER: AdminUser = {
  id: 'user-google',
  email: 'ops@example.com',
  name: '运营小王',
  avatarUrl: 'https://avatar.invalid/ops.png',
  role: 'MEMBER',
  status: 'ACTIVE',
  mustChangePassword: false,
  lastLoginAt: null,
  createdAt: '2026-09-27T00:00:00.000Z',
}
const PASSWORD_USER: AdminUser = { ...GOOGLE_USER, id: 'user-password', email: 'writer@example.com', name: null, avatarUrl: null }
const ADMIN_USER: AdminUser = { ...GOOGLE_USER, ...E2E_ADMIN, role: 'ADMIN' }

function owner(user: AdminUser) {
  return { id: user.id, email: user.email, name: user.name, avatarUrl: user.avatarUrl }
}

const CONVERSATIONS: AdminConversationListItem[] = [
  conversation('conv-google', '报错的那次对话', owner(GOOGLE_USER)),
  conversation('conv-password', '写稿', owner(PASSWORD_USER)),
  conversation('conv-orphan', '存量会话', null),
]

function conversation(id: string, title: string, user: AdminConversationListItem['user']): AdminConversationListItem {
  return { id, title, user, messageCount: 2, runCount: 1, createdAt: '2026-09-27T01:00:00.000Z', updatedAt: '2026-09-27T02:00:00.000Z' }
}

function fulfill(route: Route, data: unknown) {
  return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, code: 0, message: 'ok', data }) })
}

async function install(page: Page) {
  const listQueries: URLSearchParams[] = []

  await page.route('https://avatar.invalid/**', route => route.abort())
  await page.route('**/api/auth/me', route => fulfill(route, E2E_ADMIN))
  await page.route('**/api/admin/users', route => fulfill(route, [ADMIN_USER, GOOGLE_USER, PASSWORD_USER]))
  await page.route('**/api/admin/conversations?*', (route) => {
    const query = new URL(route.request().url()).searchParams
    listQueries.push(query)
    const userId = query.get('userId')
    const items = CONVERSATIONS.filter(item => !userId || item.user?.id === userId)
    return fulfill(route, { items, pagination: { page: 1, pageSize: 20, totalItems: items.length, totalPages: items.length ? 1 : 0 } })
  })
  await page.route('**/api/admin/conversations/conv-google', route => fulfill(route, {
    id: 'conv-google',
    title: '报错的那次对话',
    user: owner(GOOGLE_USER),
    runCount: 1,
    createdAt: '2026-09-27T01:00:00.000Z',
    updatedAt: '2026-09-27T02:00:00.000Z',
    messages: [],
  } satisfies AdminConversationDetail))

  return listQueries
}

const rows = (page: Page) => page.locator('.ant-table-tbody tr.ant-table-row')

test('AC-01 / AC-03 从用户列表「查看对话」进入，只看该用户；刷新、后退、新标签一致；清除后恢复全部', async ({ page, context }) => {
  const listQueries = await install(page)

  await page.goto('/users')
  await page.getByRole('row', { name: /ops@example\.com/ }).getByRole('button', { name: '查看对话' }).click()

  await expect(page).toHaveURL(/\/conversations\?userId=user-google$/)
  await expect(rows(page)).toHaveCount(1)
  await expect(rows(page).first()).toContainText('报错的那次对话')
  await expect(page.locator('.conversation-filters__user')).toContainText('运营小王 · ops@example.com')
  expect(listQueries.at(-1)?.get('userId')).toBe('user-google')

  await page.reload()
  await expect(rows(page)).toHaveCount(1)
  await expect(page.locator('.conversation-filters__user')).toContainText('运营小王 · ops@example.com')

  const copied = await context.newPage()
  await install(copied)
  await copied.goto(page.url())
  await expect(rows(copied)).toHaveCount(1)
  await expect(copied.locator('.conversation-filters__user')).toContainText('运营小王 · ops@example.com')
  await copied.close()

  // 一键清除：地址栏去掉 userId，恢复全部会话。
  await page.locator('.conversation-filters__user').hover()
  await page.locator('.conversation-filters__user .ant-select-clear').click()
  await expect(page).toHaveURL(/\/conversations$/)
  await expect(rows(page)).toHaveCount(3)
  expect(listQueries.at(-1)?.has('userId')).toBe(false)

  await page.goBack()
  await expect(page).toHaveURL(/userId=user-google$/)
  await expect(rows(page)).toHaveCount(1)
})

test('AC-02 时间范围写进地址栏并按上海时区当天起止请求，可与用户筛选叠加', async ({ page }) => {
  const listQueries = await install(page)

  await page.goto('/conversations?userId=user-google&dateFrom=2026-09-01&dateTo=2026-09-27')

  await expect(rows(page)).toHaveCount(1)
  const last = listQueries.at(-1)!
  expect(last.get('userId')).toBe('user-google')
  expect(last.get('dateFrom')).toBe('2026-09-01T00:00:00+08:00')
  expect(last.get('dateTo')).toBe('2026-09-27T23:59:59.999+08:00')
  await expect(page.locator('.conversation-filters__range input').first()).toHaveValue('2026-09-01')
  await expect(page.locator('.conversation-filters__range input').last()).toHaveValue('2026-09-27')

  // 手改出的半截或非法日期当作没选：不带时间参数请求，日期框为空。
  await page.goto('/conversations?dateFrom=2026-13-01&dateTo=2026-09-27')
  await expect(rows(page)).toHaveCount(3)
  expect(listQueries.at(-1)?.has('dateFrom')).toBe(false)
  await expect(page.locator('.conversation-filters__range input').first()).toHaveValue('')
})

test('AC-04 / AC-05 每行显示所属用户：头像失败回退首字母，密码账号显示邮箱前缀，无主显示「未归属」；详情页头显示所属用户', async ({ page }) => {
  await install(page)

  await page.goto('/conversations')

  const google = rows(page).filter({ hasText: '报错的那次对话' })
  await expect(google).toContainText('运营小王')
  await expect(google).toContainText('ops@example.com')
  // avatar.invalid 被 abort，图片加载失败后显示昵称首字母。
  await expect(google.locator('.user-avatar')).toHaveText('运')
  await expect(google.locator('.user-avatar img')).toHaveCount(0)

  const password = rows(page).filter({ hasText: '写稿' })
  await expect(password.locator('.user-identity strong')).toHaveText('writer')
  await expect(password.locator('.user-avatar')).toHaveText('W')

  await expect(rows(page).filter({ hasText: '存量会话' })).toContainText('未归属')

  await google.click()
  await expect(page).toHaveURL(/\/conversations\/conv-google$/)
  await expect(page.locator('.conversation-header')).toContainText('所属用户')
  await expect(page.locator('.conversation-header')).toContainText('运营小王')
})
