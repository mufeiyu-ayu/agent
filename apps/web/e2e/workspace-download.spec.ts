import type { Page, Route } from '@playwright/test'
import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import { CONVERSATION_ID, installApiRoutes, installBrowserStubs } from './fixtures'

const htmlA = '<!doctype html><html><body><h1>预览 A</h1><input aria-label="交互输入" value="初始"></body></html>'
const originalB = Buffer.from('\uFEFFB 原始内容\r\n')
const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')

/** 真实工作区/面板/缓存 hook，通过 API fixture 控制下载失败与迟到；不连接云服务。 */
async function setup(page: Page, htmlPreview = false) {
  await page.setViewportSize({ width: 1920, height: 1080 })
  // 清单由本用例的手动刷新控制；iframe 的焦点切换不额外触发一次后台刷新。
  await page.addInitScript(() => {
    if (window.top === window)
      window.addEventListener('focus', event => event.stopImmediatePropagation(), true)
  })
  await installApiRoutes(page, () => [{ id: 'u-download', conversationId: CONVERSATION_ID, role: 'USER', content: '查看工作文件', status: 'COMPLETED', createdAt: '2026-10-03T00:00:00Z', updatedAt: '2026-10-03T00:00:00Z' }])
  await installBrowserStubs(page, { lines: [], holdBeforeIndex: -1 })
  await page.route('**/api/conversations?*', route => route.fulfill({ json: { success: true, code: 0, data: { items: [CONVERSATION_ID, 'download-session-b'].map((id, index) => ({ id, title: `会话 ${index === 0 ? 'A' : 'B'}`, createdAt: '2026-10-03T00:00:00Z', updatedAt: '2026-10-03T00:00:00Z' })), nextCursor: null } } }))
  await page.route('**/api/conversations/*/messages', (route) => {
    const id = new URL(route.request().url()).pathname.split('/')[3]!
    return route.fulfill({ json: { success: true, code: 0, data: [{ id: `u-${id}`, conversationId: id, role: 'USER', content: '查看工作文件', status: 'COMPLETED', createdAt: '2026-10-03T00:00:00Z', updatedAt: '2026-10-03T00:00:00Z' }] } })
  })
  const state = {
    revision: 1,
    aPath: htmlPreview ? 'a.html' : 'a.txt',
    a: Buffer.from(htmlPreview ? htmlA : 'A1'),
    b: originalB,
    aPresent: true,
    bPresent: true,
    failB: false,
    holdDownloads: false,
    reads: [] as { id: string, path: string, revision: number }[],
    held: [] as { route: Route, bytes: Buffer, path: string }[],
  }
  await page.route('**/api/conversations/*/workspace**', (route) => {
    const url = new URL(route.request().url())
    const id = url.pathname.split('/')[3]!
    if (url.pathname.endsWith('/file')) {
      const path = url.searchParams.get('path')!
      const revision = Number(url.searchParams.get('revision'))
      state.reads.push({ id, path, revision })
      if (revision !== state.revision)
        return route.fulfill({ status: 409, json: { success: false, code: 409, message: '版本已更新' } })
      if (path === 'b.txt' && state.failB)
        return route.fulfill({ status: 503, json: { success: false, code: 503, message: '下载失败' } })
      const bytes = path === state.aPath ? state.a : path === 'b.txt' ? state.b : Buffer.from('C 原文\r\n')
      if (state.holdDownloads && path !== state.aPath) {
        state.held.push({ route, bytes, path })
        return
      }
      return route.fulfill({ json: { success: true, code: 0, data: { encoding: 'base64', content: bytes.toString('base64') } } })
    }
    const files = [
      ...(state.aPresent ? [{ path: state.aPath, bytes: state.a.length, sha256: sha(state.a) }] : []),
      ...(state.bPresent ? [{ path: 'b.txt', bytes: state.b.length, sha256: sha(state.b) }] : []),
      { path: 'c.txt', bytes: 10, sha256: sha(Buffer.from('C 原文\r\n')) },
    ]
    return route.fulfill({ json: { success: true, code: 0, data: { configured: true, conversationId: id, revision: state.revision, state: 'idle', files, lastError: null, lastOperation: null, updatedAt: null } } })
  })
  await page.goto('/workspace')
  await page.locator('[data-open-workspace-files]').click()
  const panel = page.locator('[data-workspace-files-panel]')
  if (!htmlPreview) {
    await panel.getByRole('button', { name: state.aPath, exact: true }).click()
    await expect(panel.locator('[data-workspace-source]')).toContainText('A1')
  }
  return { state, panel, release: (index: number) => {
    const request = state.held[index]!
    return request.route.fulfill({ json: { success: true, code: 0, data: { encoding: 'base64', content: request.bytes.toString('base64') } } })
  } }
}

