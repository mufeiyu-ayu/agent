import type { SandboxExecutionRecord, WorkspaceCloudOverview, WorkspaceHistoryResponse, WorkspaceMonitorItem, WorkspaceMonitorResponse } from '@agent/contracts'
import type { Route } from '@playwright/test'
import { expect, test } from '@playwright/test'
import { E2E_ADMIN } from './fixtures'

function fulfill(route: Route, data: unknown) {
  return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ success: true, code: 0, message: 'ok', data }) })
}

const checkedAt = '2026-10-03T00:00:00.000Z'
const cloud: WorkspaceCloudOverview = {
  sandbox: { checkedAt, instances: [], error: null },
  oss: { bucket: 'test-files', checkedAt, measuredAt: checkedAt, storageBytes: 345148, objectCount: 24, error: null },
}
const workspace: WorkspaceMonitorItem = {
  conversationId: 'workspace-one',
  title: '流量看板',
  userId: 'user-1',
  user: { name: '运营', email: 'member@example.com', avatarUrl: null },
  deleted: false,
  state: 'released',
  revision: 2,
  sandboxId: 'sandbox-1',
  leaseExpiresAt: null,
  lastError: null,
  lastOperation: 'write',
  updatedAt: checkedAt,
  fileCount: 1,
  fileBytes: 1024,
  sandboxCount: 21,
  latestRunAt: checkedAt,
  confirmedDurationMs: 3661000,
}
const archived: WorkspaceMonitorItem = { ...workspace, conversationId: 'archived', title: '已归档任务', deleted: true, fileCount: null, fileBytes: null, revision: null }
const record: SandboxExecutionRecord = {
  id: 'history-1',
  userId: 'user-1',
  user: workspace.user,
  conversationId: workspace.conversationId,
  runId: 'run-1',
  runAvailable: true,
  title: workspace.title,
  sandboxId: 'sandbox-1',
  template: 'kuro-dev',
  apiHost: 'test.invalid',
  state: 'released',
  requestedAt: checkedAt,
  startedAt: checkedAt,
  releasedAt: '2026-10-03T01:01:01.000Z',
  expiresAt: '2026-10-03T01:05:00.000Z',
  durationMs: 3661000,
  checkedAt,
}
const monitor: WorkspaceMonitorResponse = {
  configured: true,
  cloud,
  items: [workspace, archived],
  pagination: { page: 1, pageSize: 20, total: 21 },
  summary: { attempts: 21, created: 20, released: 19, unconfirmed: 1, todayAttempts: 3, confirmedDurationMs: 3661000 },
}

test('工作区主表：聚合展示，行点击打开分页历史抽屉；已删除会话仍有历史入口', async ({ page }) => {
  const requests: string[] = []
  await page.route('**/api/auth/me', route => fulfill(route, E2E_ADMIN))
  await page.route('**/api/admin/workspaces**', (route) => {
    const url = new URL(route.request().url())
    requests.push(`${route.request().method()} ${url.pathname}`)
    const current = Number(url.searchParams.get('page'))
    if (url.pathname.endsWith('/history')) {
      const isArchived = url.pathname.includes('/archived/')
      return fulfill(route, { workspace: isArchived ? archived : workspace, items: [{ ...record, id: `history-${current}`, sandboxId: `sandbox-${current}`, conversationId: isArchived ? archived.conversationId : workspace.conversationId, runAvailable: !isArchived }], pagination: { page: current, pageSize: 20, total: 21 } } satisfies WorkspaceHistoryResponse)
    }
    return fulfill(route, { ...monitor, items: current === 1 ? monitor.items : [{ ...workspace, conversationId: 'workspace-two', title: '第二个工作区' }], pagination: { ...monitor.pagination, page: current } })
  })
  await page.goto('/workspaces')
  const list = page.locator('.page-container > .data-table')
  await expect(page.locator('.ant-segmented')).toHaveCount(0)
  await expect(page.locator('.page-header__actions button')).toHaveCount(1)
  await expect(list).toContainText('1h 1m')
  expect(requests).toEqual(['GET /api/admin/workspaces'])
  await list.getByText('流量看板', { exact: true }).click()
  await expect(page).toHaveURL(/workspace=workspace-one/)
  const drawer = page.locator('.ant-drawer-content')
  await expect(drawer).toBeVisible()
  await expect(drawer).toContainText('sandbox-1')
  await expect(drawer.getByRole('link', { name: 'Run Trace', exact: true })).toHaveAttribute('href', '/runs/run-1')
  expect(requests.at(-1)).toBe('GET /api/admin/workspaces/workspace-one/history')
  const nextHistory = page.waitForRequest(request => request.url().includes('/workspace-one/history?page=2&pageSize=20'))
  await drawer.locator('.ant-pagination-item-2').click()
  await nextHistory
  await expect(drawer).toContainText('sandbox-2')
  await drawer.locator('.ant-drawer-close').click()
  await expect(page).not.toHaveURL(/workspace=/)
  await expect(drawer).toBeHidden()
  const nextMain = page.waitForRequest(request => request.url().endsWith('/api/admin/workspaces?page=2&pageSize=20'))
  await list.locator('.ant-pagination-item-2').click()
  await nextMain
  await expect(list.getByText('第二个工作区', { exact: true })).toBeVisible()
  const beforeRefresh = requests.length
  await page.getByRole('button', { name: /刷新/ }).click()
  await expect(page.getByRole('button', { name: /刷新/ })).toBeEnabled()
  expect(requests.slice(beforeRefresh)).toEqual(['POST /api/admin/workspaces/refresh'])
  await list.locator('.ant-pagination-item-1').click()
  await expect(list.getByText('已归档任务', { exact: true })).toBeVisible()
  await list.getByText('已归档任务', { exact: true }).click()
  await expect(drawer.getByText('Run 已删除', { exact: true })).toBeVisible()
  await expect(drawer.getByRole('link', { name: 'Run Trace', exact: true })).toHaveCount(0)
  await expect(drawer.getByRole('link', { name: '查看会话', exact: true })).toHaveCount(0)
})

