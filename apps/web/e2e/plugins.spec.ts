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

async function setup(page: import('@playwright/test').Page, slowList = false) {
  await installBrowserStubs(page, { lines: [] })
  await installApiRoutes(page, () => [])
  let rows = [{ ...initial }]
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
