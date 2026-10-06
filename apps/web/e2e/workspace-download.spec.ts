import type { Page, Route } from '@playwright/test'
import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import { sourceZip } from '../../api/src/workspaces/workspace-archive'
import { CONVERSATION_ID, installApiRoutes, installBrowserStubs } from './fixtures'

const html = Buffer.from('<!doctype html><html><body><h1>预览 A</h1><input aria-label="交互输入" value="初始"></body></html>')
const files = [{ path: 'a.html', content: html }, { path: 'b.txt', content: Buffer.from('\uFEFFB 原始内容\r\n') }]
const zip = sourceZip(files)

async function setup(page: Page) {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.setViewportSize({ width: 1920, height: 1080 })
  await page.addInitScript(() => {
    if (window.top === window) {
      window.addEventListener('focus', event => event.stopImmediatePropagation(), true)
      const Controller = window.AbortController
      window.AbortController = class extends Controller { abort() {} }
    }
  })
  await installApiRoutes(page, () => [{ id: 'question', conversationId: CONVERSATION_ID, role: 'USER', content: '查看文件', status: 'COMPLETED', createdAt: '2026-10-03T00:00:00Z', updatedAt: '2026-10-03T00:00:00Z' }])
  await installBrowserStubs(page, { lines: [], holdBeforeIndex: -1 })
  await page.route('**/api/conversations?*', route => route.fulfill({ json: { success: true, code: 0, data: { items: [CONVERSATION_ID, 'session-b'].map((id, i) => ({ id, title: `会话 ${i ? 'B' : 'A'}`, createdAt: '2026-10-03T00:00:00Z', updatedAt: '2026-10-03T00:00:00Z' })), nextCursor: null } } }))
  await page.route('**/api/conversations/session-b/messages', route => route.fulfill({ json: { success: true, code: 0, data: [{ id: 'b-question', conversationId: 'session-b', role: 'USER', content: '查看文件', status: 'COMPLETED', createdAt: '2026-10-03T00:00:00Z', updatedAt: '2026-10-03T00:00:00Z' }] } }))
  const state = { revision: 1, fail: false, hold: false, requests: [] as { id: string, revision: number }[], held: [] as Route[] }
  await page.route('**/api/conversations/*/workspace**', (route) => {
    const url = new URL(route.request().url())
    const id = url.pathname.split('/')[3]!
    if (url.pathname.endsWith('/archive')) {
      const revision = Number(url.searchParams.get('revision'))
      state.requests.push({ id, revision })
      if (state.fail)
        return route.fulfill({ status: 503, json: { success: false, message: '下载失败' } })
      if (state.hold) {
        state.held.push(route)
        return
      }
      return route.fulfill({ json: { success: true, code: 0, data: { revision, encoding: 'base64', content: zip.toString('base64') } } })
    }
    if (url.pathname.endsWith('/file'))
      return route.fulfill({ json: { success: true, code: 0, data: { encoding: 'base64', content: html.toString('base64') } } })
    return route.fulfill({ json: { success: true, code: 0, data: { configured: true, conversationId: id, revision: state.revision, state: 'idle', files: files.map(file => ({ path: file.path, bytes: file.content.length, sha256: createHash('sha256').update(file.content).digest('hex') })), lastError: null, lastOperation: null, updatedAt: null } } })
  })
  await page.goto('/workspace')
  await page.locator('[data-open-workspace-files]').click()
  const panel = page.locator('[data-workspace-files-panel]')
  const child = panel.frameLocator('[data-html-preview-panel] > iframe').frameLocator('iframe')
  await expect(child.getByRole('heading')).toHaveText('预览 A')
  return { state, panel, child, release: (i: number) => state.held[i]!.fulfill({ json: { success: true, code: 0, data: { revision: state.requests[i]!.revision, encoding: 'base64', content: zip.toString('base64') } } }) }
}