test('AC-01：B 下载失败保留 A 的两个 iframe 与交互状态，重试实际下载 B 原始字节', async ({ page }) => {
  const { state, panel } = await setup(page, true)
  const outer = page.locator('[data-workspace-files-panel] [data-html-preview-panel] > iframe')
  const child = page.frameLocator('[data-workspace-files-panel] [data-html-preview-panel] > iframe').frameLocator('iframe')
  await expect(child.getByRole('heading', { name: '预览 A' })).toBeVisible()
  const outerHandle = (await outer.elementHandle())!
  const outerFrame = (await outerHandle.contentFrame())!
  const innerHandle = (await outerFrame.locator('iframe').elementHandle())!
  await child.getByRole('textbox', { name: '交互输入' }).fill('已输入的交互状态')
  await expect(child.getByRole('textbox', { name: '交互输入' })).toHaveValue('已输入的交互状态')
  state.failB = true
  await panel.getByRole('button', { name: '下载 b.txt', exact: true }).click()
  await expect(panel.getByRole('alert')).toBeVisible()
  const retained = await outerHandle.evaluate(element => element.isConnected)
  state.failB = false
  const download = page.waitForEvent('download', { timeout: 2500 }).catch(() => undefined)
  await panel.getByRole('button', { name: /^重试/ }).click()
  const result = await download
  console.log('P2-A Chrome:', JSON.stringify({ retained, reads: state.reads.map(read => read.path), downloaded: result?.suggestedFilename() ?? null }))
  assert.deepEqual(state.reads.map(read => read.path), ['a.html', 'b.txt', 'b.txt'])
  assert.equal(retained, true, 'B 下载失败不能卸载 A 的 iframe')
  assert.equal(await outerHandle.evaluate(element => element.isConnected), true)
  assert.equal(await innerHandle.evaluate(element => element.isConnected), true)
  await expect(child.getByRole('textbox', { name: '交互输入' })).toHaveValue('已输入的交互状态')
  assert.ok(result)
  assert.equal(result.suggestedFilename(), 'b.txt')
  assert.deepEqual(await readFile((await result.path())!), originalB)
})

test('AC-01：B 的失败提示包含目标，A 的普通刷新不清除 B 错误或重建 A', async ({ page }) => {
  const { state, panel } = await setup(page, true)
  const child = page.frameLocator('[data-workspace-files-panel] [data-html-preview-panel] > iframe').frameLocator('iframe')
  await expect(child.getByRole('heading', { name: '预览 A' })).toBeVisible()
  await child.getByRole('textbox', { name: '交互输入' }).fill('已输入的交互状态')
  state.failB = true
  await panel.getByRole('button', { name: '下载 b.txt', exact: true }).click()
  await expect(panel.getByRole('alert')).toContainText('b.txt')
  state.revision++
  await panel.getByRole('button', { name: '刷新文件', exact: true }).click()
  await expect(panel.getByText(/已保存版本 2/)).toBeVisible()
  await expect(panel.getByRole('alert')).toContainText('b.txt')
  await expect(child.getByRole('textbox', { name: '交互输入' })).toHaveValue('已输入的交互状态')
  assert.deepEqual(state.reads.map(read => read.path), ['a.html', 'b.txt'])
})

