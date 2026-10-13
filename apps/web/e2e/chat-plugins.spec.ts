import type { ConversationMessage, McpPlugin, SkillSummary } from '@agent/contracts'
import assert from 'node:assert/strict'
import { expect, test } from '@playwright/test'
import { CONVERSATION_ID, installApiRoutes, installBrowserStubs } from './fixtures'

const plugin: McpPlugin = {
  id: 'google',
  name: 'Google 开发文档',
  description: '搜索 Google 官方文档',
  configRevision: 'a'.repeat(64),
  url: 'https://developerknowledge.googleapis.com/mcp',
  icon: null,
  system: true,
  available: true,
  authType: 'headers',
  headerNames: ['X-Goog-Api-Key'],
  oauthClientId: '',
  oauthScopes: '',
  hasClientSecret: false,
  connected: true,
  enabled: true,
  needsAuth: false,
  tools: [],
}
const skill: SkillSummary = {
  id: 'builtin:skill-creator',
  name: 'skill-creator',
  description: '创建技能',
  builtin: true,
  enabled: true,
  published: true,
  hasDraft: false,
  conversationId: null,
  createdAt: '2026-10-13T00:00:00Z',
  updatedAt: '2026-10-13T00:00:00Z',
  usageCount: 0,
  examples: [],
}
async function setup(page: import('@playwright/test').Page, messages: ConversationMessage[] = []) {
  await installApiRoutes(page, () => messages)
  await installBrowserStubs(page, { lines: [
    JSON.stringify({ type: 'start', conversationId: CONVERSATION_ID, userMessageId: 'user-plugin', assistantMessageId: 'reply-plugin' }),
    JSON.stringify({ type: 'error', conversationId: CONVERSATION_ID, assistantMessageId: 'reply-plugin', message: '生成失败', userMessagePersisted: true }),
  ], holdBeforeIndex: 1 })
  await page.route('**/api/skills', route => route.fulfill({ json: { success: true, code: 0, message: 'ok', data: [skill] } }))
  await page.route('**/api/mcp', route => route.fulfill({ json: { success: true, code: 0, message: 'ok', data: [
    plugin,
    { ...plugin, id: 'disabled', name: '停用插件', enabled: false },
    { ...plugin, id: 'disconnected', name: '未连接插件', connected: false },
    { ...plugin, id: 'expired', name: '授权失效插件', needsAuth: true },
    { ...plugin, id: 'unavailable', name: '下架插件', available: false },
  ] } }))
  await page.goto('/workspace')
  await page.locator('textarea').waitFor()
  await page.mouse.move(0, 0)
}

async function selectPlugin(page: import('@playwright/test').Page) {
  await page.locator('textarea').fill('/Google')
  const option = page.getByRole('option', { name: /Google 开发文档/ })
  await option.waitFor()
  await option.click()
}

test('技能和插件分组、有效连接过滤、键盘选择、IME 与移除；仅选插件不发送', async ({ page }) => {
  await setup(page)
  const textarea = page.locator('textarea')
  await textarea.fill('/')
  const menu = page.getByRole('listbox', { name: '技能与插件' })
  await menu.getByRole('option', { name: /Google 开发文档/ }).waitFor()
  assert.equal(await menu.getByRole('option').count(), 2)
  assert.ok((await menu.textContent())?.includes('插件'))
  assert.ok((await menu.textContent())?.includes('技能'))
  await textarea.press('ArrowDown')
  assert.match((await menu.getByRole('option', { selected: true }).textContent())!, /Google/)
  await textarea.press('Enter')
  const selected = page.locator('[data-composer-plugins]')
  await selected.waitFor()
  assert.equal(await textarea.inputValue(), '')
  await textarea.press('Enter')
  assert.equal(await page.evaluate(() => window.__chatRequests!.length), 0)
  await textarea.dispatchEvent('compositionstart')
  assert.equal(await textarea.evaluate(el => el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true, isComposing: true }))), true)
  await textarea.dispatchEvent('compositionend')
  assert.equal(await textarea.evaluate(el => el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', keyCode: 229, bubbles: true, cancelable: true }))), true)
  assert.equal(await selected.count(), 1)
  await textarea.press('Backspace')
  await selected.waitFor({ state: 'detached' })
  await selectPlugin(page)
  await page.getByRole('button', { name: '移除插件 Google 开发文档' }).click()
  await selected.waitFor({ state: 'detached' })
})

test('同发技能和插件，start 后重选同一插件再收到 error 保留下一条文字和标签', async ({ page }) => {
  await setup(page)
  const textarea = page.locator('textarea')
  await textarea.fill('/skill')
  await page.getByRole('option', { name: /skill-creator/ }).click()
  await selectPlugin(page)
  await textarea.fill('查询 Firebase 登录')
  await textarea.press('Enter')
  const tag = page.locator('[data-composer-plugins]')
  await tag.waitFor({ state: 'detached' })
  const requests = await page.evaluate(() => window.__chatRequests) as Array<{ pluginIds: string[], skillIds: string[], message: string }>
  assert.equal(requests.length, 1)
  assert.deepEqual(requests[0]!.pluginIds, ['google'])
  assert.deepEqual(requests[0]!.skillIds, ['builtin:skill-creator'])
  assert.equal(requests[0]!.message, '查询 Firebase 登录')
  assert.match((await page.locator('[data-message-plugins]').textContent())!, /Google/)
  await selectPlugin(page)
  await textarea.fill('下一条问题')
  await page.evaluate(() => window.__releaseStream?.())
  await page.getByText('生成失败', { exact: true }).first().waitFor()
  assert.equal(await textarea.inputValue(), '下一条问题')
  assert.match((await tag.textContent())!, /Google/)
})

