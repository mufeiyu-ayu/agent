import type { McpPlugin } from '@agent/contracts'
import { Buffer } from 'node:buffer'
import { expect, test } from '@playwright/test'
import { installApiRoutes, installBrowserStubs } from './fixtures'

const initial: McpPlugin = {
  id: 'google-developer-knowledge',
  configRevision: 'a'.repeat(64),
  name: 'Google 开发文档',
  description: '搜索 Google 官方文档',
  url: 'https://developerknowledge.googleapis.com/mcp',
  icon: null,
  system: true,
  available: true,
  authType: 'headers',
  headerNames: ['X-Goog-Api-Key'],
  oauthClientId: '',
  oauthScopes: '',
  hasClientSecret: false,
  connected: false,
  enabled: false,
  needsAuth: false,
  tools: [],
}
const json = (data: unknown) => ({ json: { success: true, code: 0, data } })

async function setup(page: import('@playwright/test').Page, slowList = false, seed: McpPlugin[] = [initial]) {
  await installBrowserStubs(page, { lines: [] })
  await installApiRoutes(page, () => [])
  let rows = seed.map(plugin => ({ ...plugin }))
  let releaseList: (() => void) | undefined
  let listGate = slowList
    ? new Promise<void>((resolve) => {
        releaseList = resolve
      })
    : undefined
  const requests: Array<{ path: string, body: unknown }> = []
  let release: (() => void) | undefined
  let gate: Promise<void> | undefined
  await page.route(
    url => url.pathname.startsWith('/api/mcp'),
    async (route) => {
      const request = route.request()
      const path = new URL(request.url()).pathname
      const parts = path.split('/').slice(3)
      const id = parts[0]
      if (request.method() === 'GET') {
        if (!id && listGate)
          await listGate
        await route.fulfill(
          json(
            id === 'config'
              ? { callbackUrl: 'http://localhost:5173/api/mcp/oauth/callback' }
              : id
                ? rows.find(row => row.id === id)
                : rows,
          ),
        )
        return
      }
      const body = request.postData() ? request.postDataJSON() : undefined
      requests.push({ path, body })
      if (gate)
        await gate
      if (path === '/api/mcp/import') {
        await route.fulfill(
          json([
            {
              config: {
                name: 'Imported',
                description: '',
                url: 'https://example.com/mcp',
                authType: 'none',
                headerNames: [],
              },
              headers: {},
            },
          ]),
        )
        return
      }
      if (request.method() === 'DELETE') {
        rows = rows.filter(row => row.id !== id)
        await route.fulfill(json({ id }))
        return
      }
      let plugin = rows.find(row => row.id === id)
      if (!id) {
        plugin = {
          ...initial,
          ...body,
          id: `private-${rows.length}`,
          system: false,
        }
        rows.push(plugin!)
      }
      else if (parts[1] === 'connect') {
        Object.assign(plugin!, {
          connected: true,
          enabled: true,
          tools: [
            {
              name: 'search_documents',
              description: '搜索官方文档',
              inputSchema: { type: 'object' },
            },
          ],
        })
      }
      else if (parts[1] === 'enabled') {
        Object.assign(plugin!, { enabled: body.enabled })
      }
      else if (parts[1] === 'disconnect') {
        Object.assign(plugin!, { connected: false, enabled: false, tools: [] })
      }
      else {
        Object.assign(plugin!, body)
      }
      await route.fulfill(json(parts[1] === 'connect' ? { plugin } : plugin))
    },
  )
  await page.goto('/plugins')
  await expect(page.getByRole('heading', { name: '插件', exact: true })).toBeVisible()
  return {
    requests,
    releaseList() {
      listGate = undefined
      releaseList?.()
    },
    holdList() {
      listGate = new Promise<void>((resolve) => {
        releaseList = resolve
      })
    },
    hold() {
      gate = new Promise<void>((resolve) => {
        release = resolve
      })
    },
    release() {
      gate = undefined
      release?.()
    },
  }
}