test('工作区监测：查询失败保持未知，页面不轮询', async ({ page }) => {
  let listRequests = 0
  await page.clock.install()
  await page.route('**/api/auth/me', route => fulfill(route, E2E_ADMIN))
  await page.route('**/api/admin/workspaces**', (route) => {
    listRequests++
    return fulfill(route, { ...monitor, items: [], pagination: { page: 1, pageSize: 20, total: 0 }, cloud: { sandbox: { checkedAt: null, instances: null, error: '云端暂不可用' }, oss: { bucket: 'test-files', checkedAt: null, measuredAt: null, storageBytes: null, objectCount: null, error: '统计暂不可用' } } satisfies WorkspaceCloudOverview })
  })
  await page.goto('/workspaces')
  await expect(page.locator('[data-cloud-sandbox]')).toContainText('未知')
  await expect(page.locator('[data-cloud-storage]')).toContainText('— 个对象')
  await page.clock.fastForward(15_000)
  await page.waitForLoadState('networkidle')
  expect(listRequests).toBe(1)
})

test('刷新：全程 loading 且禁用，空列表不闪骨架，失败可重试，不追加其他请求', async ({ page }) => {
  const requests: string[] = []
  let calls = 0
  let finishRefresh!: () => void
  const refreshGate = new Promise<void>((resolve) => {
    finishRefresh = resolve
  })
  await page.route('**/api/auth/me', route => fulfill(route, E2E_ADMIN))
  await page.route('**/api/admin/workspaces**', async (route) => {
    requests.push(route.request().method())
    if (route.request().method() === 'POST') {
      calls++
      if (calls > 1)
        return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ success: false, message: '刷新失败，请重试' }) })
      await refreshGate
    }
    return fulfill(route, { ...monitor, items: [], pagination: { page: 1, pageSize: 20, total: 0 } })
  })
  await page.goto('/workspaces')
  await expect(page.getByText('暂无工作区', { exact: true })).toBeVisible()
  const refresh = page.getByRole('button', { name: /刷新/ })
  await refresh.click()
  await expect(refresh).toContainText('刷新中')
  await expect(refresh).toHaveClass(/ant-btn-loading/)
  await expect(refresh).toBeDisabled()
  await expect(page.locator('.data-table__skeleton')).toHaveCount(0)
  await expect(page.getByText('暂无工作区', { exact: true })).toBeVisible()
  finishRefresh()
  await expect(refresh).toBeEnabled()
  expect(requests).toEqual(['GET', 'POST'])
  await refresh.click()
  await expect(page.getByText('刷新失败，请重试', { exact: true })).toBeVisible()
  await expect(refresh).toBeEnabled()
  expect(requests).toEqual(['GET', 'POST', 'POST'])
})