test('刷新从用户消息还原插件标签，不向输入框重新授予选择', async ({ page }) => {
  const timestamp = '2026-10-13T00:00:00Z'
  await setup(page, [{ id: 'persisted-question', conversationId: CONVERSATION_ID, role: 'USER', content: '查询文档', status: 'COMPLETED', createdAt: timestamp, updatedAt: timestamp, plugins: [{ id: 'google', name: '当时的插件名' }] }])
  await page.locator('[data-message-plugins]').waitFor()
  await page.reload()
  await page.locator('[data-message-plugins]').waitFor()
  assert.match((await page.locator('[data-message-plugins]').textContent())!, /当时的插件名/)
  assert.equal(await page.locator('[data-composer-plugins]').count(), 0)
})

test('慢插件请求不重置键盘选中的技能，加载中 Enter 不发送搜索词', async ({ page }) => {
  await setup(page)
  await page.route('**/api/skills', route => route.fulfill({ json: { success: true, code: 0, message: 'ok', data: [skill, { ...skill, id: 'second', name: 'second-skill' }] } }))
  await page.reload()
  await page.locator('textarea').waitFor()
  let release!: () => void
  let gate = new Promise<void>((resolve) => {
    release = resolve
  })
  await page.route('**/api/mcp', async (route) => {
    await gate
    await route.fulfill({ json: { success: true, code: 0, message: 'ok', data: [] } })
  })
  const textarea = page.locator('textarea')
  await page.mouse.move(0, 0)
  await textarea.fill('/')
  const menu = page.getByRole('listbox', { name: '技能与插件' })
  await menu.getByRole('option', { name: /second-skill/ }).waitFor()
  await textarea.press('ArrowDown')
  assert.match((await menu.getByRole('option', { selected: true }).textContent())!, /second-skill/)
  release()
  await menu.getByRole('status').waitFor({ state: 'detached' })
  assert.match((await menu.getByRole('option', { selected: true }).textContent())!, /second-skill/)
  await textarea.press('Enter')
  assert.match((await page.locator('[data-composer-skills]').textContent())!, /second-skill/)
  gate = new Promise<void>((resolve) => {
    release = resolve
  })
  await textarea.fill('/Google')
  await menu.getByRole('status').waitFor()
  await textarea.press('Enter')
  assert.equal(await page.evaluate(() => window.__chatRequests!.length), 0)
  assert.equal(await textarea.inputValue(), '/Google')
  release()
})

test('英文聊天中所选插件已失效时显示英文并保留输入供修改', async ({ page }) => {
  await setup(page)
  await page.addInitScript(() => localStorage.setItem('agent-web-locale', 'en-US'))
  await page.reload()
  await selectPlugin(page)
  await page.evaluate(() => {
    const original = window.fetch.bind(window)
    window.fetch = (input, init) => String(input).includes('/api/chat/stream')
      ? Promise.resolve(new Response(JSON.stringify({ success: false, message: '所选插件已不可用，请检查连接和启用状态后重新选择', error: { statusCode: 400, error: 'McpSelectionUnavailable' } }), { status: 400, headers: { 'Content-Type': 'application/json' } }))
      : original(input, init)
  })
  await page.locator('textarea').fill('Find Firebase docs')
  await page.locator('textarea').press('Enter')
  await page.getByText('The selected plugin is no longer available. Check its connection and enabled status, then select it again.', { exact: true }).first().waitFor({ timeout: 3000 })
  assert.equal(await page.locator('textarea').inputValue(), 'Find Firebase docs')
  assert.match((await page.locator('[data-composer-plugins]').textContent())!, /Google/)
})

test('英文内置插件候选、选择和消息标签一致，请求仍提交原始插件 ID', async ({ page }) => {
  await setup(page)
  await page.route('**/api/mcp', route => route.fulfill({ json: { success: true, code: 0, data: [{
    ...plugin,
    id: 'google-developer-knowledge',
    description: '搜索和阅读 Google 官方开发文档，查询 API 用法与开发指南。',
  }] } }))
  await page.addInitScript(() => localStorage.setItem('agent-web-locale', 'en-US'))
  await page.reload()
  const textarea = page.locator('textarea')
  await textarea.fill('/development guides')
  const option = page.getByRole('option', { name: /Google Developer Knowledge/ })
  await expect(option).toContainText('Search and read official Google developer documentation')
  await option.click()
  await expect(page.locator('[data-composer-plugins]')).toHaveText('Google Developer Knowledge')
  await textarea.fill('Search Firebase docs')
  await textarea.press('Enter')
  await expect(page.locator('[data-message-plugins]')).toHaveText('Google Developer Knowledge')
  const requests = await page.evaluate(() => window.__chatRequests) as Array<{ pluginIds: string[] }>
  assert.deepEqual(requests[0]!.pluginIds, ['google-developer-knowledge'])
})