test('插件页面：无分类分组，连接防连点，真实状态区分停用与断开', async ({ page }) => {
  const state = await setup(page)
  await expect(page.getByText('热门', { exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: /Google 开发文档/ }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('X-Goog-Api-Key').fill('test-key')
  state.hold()
  await dialog.getByRole('button', { name: '连接并启用' }).click()
  await expect(dialog.getByRole('button', { name: '连接中…' })).toBeDisabled()
  await expect(dialog.getByRole('button', { name: '关闭插件详情' })).toBeDisabled()
  expect(state.requests.filter(r => r.path.endsWith('/connect'))).toHaveLength(1)
  state.release()
  await expect(dialog.getByText('search_documents', { exact: true })).toBeVisible()
  await dialog.getByRole('button', { name: '停用插件' }).click()
  await expect(dialog.getByRole('button', { name: '启用插件' })).toBeVisible()
  await dialog.getByRole('button', { name: '断开连接' }).click()
  await expect(dialog.getByRole('button', { name: '连接并启用' })).toBeVisible()
})

test('私人插件慢保存期间字段与关闭统一禁用，图标上传且刷新可读', async ({ page }) => {
  const state = await setup(page)
  await page.getByText('添加', { exact: true }).click()
  await page.getByRole('button', { name: '通过 URL 添加' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('名称', { exact: true }).fill('我的查询')
  await dialog.getByLabel('服务地址').fill('https://example.com/mcp')
  const data = await page.evaluate(() => {
    const c = document.createElement('canvas')
    c.width = c.height = 4
    c.getContext('2d')!.fillRect(0, 0, 4, 4)
    return c.toDataURL().split(',')[1]!
  })
  await dialog.getByLabel('上传图标').setInputFiles({
    name: 'icon.png',
    mimeType: 'image/png',
    buffer: Buffer.from(data, 'base64'),
  })
  await expect(dialog.getByAltText('插件图标预览')).toBeVisible()
  state.hold()
  await dialog.getByRole('button', { name: '保存插件' }).click()
  await expect(dialog.getByLabel('名称', { exact: true })).toBeDisabled()
  await expect(dialog.getByRole('button', { name: '取消' })).toBeDisabled()
  expect(state.requests.filter(r => r.path === '/api/mcp')).toHaveLength(1)
  state.release()
  await expect(dialog.getByRole('heading', { name: '我的查询' })).toBeVisible()
  await dialog.getByRole('button', { name: '关闭插件详情' }).click()
  await page.getByRole('tab', { name: '个人', exact: true }).click()
  await expect(page.getByRole('button', { name: /我的查询/ }).locator('img')).toBeVisible()
  await page.reload()
  await page.getByRole('tab', { name: '个人', exact: true }).click()
  await expect(page.getByRole('button', { name: /我的查询/ })).toBeVisible()
})

test('JSON 导入需核对，不自动连接，OAuth 高级配置和无效图标反馈', async ({ page }) => {
  const state = await setup(page)
  await page.getByText('添加', { exact: true }).click()
  await page.getByRole('button', { name: '导入 JSON' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('MCP 配置 JSON').fill('{"mcpServers":{"Imported":{"url":"https://example.com/mcp"}}}')
  await dialog.getByRole('button', { name: '解析配置' }).click()
  await expect(dialog.getByRole('checkbox')).toBeChecked()
  expect(state.requests.filter(r => r.path === '/api/mcp')).toHaveLength(0)
  await dialog.getByRole('button', { name: '导入所选' }).click()
  await page.getByRole('tab', { name: '个人', exact: true }).click()
  await expect(page.getByRole('button', { name: /Imported/ })).toBeVisible()
  expect(state.requests.filter(r => r.path.endsWith('/connect'))).toHaveLength(0)
  await page.getByRole('button', { name: '通过 URL 添加' }).click()
  await dialog.getByLabel('认证方式').selectOption('oauth')
  await dialog.getByText('OAuth 高级配置').click()
  await expect(dialog.getByLabel('Client ID', { exact: true })).toBeVisible()
  await expect(dialog.getByText(/回调地址：http/)).toBeVisible()
  await dialog.getByLabel('上传图标').setInputFiles({
    name: 'bad.svg',
    mimeType: 'image/svg+xml',
    buffer: Buffer.from('<svg/>'),
  })
  await expect(dialog.getByRole('alert')).toContainText('PNG')
})

test('迟到详情不能重新打开弹窗，失败和授权返回有反馈', async ({ page }) => {
  await setup(page)
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  await page.route('**/api/mcp/google-developer-knowledge', async (route) => {
    await gate
    await route.fulfill(json(initial))
  })
  await page.getByRole('button', { name: /Google 开发文档/ }).click()
  await page.getByRole('button', { name: '关闭插件详情' }).click()
  release()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.goto('/plugins?oauth=failed')
  await expect(page.getByRole('status')).toContainText('授权未完成')
  await page.getByRole('button', { name: /Google 开发文档/ }).click()
  await page.route('**/api/mcp/*/connect', route =>
    route.fulfill({
      status: 400,
      json: { success: false, message: '凭据无效，请重新连接' },
    }))
  await page.getByRole('button', { name: '连接并启用' }).click()
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('凭据无效')
  await expect(page.getByRole('button', { name: '连接并启用' })).toBeEnabled()
})

test('慢列表期间开关编辑或详情后，列表仍完成且刷新可用', async ({ page }) => {
  const state = await setup(page, true)
  await page.getByText('添加', { exact: true }).click()
  await page.getByRole('button', { name: '通过 URL 添加' }).click()
  await page.getByRole('dialog').getByRole('button', { name: '取消' }).click()
  state.releaseList()
  await expect(page.getByRole('button', { name: /Google 开发文档/ })).toBeVisible()
  await expect(page.getByRole('button', { name: '刷新插件' })).toBeEnabled()
  state.holdList()
  await page.getByRole('button', { name: '刷新插件' }).click()
  await page.getByRole('button', { name: /Google 开发文档/ }).click()
  state.releaseList()
  await page.getByRole('button', { name: '关闭插件详情' }).click()
  await expect(page.getByRole('button', { name: '刷新插件' })).toBeEnabled()
})

test('详情回填和连接不改变插件排序，连接弹窗紧凑且详情布局保留', async ({ page }) => {
  const rows = [initial, { ...initial, id: 'github', name: 'GitHub' }, { ...initial, id: 'cloudflare', name: 'Cloudflare' }]
  await setup(page, false, rows)
  const order = () => page.locator('[data-plugin-id]').evaluateAll(elements => elements.map(element => element.getAttribute('data-plugin-id')))
  await expect.poll(order).toEqual(rows.map(plugin => plugin.id))
  await page.route('**/api/mcp/github', route => route.fulfill(json({ ...rows[1], name: 'GitHub 已读取详情' })))
  await page.getByRole('button', { name: /^GitHub/ }).click()
  const dialog = page.getByRole('dialog')
  // 等到详情确实回填，避免只检查请求返回前的占位状态。
  await expect(dialog.getByRole('heading', { name: 'GitHub 已读取详情' })).toBeVisible()
  await expect.poll(order).toEqual(rows.map(plugin => plugin.id))
  expect((await dialog.boundingBox())!.width).toBeLessThanOrEqual(480)
  await expect(dialog.getByRole('heading', { name: '可用工具' })).toHaveCount(0)
  await dialog.screenshot({ path: test.info().outputPath('connection-desktop.png') })
  await page.setViewportSize({ width: 390, height: 844 })
  expect((await dialog.boundingBox())!.width).toBeLessThanOrEqual(358)
  expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
  await dialog.screenshot({ path: test.info().outputPath('connection-mobile.png') })
  await page.setViewportSize({ width: 1280, height: 900 })
  await dialog.getByLabel('X-Goog-Api-Key').fill('test-key')
  await dialog.getByRole('button', { name: '连接并启用' }).click()
  await expect(dialog.getByText('search_documents', { exact: true })).toBeVisible()
  expect((await dialog.boundingBox())!.width).toBe(800)
  await expect.poll(order).toEqual(rows.map(plugin => plugin.id))
})

test('已连接插件以三点菜单管理、启停和断开，快捷操作不打开详情或改变排序', async ({ page }) => {
  const rows = [initial, { ...initial, id: 'github', name: 'GitHub', connected: true, enabled: true }, { ...initial, id: 'cloudflare', name: 'Cloudflare' }]
  const state = await setup(page, false, rows)
  const row = page.locator('[data-plugin-id="github"]')
  const trigger = row.getByRole('button', { name: '插件快捷操作' })
  await expect(trigger).toBeVisible()
  await expect(row.getByText('已启用', { exact: true })).toHaveCount(0)
  await trigger.click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.getByRole('menuitem', { name: '管理', exact: true }).click()
  await expect(page.getByRole('dialog').getByRole('heading', { name: 'GitHub' })).toBeVisible()
  await page.getByRole('button', { name: '关闭插件详情' }).click()
  await trigger.click()
  state.hold()
  await page.getByRole('menuitem', { name: '停用插件' }).click()
  await expect(trigger).toBeDisabled()
  expect(state.requests.filter(request => request.path.endsWith('/enabled'))).toHaveLength(1)
  state.release()
  await expect(trigger).toBeEnabled()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await trigger.click()
  await page.getByRole('menuitem', { name: '启用插件' }).click()
  await expect(trigger).toBeEnabled()
  await trigger.click()
  await expect(page.getByRole('menuitem', { name: '停用插件' })).toBeVisible()
  await page.getByRole('menuitem', { name: '断开连接' }).click()
  await expect(trigger).toHaveCount(0)
  await expect(page.getByRole('dialog')).toHaveCount(0)
  expect(state.requests.filter(request => request.path.endsWith('/disconnect'))).toHaveLength(1)
  expect(await page.locator('[data-plugin-id]').evaluateAll(elements => elements.map(element => element.getAttribute('data-plugin-id')))).toEqual(rows.map(plugin => plugin.id))
})

test('英文模式覆盖插件列表、OAuth 编辑和 JSON 导入错误', async ({ page }) => {
  await setup(page)
  await page.addInitScript(() => localStorage.setItem('agent-web-locale', 'en-US'))
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Plugins', exact: true })).toBeVisible()
  await expect(page.getByRole('searchbox', { name: 'Search plugins' })).toBeVisible()
  await page.getByText('Add', { exact: true }).click()
  await page.getByRole('button', { name: 'Add by URL' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('heading', { name: 'Add plugin' })).toBeVisible()
  await expect(dialog.getByLabel('Name', { exact: true })).toBeVisible()
  await expect(dialog.getByLabel('Description', { exact: true })).toBeVisible()
  await dialog.getByLabel('Authentication').selectOption('oauth')
  await dialog.getByText('Advanced OAuth settings', { exact: true }).click()
  await expect(dialog.getByPlaceholder('Only required by some providers')).toBeVisible()
  await expect(dialog.getByText(/Callback URL: http/)).toBeVisible()
  await dialog.getByLabel('Upload icon').setInputFiles({ name: 'bad.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<svg/>') })
  await expect(dialog.getByRole('alert')).toContainText('Could not read the image')
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
  await page.getByRole('button', { name: 'Import JSON' }).click()
  await page.route('**/api/mcp/import', route => route.fulfill({ status: 400, json: { success: false, message: '仅支持远端 HTTP 配置；command、环境变量及旧 SSE 等配置暂不支持' } }))
  await dialog.getByLabel('MCP configuration JSON').fill('{"mcpServers":{"local":{"command":"uvx"}}}')
  await dialog.getByRole('button', { name: 'Parse configuration' }).click()
  await expect(dialog.getByRole('alert')).toContainText('Only remote HTTP configurations are supported')
})

test('英文连接详情、快捷菜单和未知提交反馈完整，私人删除有确认文案', async ({ page }) => {
  await setup(page, false, [{ ...initial, id: 'personal', name: 'My docs', description: 'Custom documentation', system: false }])
  await page.addInitScript(() => localStorage.setItem('agent-web-locale', 'en-US'))
  await page.reload()
  await page.getByRole('tab', { name: 'Personal', exact: true }).click()
  await page.getByRole('button', { name: /^My docs/ }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByText(/Once connected, Kuro can automatically/)).toBeVisible()
  await dialog.getByRole('button', { name: 'Connect and enable' }).click()
  await expect(dialog.getByRole('heading', { name: /Available tools/ })).toBeVisible()
  await dialog.getByRole('button', { name: 'Close plugin details' }).click()
  await page.getByRole('button', { name: 'Plugin actions' }).click()
  await expect(page.getByRole('menuitem', { name: 'Disable plugin' })).toBeVisible()
  await expect(page.getByRole('menuitem', { name: 'Disconnect', exact: true })).toBeVisible()
  await page.getByRole('menuitem', { name: 'Manage', exact: true }).click()
  await dialog.getByRole('button', { name: 'Delete plugin', exact: true }).click()
  await expect(dialog.getByRole('button', { name: 'Confirm deletion' })).toBeVisible()
  await dialog.getByRole('button', { name: 'Edit configuration' }).click()
  await page.route('**/api/mcp/personal', route => route.fulfill({ status: 500, json: { success: false, message: '结果未知', error: { error: 'DatabaseCommitOutcomeUnknown' } } }))
  await dialog.getByRole('button', { name: 'Save plugin' }).click()
  await expect(dialog.getByRole('alert')).toContainText('request outcome is unknown')
  await expect(dialog.getByRole('alert')).toContainText('Refresh and check')
})


test('内置默认名称和简介随语言切换，英文搜索及详情一致，自定义文案保留', async ({ page }) => {
  await setup(page, false, [
    { ...initial, description: '搜索和阅读 Google 官方开发文档，查询 API 用法与开发指南。' },
    { ...initial, id: 'github', name: '团队 GitHub', description: '管理员自己的介绍' },
  ])
  await expect(page.getByRole('button', { name: /^Google 开发文档/ })).toBeVisible()
  await page.addInitScript(() => localStorage.setItem('agent-web-locale', 'en-US'))
  await page.reload()
  await expect(page.getByRole('button', { name: /^Google Developer Knowledge/ })).toContainText('Search and read official Google developer documentation')
  await expect(page.getByRole('button', { name: /^团队 GitHub/ })).toContainText('管理员自己的介绍')
  await page.getByRole('searchbox').fill('development guides')
  await expect(page.locator('[data-plugin-id]')).toHaveCount(1)
  await page.getByRole('button', { name: /^Google Developer Knowledge/ }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('heading', { name: 'Google Developer Knowledge' })).toBeVisible()
  await expect(dialog).toContainText('Search and read official Google developer documentation')
})