test('AC-01：B 挂起期间放大 A，失败提示与原 B 重试在 Dialog 内可见且不重建预览', async ({ page }) => {
  const { state, panel } = await setup(page, true)
  await expect(page.frameLocator('[data-workspace-files-panel] [data-html-preview-panel] > iframe').frameLocator('iframe').getByRole('heading', { name: '预览 A' })).toBeVisible()
  state.holdDownloads = true
  await panel.getByRole('button', { name: '下载 b.txt', exact: true }).click()
  await expect.poll(() => state.held.length).toBe(1)
  await panel.getByRole('button', { name: '放大预览', exact: true }).click()
  const dialog = page.locator('[data-expanded-preview]')
  const outerHandle = (await dialog.locator('[data-html-preview-panel] > iframe').elementHandle())!
  const innerHandle = (await (await outerHandle.contentFrame())!.locator('iframe').elementHandle())!
  const child = page.frameLocator('[data-expanded-preview] [data-html-preview-panel] > iframe').frameLocator('iframe')
  await child.getByRole('textbox', { name: '交互输入' }).fill('全屏里的交互状态')
  await state.held[0]!.route.fulfill({ status: 503, json: { success: false, code: 503, message: '下载失败' } })
  await expect(dialog.getByRole('alert')).toContainText('b.txt')
  await expect(child.getByRole('textbox', { name: '交互输入' })).toHaveValue('全屏里的交互状态')
  state.holdDownloads = false
  const result = page.waitForEvent('download')
  await dialog.getByRole('button', { name: '重试下载 b.txt', exact: true }).click()
  assert.deepEqual(await readFile((await (await result).path())!), originalB)
  assert.equal(await outerHandle.evaluate(element => element.isConnected), true)
  assert.equal(await innerHandle.evaluate(element => element.isConnected), true)
  await expect(child.getByRole('textbox', { name: '交互输入' })).toHaveValue('全屏里的交互状态')
  assert.equal(state.reads.filter(read => read.path === 'b.txt').length, 2)
})

for (const change of ['修改', '删除'] as const) {
  test(`AC-02：A ${change}并刷新时，未改的 B 挂起下载仍完成一次`, async ({ page }) => {
    const { state, panel, release } = await setup(page)
    state.holdDownloads = true
    const downloads: string[] = []
    page.on('download', download => downloads.push(download.suggestedFilename()))
    const downloaded = page.waitForEvent('download', { timeout: 3000 }).catch(() => undefined)
    await panel.getByRole('button', { name: '下载 b.txt', exact: true }).click()
    await expect.poll(() => state.held.length).toBe(1)
    state.revision++
    if (change === '修改')
      state.a = Buffer.from('A2')
    else
      state.aPresent = false
    await panel.getByRole('button', { name: '刷新文件', exact: true }).click()
    await expect(panel.getByText(/已保存版本 2/)).toBeVisible()
    if (change === '修改')
      await expect(panel.locator('[data-workspace-source]')).toContainText('A2')
    else
      await expect(panel.locator('[data-workspace-source]')).toHaveCount(0)
    await release(0)
    const result = await downloaded
    console.log('P2-B Chrome:', JSON.stringify({ change, reads: state.reads.map(read => read.path), downloads }))
    assert.ok(result, 'A 的变化不能吞掉 B 成功后的下载动作')
    assert.equal(result.suggestedFilename(), 'b.txt')
    assert.deepEqual(await readFile((await result.path())!), originalB)
    assert.equal(state.reads.filter(read => read.path === 'b.txt').length, 1)
    assert.deepEqual(downloads, ['b.txt'])
  })
}

for (const change of ['修改', '删除'] as const) {
  test(`AC-01：失败的 B 在重试前${change}，保留原身份并提示失效，不下载新版本`, async ({ page }) => {
    const { state, panel } = await setup(page, true)
    state.failB = true
    const downloads: string[] = []
    page.on('download', download => downloads.push(download.suggestedFilename()))
    await panel.getByRole('button', { name: '下载 b.txt', exact: true }).click()
    await expect(panel.locator('[data-workspace-download-error]')).toContainText('b.txt')
    state.revision++
    state.failB = false
    if (change === '修改')
      state.b = Buffer.from('B 新版本')
    else
      state.bPresent = false
    await panel.getByRole('button', { name: '刷新文件', exact: true }).click()
    await expect(panel.getByText(/已保存版本 2/)).toBeVisible()
    await panel.getByRole('button', { name: '重试下载 b.txt', exact: true }).click()
    await expect(panel.locator('[data-workspace-download-error]')).toContainText('已变化或删除')
    await expect(panel.getByRole('button', { name: '重试下载 b.txt', exact: true })).toBeEnabled()
    assert.equal(state.reads.filter(read => read.path === 'b.txt').length, 1, '重试不能改读同路径的新 SHA')
    assert.deepEqual(downloads, [])
    await expect(page.frameLocator('[data-workspace-files-panel] [data-html-preview-panel] > iframe').frameLocator('iframe').getByRole('heading', { name: '预览 A' })).toBeVisible()
  })
}