test('ZIP 失败重试固定版本、原字节，保留预览交互', async ({ page }) => {
  const { state, panel, child } = await setup(page)
  await child.getByRole('textbox').fill('保留状态')
  const outer = (await panel.locator('[data-html-preview-panel] > iframe').elementHandle())!
  state.fail = true
  await panel.getByRole('button', { name: '下载源码 ZIP', exact: true }).click()
  const error = panel.locator('[data-workspace-download-error]')
  await expect(error).toContainText('project.zip')
  state.fail = false
  const pending = page.waitForEvent('download')
  await error.getByRole('button').click({ delay: 50 })
  const result = await pending
  assert.equal(result.suggestedFilename(), 'project.zip')
  assert.deepEqual(await readFile((await result.path())!), zip)
  assert.deepEqual(state.requests.map(request => request.revision), [1, 1])
  assert.equal(await outer.evaluate(element => element.isConnected), true)
  await expect(child.getByRole('textbox')).toHaveValue('保留状态')
})

test('ZIP 变版取消；忽略 Abort 的迟到结果不下载，重试不能切新版本', async ({ page }) => {
  const { state, panel, release } = await setup(page)
  const downloads: string[] = []
  page.on('download', d => downloads.push(d.suggestedFilename()))
  state.hold = true
  await panel.getByRole('button', { name: '下载源码 ZIP', exact: true }).click()
  await expect.poll(() => state.held.length).toBe(1)
  state.revision++
  await panel.getByRole('button', { name: '刷新文件', exact: true }).click()
  const error = panel.locator('[data-workspace-download-error]')
  await expect(error).toContainText('已变化或删除')
  const response = page.waitForResponse(r => r.url().includes('/workspace/archive'))
  await release(0)
  await (await response).finished()
  await error.getByRole('button').click()
  assert.deepEqual(downloads, [])
  assert.equal(state.requests.length, 1)
  state.hold = false
  const pending = page.waitForEvent('download')
  await panel.getByRole('button', { name: '下载源码 ZIP', exact: true }).click()
  assert.equal((await pending).suggestedFilename(), 'project.zip')
  assert.deepEqual(state.requests.map(request => request.revision), [1, 2])
})

for (const lifecycle of ['关闭重开', '切换会话'] as const) {
  for (const fails of [false, true]) {
    test(`ZIP ${lifecycle}后旧请求${fails ? '失败' : '成功'}不影响新下载`, async ({ page }) => {
      const { state, panel, release } = await setup(page)
      const downloads: string[] = []
      page.on('download', d => downloads.push(d.suggestedFilename()))
      state.hold = true
      await panel.getByRole('button', { name: '下载源码 ZIP', exact: true }).click()
      await expect.poll(() => state.held.length).toBe(1)
      if (lifecycle === '关闭重开')
        await panel.getByRole('button', { name: '关闭文件面板', exact: true }).click()
      else
        await page.getByRole('button', { name: '会话 B', exact: true }).click()
      await page.locator('[data-open-workspace-files]').click()
      const button = panel.getByRole('button', { name: '下载源码 ZIP', exact: true })
      await button.click()
      await expect.poll(() => state.held.length).toBe(2)
      const response = page.waitForResponse(r => r.url().includes('/workspace/archive'))
      if (fails)
        await state.held[0]!.fulfill({ status: 503, json: { success: false, message: '旧下载失败' } })
      else
        await release(0)
      await (await response).finished()
      await expect(button).toBeDisabled()
      await expect(button).toHaveAttribute('aria-busy', 'true')
      await expect(panel.locator('[data-workspace-download-error]')).toHaveCount(0)
      assert.deepEqual(downloads, [])
      const pending = page.waitForEvent('download')
      await release(1)
      assert.deepEqual(await readFile((await (await pending).path())!), zip)
      assert.equal(downloads.length, 1)
      assert.equal(state.requests[1]!.id, lifecycle === '切换会话' ? 'session-b' : CONVERSATION_ID)
    })
  }
}