for (const change of ['修改', '删除'] as const) {
  test(`AC-03：B 自身${change}，忽略取消的旧响应不下载、不进入可复用缓存`, async ({ page }) => {
    await page.addInitScript(() => {
      if (window.top !== window)
        return
      const Controller = window.AbortController
      window.AbortController = class extends Controller { abort() {} }
    })
    const { state, panel, release } = await setup(page)
    state.holdDownloads = true
    const downloads: string[] = []
    page.on('download', download => downloads.push(download.suggestedFilename()))
    const oldResponse = page.waitForResponse(response => new URL(response.url()).pathname.endsWith('/workspace/file') && new URL(response.url()).searchParams.get('path') === 'b.txt')
    await panel.getByRole('button', { name: '下载 b.txt', exact: true }).click()
    await expect.poll(() => state.held.length).toBe(1)
    state.revision++
    if (change === '修改')
      state.b = Buffer.from('B 新版本')
    else
      state.bPresent = false
    await panel.getByRole('button', { name: '刷新文件', exact: true }).click()
    await expect(panel.locator('[data-workspace-download-error]')).toContainText('已变化或删除')
    await release(0)
    await (await oldResponse).finished()
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())))
    assert.deepEqual(downloads, [], '取消被忽略的失效响应也不能产生下载')
    await expect(panel.locator('[data-workspace-source]')).toContainText('A1')
    state.b = originalB
    state.bPresent = true
    state.revision++
    state.holdDownloads = false
    await panel.getByRole('button', { name: '刷新文件', exact: true }).click()
    await expect(panel.getByText(/已保存版本 3/)).toBeVisible()
    const result = page.waitForEvent('download')
    await panel.getByRole('button', { name: '下载 b.txt', exact: true }).click()
    assert.deepEqual(await readFile((await (await result).path())!), originalB)
    assert.equal(state.reads.filter(read => read.path === 'b.txt').length, 2, '重新出现的原 SHA 也需新读取，旧失效结果没有写回缓存')
  })
}

for (const [lifecycle, oldFails] of [['关闭重开', false], ['跨布局重建', false], ['切换会话', false], ['关闭重开', true]] as const) {
  test(`AC-04：${lifecycle}后旧 B ${oldFails ? '失败' : '成功'}不下载、不提示、不释放新 C 的 loading`, async ({ page }) => {
    await page.addInitScript(() => {
      if (window.top !== window)
        return
      const Controller = window.AbortController
      window.AbortController = class extends Controller { abort() {} }
    })
    const { state, panel, release } = await setup(page)
    const oldPanel = (await panel.elementHandle())!
    state.holdDownloads = true
    const downloads: string[] = []
    page.on('download', download => downloads.push(download.suggestedFilename()))
    const oldResponse = page.waitForResponse(response => new URL(response.url()).pathname.endsWith('/workspace/file') && new URL(response.url()).searchParams.get('path') === 'b.txt')
    await panel.getByRole('button', { name: '下载 b.txt', exact: true }).click()
    await expect.poll(() => state.held.length).toBe(1)
    if (lifecycle === '跨布局重建') {
      await page.setViewportSize({ width: 390, height: 844 })
    }
    else {
      if (lifecycle === '关闭重开')
        await panel.getByRole('button', { name: '关闭文件面板', exact: true }).click()
      else
        await page.getByRole('button', { name: '会话 B', exact: true }).click()
      await expect(page.locator('[data-open-workspace-files]')).toBeEnabled()
      await page.locator('[data-open-workspace-files]').click()
    }
    await expect.poll(() => oldPanel.evaluate(element => element.isConnected)).toBe(false)
    await expect(panel).toHaveCount(1)
    await panel.getByRole('button', { name: '下载 c.txt', exact: true }).click()
    await expect.poll(() => state.held.length).toBe(2)
    if (oldFails)
      await state.held[0]!.route.fulfill({ status: 503, json: { success: false, code: 503, message: '旧操作失败' } })
    else
      await release(0)
    await (await oldResponse).finished()
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())))
    assert.deepEqual(downloads, [])
    await expect(panel.locator('[data-workspace-download-error]')).toHaveCount(0)
    const button = panel.getByRole('button', { name: '下载 c.txt', exact: true })
    await expect(button).toHaveAttribute('aria-busy', 'true')
    await expect(button).toBeDisabled()
    const result = page.waitForEvent('download')
    await release(1)
    assert.equal((await result).suggestedFilename(), 'c.txt')
    assert.deepEqual(downloads, ['c.txt'])
    await expect(button).toBeEnabled()
    await expect(button).toHaveAttribute('aria-busy', 'false')
  })
}
