import type { Page } from '@playwright/test'
import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import dgram from 'node:dgram'
import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import { CONVERSATION_ID, installApiRoutes, installBrowserStubs } from './fixtures'

const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><style>body{font:16px system-ui;padding:24px;background:#f5f8f4;color:#173b2a}button{padding:8px 16px}table{margin-top:24px}</style></head><body><h1>topuplist 最近七天流量</h1><p>演示数据</p><button id="metric">访客</button><p id="metricValue">34360</p><button id="refresh">刷新数据</button><p id="fresh"></p><script>document.querySelector('#metric').onclick=()=>{document.querySelector('#metric').textContent='浏览量';document.querySelector('#metricValue').textContent='81940'};document.querySelector('#refresh').onclick=async()=>{const data=await window.kuro.query('topuplist.traffic');document.querySelector('#fresh').textContent='数据已更新：'+data.totals.visitors};window.checkIsolation=()=>{try{return parent.document.cookie}catch{return 'isolated'}};</script></body></html>`
const identity = { conversationId: CONVERSATION_ID, assistantMessageId: 'assistant-build' }
const event = (data: Record<string, unknown>) => JSON.stringify({ ...identity, ...data })
const file = { path: 'outputs/traffic.html', bytes: Buffer.byteLength(html), sha256: 'a'.repeat(64) }
const snapshot = { configured: true, conversationId: CONVERSATION_ID, revision: 2, state: 'idle', files: [file, { path: 'src/example.ts', bytes: 23, sha256: 'b'.repeat(64) }], lastError: null, lastOperation: 'saving', updatedAt: '2026-10-02T12:00:00.000Z' }

/** 文件面板只通过用户入口打开；各功能回归不能依赖会话清单自动展开。 */
async function openWorkspaceFiles(page: Page) {
  await page.goto('/workspace')
  await page.locator('[data-open-workspace-files]').click()
}

test('构建步骤、命令错误与修复、文件保存、交互预览、业务桥接和下载形成闭环', async ({ page }) => {
  await installApiRoutes(page, () => [])
  let submitted = false
  let queries = 0
  await page.route('**/api/conversations/*/workspace**', async (route) => {
    const url = new URL(route.request().url())
    let data: unknown
    if (url.pathname.endsWith('/traffic')) {
      queries++
      data = { source: 'demo', totals: { visitors: 34360 } }
    }
    else if (url.pathname.endsWith('/file')) {
      data = { encoding: 'base64', content: Buffer.from(url.searchParams.get('path') === file.path ? html : 'const answer: number = 42').toString('base64') }
    }
    else {
      data = submitted ? snapshot : { ...snapshot, revision: 0, files: [] }
    }
    await route.fulfill({ json: { success: true, code: 0, data } })
  })
  await installBrowserStubs(page, { lines: [
    JSON.stringify({ ...identity, type: 'start', userMessageId: 'user-build' }),
    event({ type: 'delta', contentDelta: '我先读取接口数据。\n\n' }),
    event({ type: 'tool_started', callId: 'write-page', toolName: 'write', workspace: { operation: 'write', title: '编写看板', path: file.path, preview: '<html>...</html>' } }),
    event({ type: 'tool_finished', callId: 'write-page', ok: true, workspace: { operation: 'write', title: '编写看板', path: file.path, revision: 1, files: [file] } }),
    event({ type: 'tool_started', callId: 'check-one', toolName: 'bash', workspace: { operation: 'bash', title: '检查页面脚本', command: 'node --check app.js' } }),
    event({ type: 'tool_finished', callId: 'check-one', ok: false, failure: 'failed', workspace: { operation: 'bash', title: '检查页面脚本', command: 'node --check app.js', stderr: 'SyntaxError: Unexpected token', exitCode: 1 } }),
    event({ type: 'tool_started', callId: 'fix', toolName: 'edit', workspace: { operation: 'edit', title: '修复脚本', path: 'app.js' } }),
    event({ type: 'tool_finished', callId: 'fix', ok: true, workspace: { operation: 'edit', title: '修复脚本', path: 'app.js', revision: 2 } }),
    event({ type: 'tool_started', callId: 'check-two', toolName: 'bash', workspace: { operation: 'bash', title: '重新检查页面', command: 'node --check app.js' } }),
    event({ type: 'tool_finished', callId: 'check-two', ok: true, workspace: { operation: 'bash', title: '重新检查页面', stdout: '检查通过', exitCode: 0 } }),
    event({ type: 'delta', contentDelta: '已生成页面并完成检查，数据为演示数据。' }),
    event({ type: 'done', content: '我先读取接口数据。\n\n已生成页面并完成检查，数据为演示数据。', generatedAt: '2026-10-02T12:00:00.000Z' }),
  ], holdBeforeIndex: -1 })
  await openWorkspaceFiles(page)
  await page.getByRole('textbox').fill('帮我做一个最近七天 topuplist 流量看板')
  submitted = true
  await page.getByRole('button', { name: '发送消息' }).click()
  await expect(page.locator('[data-workspace-files-panel]')).toBeVisible()
  await expect(page.locator('[data-run-timeline]')).toContainText('修改文件')
  const failedStep = page.locator('[data-run-timeline] li').filter({ hasText: '检查页面脚本' })
  await failedStep.locator('.run-tl-head').click()
  await expect(failedStep).toContainText('SyntaxError')
  const frame = page.frameLocator('[data-workspace-files-panel] [data-html-preview-panel] > iframe').frameLocator('iframe')
  await expect(frame.getByRole('heading', { name: 'topuplist 最近七天流量' })).toBeVisible()
  await frame.getByRole('button', { name: '访客', exact: true }).click()
  await expect(frame.locator('#metricValue')).toHaveText('81940')
  await frame.getByRole('button', { name: '刷新数据', exact: true }).click()
  await expect(frame.locator('#fresh')).toHaveText('数据已更新：34360')
  assert.equal(queries, 1)
  const child = page.frames().find(item => item.url() === 'about:srcdoc')!
  assert.equal(await child.evaluate(() => (window as unknown as { checkIsolation: () => string }).checkIsolation()), 'isolated')
  const panel = page.locator('[data-workspace-files-panel]')
  await expect(page.getByText('已生成页面并完成检查，数据为演示数据。')).toBeVisible()
  await expect(panel).toContainText('已保存版本 2')
  const downloaded = page.waitForEvent('download')
  await panel.getByRole('button', { name: `下载 ${file.path}`, exact: true }).dispatchEvent('click')
  const download = await downloaded
  assert.equal(download.suggestedFilename(), 'traffic.html')
  assert.equal(await readFile((await download.path())!, 'utf8'), html)
  await page.setViewportSize({ width: 1920, height: 1080 })
  await expect(panel.getByRole('complementary', { name: '工作文件' })).toBeVisible()
  const sourceFolder = panel.getByRole('button', { name: 'src', exact: true })
  await sourceFolder.click()
  await expect(sourceFolder).toHaveAttribute('aria-expanded', 'false')
  await expect(panel.getByRole('button', { name: 'src/example.ts', exact: true })).toHaveCount(0)
  await panel.getByRole('searchbox', { name: '搜索文件…' }).fill('EXAMPLE')
  await expect(panel.getByRole('button', { name: file.path, exact: true })).toHaveCount(0)
  await panel.getByRole('button', { name: 'src/example.ts', exact: true }).click()
  await expect(panel.locator('[data-workspace-source]')).toContainText('const answer: number')
  await expect(panel.getByRole('button', { name: '预览', exact: true })).toHaveCount(0)
  await panel.getByRole('button', { name: '关闭文件面板' }).click()
  await expect(panel).toHaveCount(0)
  await page.getByRole('button', { name: '工作文件' }).click()
  await expect(panel).toBeVisible()
  await panel.getByRole('button', { name: '关闭文件面板' }).click()
  const artifact = page.locator('[data-workspace-artifact]')
  await expect(artifact).toContainText(file.path)
  await artifact.getByRole('button', { name: '打开面板', exact: true }).click()
  await expect(frame.getByRole('heading', { name: 'topuplist 最近七天流量' })).toBeVisible()
})

test('快速文字之后的工具过程和交付卡片刷新可恢复，卡片在宽屏与窄屏打开指定文件', async ({ page }) => {
  const other = { ...file, path: 'another.html' }
  const activity = { answerStartedMs: 910, toolBeforeAnswer: false, items: [
    { kind: 'thought', text: '我先检查页面，然后保存生成的文件。' },
    { kind: 'tool', callId: 'saved-page', toolName: 'write', ok: true, workspace: { operation: 'write', title: '编写流量看板', path: file.path, revision: 1, files: [file] } },
  ] }
  await installApiRoutes(page, () => [
    { id: 'user-saved', conversationId: CONVERSATION_ID, role: 'USER', content: '制作看板', status: 'COMPLETED', createdAt: '2026-10-02T00:00:00Z', updatedAt: '2026-10-02T00:00:00Z' },
    { id: 'assistant-saved', conversationId: CONVERSATION_ID, role: 'ASSISTANT', content: '我先取一下接口数据。页面已保存。', status: 'COMPLETED', activity, createdAt: '2026-10-02T00:00:00Z', updatedAt: '2026-10-02T00:01:00Z' },
  ])
  await installBrowserStubs(page, { lines: [], holdBeforeIndex: -1 })
  await page.route('**/api/conversations/*/workspace**', (route) => {
    const url = new URL(route.request().url())
    const data = url.pathname.endsWith('/file') ? { encoding: 'base64', content: Buffer.from(url.searchParams.get('path') === file.path ? html : '<html><body><h1>另一个文件</h1></body></html>').toString('base64') } : { ...snapshot, files: [other, file] }
    return route.fulfill({ json: { success: true, code: 0, data } })
  })
  await openWorkspaceFiles(page)
  const panel = page.locator('[data-workspace-files-panel]')
  const artifact = page.locator('[data-workspace-artifact]')
  await expect(page.locator('[data-run-row]')).toBeVisible()
  await page.locator('[data-run-row]').click()
  await expect(page.locator('[data-run-timeline]')).toContainText('我先检查页面')
  await expect(artifact).toContainText(file.path)
  await panel.getByRole('button', { name: '关闭文件面板' }).click()
  await artifact.getByRole('button', { name: '打开面板', exact: true }).click()
  const frame = page.frameLocator('[data-workspace-files-panel] [data-html-preview-panel] > iframe').frameLocator('iframe')
  await expect(frame.getByRole('heading', { name: 'topuplist 最近七天流量' })).toBeVisible()
  await page.reload()
  await expect(page.locator('[data-run-row]')).toBeVisible()
  await expect(artifact).toContainText(file.path)
  await expect(panel).toHaveCount(0)
  await page.setViewportSize({ width: 390, height: 844 })
  await artifact.getByRole('button', { name: `打开 ${file.path}`, exact: true }).click()
  await expect(frame.getByRole('heading', { name: 'topuplist 最近七天流量' })).toBeVisible()
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
  assert.equal(await page.evaluate(() => window.__chatRequests?.length ?? 0), 0)
})

test('工作文件在窄屏可关闭，页面不产生横向溢出', async ({ page }) => {
  await installApiRoutes(page, () => [{ id: 'saved-question', conversationId: CONVERSATION_ID, role: 'USER', content: '制作看板', status: 'COMPLETED', createdAt: '2026-10-02T00:00:00Z', updatedAt: '2026-10-02T00:00:00Z' }])
  await installBrowserStubs(page, { lines: [], holdBeforeIndex: -1 })
  await page.route('**/api/conversations/*/workspace**', (route) => {
    const url = new URL(route.request().url())
    return route.fulfill({ json: { success: true, code: 0, data: url.pathname.endsWith('/file') ? { encoding: 'base64', content: Buffer.from(url.searchParams.get('path') === 'src/example.ts' ? 'const answer: number = 42' : html).toString('base64') } : snapshot } })
  })
  await page.setViewportSize({ width: 390, height: 844 })
  await openWorkspaceFiles(page)
  const panel = page.locator('[data-workspace-files-panel]')
  await expect(panel).toBeVisible()
  await panel.getByRole('combobox', { name: '选择文件' }).selectOption('src/example.ts')
  await expect(panel.locator('[data-workspace-source]')).toContainText('const answer: number = 42')
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
  await panel.getByRole('button', { name: '关闭文件面板' }).click()
  await expect(panel).toHaveCount(0)
})

test('独立预览覆盖整个应用，按钮与 iframe 内 Esc 关闭后回到工作区', async ({ page }) => {
  await installApiRoutes(page, () => [{ id: 'saved-files', conversationId: CONVERSATION_ID, role: 'USER', content: '查看工作文件', status: 'COMPLETED', createdAt: '2026-10-02T00:00:00Z', updatedAt: '2026-10-02T00:00:00Z' }])
  await installBrowserStubs(page, { lines: [], holdBeforeIndex: -1 })
  await page.route('**/api/conversations/*/workspace**', route => route.fulfill({ json: { success: true, code: 0, data: new URL(route.request().url()).pathname.endsWith('/file') ? { encoding: 'base64', content: Buffer.from(html).toString('base64') } : snapshot } }))
  await page.setViewportSize({ width: 1920, height: 1080 })
  await openWorkspaceFiles(page)
  const panel = page.locator('[data-workspace-files-panel]')
  await expect(panel.getByRole('complementary', { name: '工作文件' })).toBeVisible()
  await panel.getByRole('button', { name: '代码', exact: true }).click()
  await expect(panel.locator('[data-workspace-source]')).toContainText('<!doctype html>')
  await panel.getByRole('button', { name: '放大预览', exact: true }).click()
  const dialog = page.locator('[data-expanded-preview]')
  await expect(dialog).toBeVisible()
  assert.equal(await page.evaluate(() => document.fullscreenElement === null), true)
  const largeWidth = await dialog.evaluate(element => element.getBoundingClientRect().width)
  const panelWidth = await panel.evaluate(element => element.getBoundingClientRect().width)
  assert.ok(largeWidth > panelWidth)
  const bounds = await dialog.evaluate((element) => {
    const rect = element.getBoundingClientRect()
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, viewportWidth: innerWidth, viewportHeight: innerHeight }
  })
  assert.equal(bounds.x, 0)
  assert.equal(bounds.y, 0)
  assert.equal(bounds.width, bounds.viewportWidth)
  assert.equal(bounds.height, bounds.viewportHeight)
  const frame = page.frameLocator('[data-expanded-preview] [data-html-preview-panel] > iframe').frameLocator('iframe')
  await expect(frame.getByRole('heading', { name: 'topuplist 最近七天流量' })).toBeVisible()
  await dialog.getByRole('button', { name: '关闭放大预览', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await expect(panel.locator('[data-workspace-source]')).toContainText('topuplist 最近七天流量')
  await expect(panel.getByRole('complementary', { name: '工作文件' })).toBeVisible()
  await panel.getByRole('button', { name: '放大预览', exact: true }).click()
  await frame.getByRole('button', { name: '访客', exact: true }).click()
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await expect(panel).toBeVisible()
  await page.setViewportSize({ width: 390, height: 844 })
  await panel.getByRole('button', { name: '放大预览', exact: true }).click()
  await expect(dialog).toBeVisible()
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
  await dialog.getByRole('button', { name: '关闭放大预览', exact: true }).click()
  await expect(panel).toBeVisible()
})

test('超过 20 KB 的代码有高亮与行号；格式化、换行和恢复原文不改变下载文件', async ({ page }) => {
  const longHtml = `<!doctype html><html><head><style>body{color:red;margin:0}</style></head><body><p>${'demo '.repeat(4200)}</p><script>const answer={n:42};</script></body></html>`
  const longFile = { ...file, bytes: Buffer.byteLength(longHtml) }
  await installApiRoutes(page, () => [{ id: 'saved-source', conversationId: CONVERSATION_ID, role: 'USER', content: '查看源码', status: 'COMPLETED', createdAt: '2026-10-02T00:00:00Z', updatedAt: '2026-10-02T00:00:00Z' }])
  await installBrowserStubs(page, { lines: [], holdBeforeIndex: -1 })
  await page.route('**/api/conversations/*/workspace**', route => route.fulfill({ json: { success: true, code: 0, data: new URL(route.request().url()).pathname.endsWith('/file') ? { encoding: 'base64', content: Buffer.from(longHtml).toString('base64') } : { ...snapshot, files: [longFile] } } }))
  await openWorkspaceFiles(page)
  const panel = page.locator('[data-workspace-files-panel]')
  await panel.getByRole('button', { name: '代码', exact: true }).click()
  const source = panel.locator('[data-workspace-source]')
  await expect(source.locator('.hljs-tag').first()).toBeVisible()
  await expect(source.locator('.source-gutter').first()).toHaveText('1')
  await panel.getByRole('button', { name: '格式化', exact: true }).click()
  await expect(source).toContainText('color: red;')
  await expect(source).toContainText('const answer = { n: 42 };')
  await panel.getByRole('button', { name: '长行换行', exact: true }).click()
  await expect(panel.getByRole('button', { name: '长行换行', exact: true })).toHaveAttribute('aria-pressed', 'true')
  assert.equal(await source.evaluate(element => element.scrollWidth > element.clientWidth + 1), false)
  const downloaded = page.waitForEvent('download')
  await panel.getByRole('button', { name: `下载 ${file.path}`, exact: true }).click()
  const download = await downloaded
  assert.equal(await readFile((await download.path())!, 'utf8'), longHtml)
  await panel.getByRole('button', { name: '查看原文', exact: true }).click()
  await expect(source).toContainText('color:red;margin:0')
  await expect(panel.getByRole('button', { name: '格式化', exact: true })).toBeVisible()
})

test('交互预览不能通过 WebRTC 或新 iframe 绕过网络与主应用隔离', async ({ page }) => {
  const socket = dgram.createSocket('udp4')
  let packets = 0
  socket.on('message', () => packets++)
  await new Promise<void>(resolve => socket.bind(0, '127.0.0.1', resolve))
  try {
    const port = socket.address().port
    const unsafe = `<html><body><h1>交互隔离验证</h1><pre id="result">pending</pre><script>
      let freshBlocked=false;try{const frame=document.createElement('iframe');document.body.append(frame);const Other=frame.contentWindow.RTCPeerConnection;if(Other){const pc=new Other({iceServers:[{urls:'stun:127.0.0.1:${port}'}]});pc.createDataChannel('probe');pc.createOffer().then(x=>pc.setLocalDescription(x))}else freshBlocked=true}catch{freshBlocked=true}
      let parentBlocked=false;try{parent.document.cookie}catch{parentBlocked=true}
      document.querySelector('#result').textContent=JSON.stringify({rtc:typeof RTCPeerConnection,worker:typeof Worker,freshBlocked,parentBlocked});
    </script></body></html>`
    await installApiRoutes(page, () => [{ id: 'u-sec', conversationId: CONVERSATION_ID, role: 'USER', content: '查看工作文件', status: 'COMPLETED', createdAt: '2026-10-02T00:00:00Z', updatedAt: '2026-10-02T00:00:00Z' }])
    await installBrowserStubs(page, { lines: [], holdBeforeIndex: -1 })
    await page.route('**/api/conversations/*/workspace**', route => route.fulfill({ json: { success: true, code: 0, data: new URL(route.request().url()).pathname.endsWith('/file') ? { encoding: 'base64', content: Buffer.from(unsafe).toString('base64') } : { ...snapshot, files: [file] } } }))
    await openWorkspaceFiles(page)
    const frame = page.frameLocator('[data-workspace-files-panel] [data-html-preview-panel] > iframe').frameLocator('iframe')
    await expect(frame.locator('#result')).toContainText('"rtc":"undefined"')
    await expect(frame.locator('#result')).toContainText('"worker":"undefined"')
    await expect(frame.locator('#result')).toContainText('"freshBlocked":true')
    await expect(frame.locator('#result')).toContainText('"parentBlocked":true')
    await page.waitForTimeout(1000)
    assert.equal(packets, 0)
  }
  finally { socket.close() }
})

test('R3：交付卡片等待同 SHA 的最新 manifest revision，读取的仍是该次交付内容', async ({ page }) => {
  const activity = { toolBeforeAnswer: true, items: [{ kind: 'tool' as const, callId: 'save', toolName: 'write', ok: true, workspace: { operation: 'write' as const, title: '保存页面', revision: 1, files: [file] } }] }
  await installApiRoutes(page, () => [
    { id: 'question', conversationId: CONVERSATION_ID, role: 'USER', content: '创建页面', status: 'COMPLETED', createdAt: '2026-10-02T00:00:00Z', updatedAt: '2026-10-02T00:00:00Z' },
    { id: 'saved', conversationId: CONVERSATION_ID, role: 'ASSISTANT', content: '页面已保存', status: 'COMPLETED', activity, createdAt: '2026-10-02T00:00:01Z', updatedAt: '2026-10-02T00:00:01Z' },
  ])
  await installBrowserStubs(page, { lines: [], holdBeforeIndex: -1 })
  let revision = 1
  let releaseRefresh: (() => void) | undefined
  let refreshRequested = false
  const revisions: number[] = []
  await page.route('**/api/conversations/*/workspace**', async (route) => {
    const url = new URL(route.request().url())
    if (url.pathname.endsWith('/file')) {
      const requested = Number(url.searchParams.get('revision'))
      revisions.push(requested)
      if (requested !== revision)
        return route.fulfill({ status: 409, json: { success: false, message: '文件版本已更新' } })
      return route.fulfill({ json: { success: true, code: 0, data: { encoding: 'base64', content: Buffer.from('<html><body><h1>内容 A</h1></body></html>').toString('base64') } } })
    }
    if (revision === 2) {
      refreshRequested = true
      await new Promise<void>((resolve) => {
        releaseRefresh = resolve
      })
    }
    return route.fulfill({ json: { success: true, code: 0, data: { ...snapshot, revision, files: [file, { path: 'other.txt', bytes: 1, sha256: String(revision).repeat(64) }] } } })
  })
  await openWorkspaceFiles(page)
  const panel = page.locator('[data-workspace-files-panel]')
  const frame = page.frameLocator('[data-workspace-files-panel] [data-html-preview-panel] > iframe').frameLocator('iframe')
  await expect(frame.getByRole('heading', { name: '内容 A' })).toBeVisible()
  await panel.getByRole('button', { name: '关闭文件面板' }).click()
  revision = 2
  const button = page.locator('[data-workspace-artifact]').getByRole('button', { name: '打开面板', exact: true })
  await button.click()
  await expect.poll(() => refreshRequested).toBe(true)
  await expect(button).toBeDisabled()
  releaseRefresh!()
  await expect(frame.getByRole('heading', { name: '内容 A' })).toBeVisible()
  await expect(button).toBeEnabled()
  await expect(panel.getByText(/已保存版本 2/)).toBeVisible()
  assert.deepEqual(revisions, [1], '清单 revision 更新但交付 SHA 不变时复用缓存，不再下载')
})

test('R3：点击旧交付卡期间文件 SHA 改变，不读取或展示同路径的新内容', async ({ page }) => {
  const activity = { toolBeforeAnswer: true, items: [{ kind: 'tool' as const, callId: 'save', toolName: 'write', ok: true, workspace: { operation: 'write' as const, title: '保存页面', revision: 1, files: [file] } }] }
  await installApiRoutes(page, () => [
    { id: 'question', conversationId: CONVERSATION_ID, role: 'USER', content: '创建页面', status: 'COMPLETED', createdAt: '2026-10-02T00:00:00Z', updatedAt: '2026-10-02T00:00:00Z' },
    { id: 'saved', conversationId: CONVERSATION_ID, role: 'ASSISTANT', content: '页面已保存', status: 'COMPLETED', activity, createdAt: '2026-10-02T00:00:01Z', updatedAt: '2026-10-02T00:00:01Z' },
  ])
  await installBrowserStubs(page, { lines: [], holdBeforeIndex: -1 })
  let changed = false
  let finishRefresh: (() => void) | undefined
  const reads: number[] = []
  await page.route('**/api/conversations/*/workspace**', async (route) => {
    const url = new URL(route.request().url())
    if (url.pathname.endsWith('/file')) {
      const revision = Number(url.searchParams.get('revision'))
      reads.push(revision)
      return route.fulfill({ json: { success: true, code: 0, data: { encoding: 'base64', content: Buffer.from(`<html><body><h1>内容 ${revision === 1 ? 'A' : 'B'}</h1></body></html>`).toString('base64') } } })
    }
    if (changed)
      await new Promise<void>((resolve) => { finishRefresh = resolve })
    return route.fulfill({ json: { success: true, code: 0, data: { ...snapshot, revision: changed ? 2 : 1, files: [{ ...file, sha256: changed ? 'b'.repeat(64) : file.sha256 }] } } })
  })
  await openWorkspaceFiles(page)
  const panel = page.locator('[data-workspace-files-panel]')
  const frame = page.frameLocator('[data-workspace-files-panel] [data-html-preview-panel] > iframe').frameLocator('iframe')
  await expect(frame.getByRole('heading', { name: '内容 A' })).toBeVisible()
  await panel.getByRole('button', { name: '关闭文件面板' }).click()
  changed = true
  const artifact = page.locator('[data-workspace-artifact]')
  await artifact.getByRole('button', { name: '打开面板', exact: true }).click()
  await expect.poll(() => Boolean(finishRefresh)).toBe(true)
  finishRefresh!()
  await expect(artifact).toHaveCount(0)
  await expect(page.getByText('文件已更新或暂时不可用，请刷新列表后重新打开。', { exact: true })).toBeVisible()
  await expect(panel).toHaveCount(0)
  assert.equal(reads.includes(2), false, '不能让面板自动预览绕过交付身份检查')
})

test('R3：交付文件读取未结束时 revision 和 SHA 改变，不自动改读 B 或接收迟到的 A', async ({ page }) => {
  const saved = { path: 'report.txt', bytes: 1, sha256: 'a'.repeat(64) }
  const activity = { toolBeforeAnswer: true, items: [{ kind: 'tool' as const, callId: 'save', toolName: 'write', ok: true, workspace: { operation: 'write' as const, title: '保存文件', revision: 1, files: [saved] } }] }
  await installApiRoutes(page, () => [
    { id: 'question', conversationId: CONVERSATION_ID, role: 'USER', content: '创建文件', status: 'COMPLETED', createdAt: '2026-10-02T00:00:00Z', updatedAt: '2026-10-02T00:00:00Z' },
    { id: 'saved', conversationId: CONVERSATION_ID, role: 'ASSISTANT', content: '文件已保存', status: 'COMPLETED', activity, createdAt: '2026-10-02T00:00:01Z', updatedAt: '2026-10-02T00:00:01Z' },
  ])
  await installBrowserStubs(page, { lines: [], holdBeforeIndex: -1 })
  let changed = false
  let finishOld: (() => Promise<void>) | undefined
  const reads: number[] = []
  await page.route('**/api/conversations/*/workspace**', (route) => {
    const url = new URL(route.request().url())
    if (url.pathname.endsWith('/file')) {
      const revision = Number(url.searchParams.get('revision'))
      reads.push(revision)
      const finish = () => route.fulfill({ json: { success: true, code: 0, data: { encoding: 'base64', content: Buffer.from(revision === 1 ? '内容 A' : '内容 B').toString('base64') } } })
      if (revision === 1) {
        finishOld = finish
        return
      }
      return finish()
    }
    return route.fulfill({ json: { success: true, code: 0, data: { ...snapshot, revision: changed ? 2 : 1, files: [{ ...saved, sha256: changed ? 'b'.repeat(64) : saved.sha256 }] } } })
  })
  await openWorkspaceFiles(page)
  const panel = page.locator('[data-workspace-files-panel]')
  await page.locator('[data-workspace-artifact]').getByRole('button', { name: '打开面板', exact: true }).click()
  await expect.poll(() => Boolean(finishOld)).toBe(true)
  const oldFailure = page.waitForEvent('requestfailed', request => new URL(request.url()).pathname.endsWith('/workspace/file'))
  changed = true
  await panel.getByRole('button', { name: '刷新文件', exact: true }).click()
  await expect(panel.getByRole('alert')).toContainText('文件已更新')
  assert.deepEqual(reads, [1])
  await finishOld!()
  await oldFailure
  await expect(panel).not.toContainText('内容 A')
  await panel.getByRole('button', { name: saved.path, exact: true }).click()
  await expect(panel.locator('[data-workspace-source]')).toContainText('内容 B')
  assert.deepEqual(reads, [1, 2], '只有明确选择当前工作文件才读取 B')
})

for (const [from, to] of [[1400, 620], [620, 1400]] as const) {
  test(`R3：跨断点 ${from}→${to} 重建面板后，旧 A 完成和再次刷新都不能自动打开 B`, async ({ page }) => {
    await page.setViewportSize({ width: from, height: 900 })
    const activity = { toolBeforeAnswer: true, items: [{ kind: 'tool' as const, callId: 'save', toolName: 'write', ok: true, workspace: { operation: 'write' as const, title: '保存页面', revision: 1, files: [file] } }] }
    await installApiRoutes(page, () => [
      { id: 'question', conversationId: CONVERSATION_ID, role: 'USER', content: '创建页面', status: 'COMPLETED', createdAt: '2026-10-02T00:00:00Z', updatedAt: '2026-10-02T00:00:00Z' },
      { id: 'saved', conversationId: CONVERSATION_ID, role: 'ASSISTANT', content: '页面已保存', status: 'COMPLETED', activity, createdAt: '2026-10-02T00:00:01Z', updatedAt: '2026-10-02T00:00:01Z' },
    ])
    await installBrowserStubs(page, { lines: [], holdBeforeIndex: -1 })
    let changed = false
    let holdA = false
    let finishA: (() => Promise<void>) | undefined
    const reads: number[] = []
    await page.route('**/api/conversations/*/workspace**', (route) => {
      const url = new URL(route.request().url())
      if (url.pathname.endsWith('/file')) {
        const revision = Number(url.searchParams.get('revision'))
        reads.push(revision)
        const finish = () => route.fulfill({ json: { success: true, code: 0, data: { encoding: 'base64', content: Buffer.from(`<html><body><h1>Content ${revision === 1 ? 'A' : 'B'}</h1></body></html>`).toString('base64') } } })
        if (holdA && revision === 1) {
          finishA = finish
          return
        }
        return finish()
      }
      return route.fulfill({ json: { success: true, code: 0, data: { ...snapshot, revision: changed ? 2 : 1, files: [{ ...file, sha256: changed ? 'b'.repeat(64) : file.sha256 }] } } })
    })
    await page.goto('/workspace')
    const panel = page.locator('[data-workspace-files-panel]')
    const frame = page.frameLocator('[data-workspace-files-panel] [data-html-preview-panel] > iframe').frameLocator('iframe')
    // 首次打开就挂起，不能先读成功再关闭：现在成功内容会跨面板复用。
    holdA = true
    await page.locator('[data-workspace-artifact]').getByRole('button', { name: '打开面板', exact: true }).click()
    await expect.poll(() => Boolean(finishA)).toBe(true)
    const oldPanel = await panel.elementHandle()
    assert.ok(oldPanel)
    await page.setViewportSize({ width: to, height: 900 })
    await expect.poll(() => oldPanel.evaluate(element => element.isConnected)).toBe(false)
    await expect(panel).toHaveCount(1)
    const oldFailure = page.waitForEvent('requestfailed', request => new URL(request.url()).pathname.endsWith('/workspace/file') && new URL(request.url()).searchParams.get('revision') === '1')
    changed = true
    await panel.getByRole('button', { name: '刷新文件', exact: true }).click()
    await expect(panel.getByText(/已保存版本 2/)).toBeVisible()
    await finishA!()
    await oldFailure
    // 等浏览器完成旧读取的 Promise/框架更新，再触发 G；不能只验证重建瞬间。
    await page.evaluate(() => new Promise<void>((resolve) => {
      requestAnimationFrame(() => resolve())
    }))
    const refreshed = page.waitForResponse(response => new URL(response.url()).pathname.endsWith('/workspace'))
    await panel.getByRole('button', { name: '刷新文件', exact: true }).click()
    await (await refreshed).finished()
    await expect(panel.getByRole('button', { name: '刷新文件', exact: true })).toBeEnabled()
    if (reads.includes(2))
      await expect(frame.getByRole('heading', { name: 'Content B' })).toBeVisible()
    const previews = (await Promise.all(page.frames().filter(child => child !== page.mainFrame()).map(child => child.getByRole('heading').allTextContents()))).flat()
    console.log('R3 remount before explicit selection:', JSON.stringify({ from, to, reads, previews }))
    assert.deepEqual(reads, [1], '重建、旧 finally 和后续刷新均不能把交付 A 自动改为 B')
    assert.equal(previews.some(text => text.includes('Content B')), false)
    await expect(panel).not.toContainText('Content B')
    await panel.getByRole('button', { name: file.path, exact: true }).click()
    await expect(frame.getByRole('heading', { name: 'Content B' })).toBeVisible()
    assert.deepEqual(reads, [1, 2], '只有明确选择当前 B 才读取 revision 2')
    console.log('R3 remount after explicit selection:', JSON.stringify({ from, to, reads, preview: 'Content B' }))
  })
}

test('下载途中当前文件被新版本删除时解除 loading，迟到结果不覆盖其他文件', async ({ page }) => {
  await installApiRoutes(page, () => [{ id: 'read-files', conversationId: CONVERSATION_ID, role: 'USER', content: '查看文件', status: 'COMPLETED', createdAt: '2026-10-02T00:00:00Z', updatedAt: '2026-10-02T00:00:00Z' }])
  await installBrowserStubs(page, { lines: [], holdBeforeIndex: -1 })
  let holdDownload = false
  let removed = false
  let finishDownload: (() => void) | undefined
  const kept = { path: 'keep.txt', bytes: 1, sha256: 'b'.repeat(64) }
  await page.route('**/api/conversations/*/workspace**', async (route) => {
    const url = new URL(route.request().url())
    if (url.pathname.endsWith('/file')) {
      // 已加载文件现在直接复用 bytes；首次读取失败后下载才需要网络。
      if (!holdDownload && url.searchParams.get('path') === file.path)
        return route.fulfill({ status: 503, json: { success: false, message: '暂时不可用' } })
      if (holdDownload && url.searchParams.get('path') === file.path) {
        await new Promise<void>((resolve) => {
          finishDownload = resolve
        })
      }
      return route.fulfill({ json: { success: true, code: 0, data: { encoding: 'base64', content: Buffer.from(url.searchParams.get('path') === file.path ? html : 'B').toString('base64') } } })
    }
    return route.fulfill({ json: { success: true, code: 0, data: { ...snapshot, revision: removed ? 3 : 2, files: removed ? [kept] : [file, kept] } } })
  })
  await openWorkspaceFiles(page)
  const panel = page.locator('[data-workspace-files-panel]')
  await expect(panel.getByRole('alert')).toContainText('文件已更新或暂时不可用')
  holdDownload = true
  const lateFailure = page.waitForEvent('requestfailed', request => new URL(request.url()).pathname.endsWith('/workspace/file') && new URL(request.url()).searchParams.get('path') === file.path)
  await panel.getByRole('button', { name: `下载 ${file.path}`, exact: true }).first().click()
  try {
    await expect.poll(() => Boolean(finishDownload)).toBe(true)
    removed = true
    await panel.getByRole('button', { name: '刷新文件', exact: true }).click()
    const other = panel.getByRole('button', { name: 'keep.txt', exact: true })
    await expect(other).toBeEnabled()
    await other.click()
    await expect(panel.locator('[data-workspace-source]')).toContainText('B')
  }
  finally {
    finishDownload?.()
    await lateFailure
  }
  await expect(panel.locator('[data-workspace-source]')).toContainText('B')
})

test('关闭未完成的交付文件后可重新打开并合并在途读取，完成前保持新面板 loading', async ({ page }) => {
  const textFile = { path: 'report.txt', bytes: 1, sha256: 'a'.repeat(64) }
  const activity = { toolBeforeAnswer: true, items: [{ kind: 'tool' as const, callId: 'save', toolName: 'write', ok: true, workspace: { operation: 'write' as const, title: '保存文件', revision: 1, files: [textFile] } }] }
  await installApiRoutes(page, () => [
    { id: 'question', conversationId: CONVERSATION_ID, role: 'USER', content: '创建文件', status: 'COMPLETED', createdAt: '2026-10-02T00:00:00Z', updatedAt: '2026-10-02T00:00:00Z' },
    { id: 'saved', conversationId: CONVERSATION_ID, role: 'ASSISTANT', content: '文件已保存', status: 'COMPLETED', activity, createdAt: '2026-10-02T00:00:01Z', updatedAt: '2026-10-02T00:00:01Z' },
  ])
  await installBrowserStubs(page, { lines: [], holdBeforeIndex: -1 })
  const pending: Array<() => Promise<void>> = []
  await page.route('**/api/conversations/*/workspace**', (route) => {
    if (new URL(route.request().url()).pathname.endsWith('/file')) {
      pending.push(() => route.fulfill({ json: { success: true, code: 0, data: { encoding: 'base64', content: Buffer.from('B').toString('base64') } } }))
      return
    }
    return route.fulfill({ json: { success: true, code: 0, data: { ...snapshot, revision: 1, files: [textFile] } } })
  })
  await openWorkspaceFiles(page)
  const panel = page.locator('[data-workspace-files-panel]')
  const open = page.locator('[data-workspace-artifact]').getByRole('button', { name: '打开面板', exact: true })
  await open.click()
  await expect.poll(() => pending.length).toBe(1)
  await expect(open).toBeDisabled()
  await panel.getByRole('button', { name: '关闭文件面板' }).click()
  await expect(open).toBeEnabled()
  await open.click()
  await expect(panel).toHaveCount(1)
  await expect(open).toBeDisabled()
  assert.equal(pending.length, 1, '面板重建复用同文件在途请求，不重复下载')
  await pending[0]!()
  await expect(open).toBeEnabled()
  await expect(panel.locator('[data-workspace-source]')).toContainText('B')
})

test('手动打开面板后首次预览读取期间版本更新，会重读最新版本并丢弃旧文件', async ({ page }) => {
  await installApiRoutes(page, () => [{ id: 'view-file', conversationId: CONVERSATION_ID, role: 'USER', content: '查看文件', status: 'COMPLETED', createdAt: '2026-10-02T00:00:00Z', updatedAt: '2026-10-02T00:00:00Z' }])
  await installBrowserStubs(page, { lines: [], holdBeforeIndex: -1 })
  let revision = 1
  let finishOld: (() => Promise<void>) | undefined
  await page.route('**/api/conversations/*/workspace**', (route) => {
    const url = new URL(route.request().url())
    if (url.pathname.endsWith('/file')) {
      const requested = Number(url.searchParams.get('revision'))
      const fulfill = () => route.fulfill({ json: { success: true, code: 0, data: { encoding: 'base64', content: Buffer.from(`<html><body><h1>版本 ${requested}</h1></body></html>`).toString('base64') } } })
      if (requested === 1) {
        finishOld = fulfill
        return
      }
      return fulfill()
    }
    return route.fulfill({ json: { success: true, code: 0, data: { ...snapshot, revision, files: [{ ...file, sha256: String(revision).repeat(64) }] } } })
  })
  await openWorkspaceFiles(page)
  const panel = page.locator('[data-workspace-files-panel]')
  await expect.poll(() => Boolean(finishOld)).toBe(true)
  const oldFailure = page.waitForEvent('requestfailed', request => new URL(request.url()).pathname.endsWith('/workspace/file'))
  revision = 2
  await panel.getByRole('button', { name: '刷新文件', exact: true }).click()
  const frame = page.frameLocator('[data-workspace-files-panel] [data-html-preview-panel] > iframe').frameLocator('iframe')
  await expect(frame.getByRole('heading', { name: '版本 2' })).toBeVisible()
  await finishOld!()
  await oldFailure
  await expect(frame.getByRole('heading', { name: '版本 2' })).toBeVisible()
  await expect(panel.getByRole('alert')).toHaveCount(0)
})

test('交互预览禁网、自身导航受限，伪造消息不能改外层或冒用其他会话查询', async ({ page, baseURL }) => {
  const target = `${baseURL}/preview-leak`
  let leaked = 0
  const queries: string[] = []
  await page.route('**/preview-leak**', (route) => {
    leaked++
    return route.abort()
  })
  const unsafe = `<html><body><h1>消息桥接验证</h1><button id="direct">伪造宿主消息</button><button id="query">合法桥接</button><a href="${target}/navigation">导航</a><img src="${target}/image"><script>
    fetch('${target}/fetch').catch(()=>{});
    parent.postMessage({type:'html-preview',title:'attack',code:'<html><body>REPLACED</body></html>'},'*');
    document.querySelector('#direct').onclick=()=>parent.parent.postMessage({type:'workspace-query',id:'direct',query:'topuplist.traffic'},'*');
    document.querySelector('#query').onclick=()=>parent.postMessage({type:'workspace-query',id:'allowed',query:'topuplist.traffic',conversationId:'other-conversation',userId:'other-user'},'*');
  </script></body></html>`
  await installApiRoutes(page, () => [{ id: 'security', conversationId: CONVERSATION_ID, role: 'USER', content: '预览', status: 'COMPLETED', createdAt: '2026-10-02T00:00:00Z', updatedAt: '2026-10-02T00:00:00Z' }])
  await installBrowserStubs(page, { lines: [], holdBeforeIndex: -1 })
  await page.route('**/api/conversations/*/workspace**', (route) => {
    const url = new URL(route.request().url())
    if (url.pathname.endsWith('/traffic')) {
      queries.push(url.pathname)
      return route.fulfill({ json: { success: true, code: 0, data: { source: 'demo' } } })
    }
    const data = url.pathname.endsWith('/file') ? { encoding: 'base64', content: Buffer.from(unsafe).toString('base64') } : { ...snapshot, files: [file] }
    return route.fulfill({ json: { success: true, code: 0, data } })
  })
  await openWorkspaceFiles(page)
  const frame = page.frameLocator('[data-workspace-files-panel] [data-html-preview-panel] > iframe').frameLocator('iframe')
  await expect(frame.getByRole('heading', { name: '消息桥接验证' })).toBeVisible()
  await frame.getByRole('button', { name: '伪造宿主消息' }).click()
  await frame.getByRole('button', { name: '合法桥接' }).click()
  await expect.poll(() => queries.length).toBe(1)
  assert.deepEqual(queries, [`/api/conversations/${CONVERSATION_ID}/workspace/traffic`])
  await expect(frame.getByRole('heading', { name: '消息桥接验证' })).toBeVisible()
  await frame.getByRole('link', { name: '导航', exact: true }).click()
  await page.waitForTimeout(200)
  assert.equal(leaked, 0)
  assert.equal(new URL(page.url()).pathname, '/workspace')
})

test('会话初载不自动展开，A→B→A 复用已读缓存；离开 A 期间编辑后必须重读', async ({ page }) => {
  await installApiRoutes(page, () => [])
  await installBrowserStubs(page, { lines: [], holdBeforeIndex: -1 })
  const ids = [CONVERSATION_ID, 'conversation-files-b']
  let revisionA = 1
  const reads: string[] = []
  await page.route('**/api/conversations?*', route => route.fulfill({ json: { success: true, code: 0, data: {
    items: ids.map((id, index) => ({ id, title: `会话 ${index === 0 ? 'A' : 'B'}`, createdAt: '2026-10-03T00:00:00Z', updatedAt: '2026-10-03T00:00:00Z' })),
    nextCursor: null,
  } } }))
  await page.route('**/api/conversations/*/messages', (route) => {
    const id = new URL(route.request().url()).pathname.split('/')[3]!
    return route.fulfill({ json: { success: true, code: 0, data: [{ id: `question-${id}`, conversationId: id, role: 'USER', content: `消息 ${id}`, status: 'COMPLETED', createdAt: '2026-10-03T00:00:00Z', updatedAt: '2026-10-03T00:00:00Z' }] } })
  })
  await page.route('**/api/conversations/*/workspace**', (route) => {
    const url = new URL(route.request().url())
    const id = url.pathname.split('/')[3]!
    if (url.pathname.endsWith('/file')) {
      reads.push(id)
      return route.fulfill({ json: { success: true, code: 0, data: { encoding: 'base64', content: Buffer.from(`<html><body><h1>文件 ${id}</h1><p>内容 ${id === ids[0] ? revisionA : 1}</p></body></html>`).toString('base64') } } })
    }
    return route.fulfill({ json: { success: true, code: 0, data: { ...snapshot, conversationId: id, revision: id === ids[0] ? revisionA : 1, files: [{ ...file, sha256: String(id === ids[0] ? revisionA : 1).repeat(64) }] } } })
  })
  await page.goto('/workspace')
  const panel = page.locator('[data-workspace-files-panel]')
  const open = page.locator('[data-open-workspace-files]')
  await expect(page.getByText(`消息 ${ids[0]}`, { exact: true })).toBeVisible()
  await expect(open).toBeEnabled()
  await expect(panel).toHaveCount(0)
  await page.getByRole('button', { name: '会话 B', exact: true }).click()
  await expect(page.getByText(`消息 ${ids[1]}`, { exact: true })).toBeVisible()
  await expect(open).toBeEnabled()
  await expect(panel).toHaveCount(0)
  assert.deepEqual(reads, [])
  await open.click()
  const frame = page.frameLocator('[data-workspace-files-panel] [data-html-preview-panel] > iframe').frameLocator('iframe')
  await expect(frame.getByRole('heading', { name: `文件 ${ids[1]}` })).toBeVisible()
  assert.deepEqual(reads, [ids[1]])
  await page.getByRole('button', { name: '会话 A', exact: true }).click()
  await expect(open).toBeEnabled()
  await expect(panel).toHaveCount(0)
  assert.deepEqual(reads, [ids[1]], '切换会话不触发文件下载或预览')
  await open.click()
  await expect(frame.getByRole('heading', { name: `文件 ${ids[0]}` })).toBeVisible()
  assert.deepEqual(reads, [ids[1], ids[0]])
  await page.getByRole('button', { name: '会话 B', exact: true }).click()
  await expect(open).toBeEnabled()
  await open.click()
  await expect(frame.getByRole('heading', { name: `文件 ${ids[1]}` })).toBeVisible()
  await page.getByRole('button', { name: '会话 A', exact: true }).click()
  await expect(open).toBeEnabled()
  await open.click()
  await expect(frame.getByRole('heading', { name: `文件 ${ids[0]}` })).toBeVisible()
  assert.deepEqual(reads, [ids[1], ids[0]], '跨会话重新打开仍复用未改的文件')
  await page.getByRole('button', { name: '会话 B', exact: true }).click()
  await expect(open).toBeEnabled()
  revisionA = 2
  await page.getByRole('button', { name: '会话 A', exact: true }).click()
  await expect(open).toBeEnabled()
  await open.click()
  await expect(frame.getByText('内容 2', { exact: true })).toBeVisible()
  assert.deepEqual(reads, [ids[1], ids[0], ids[0]], '离开会话期间编辑后必须请求新内容')
})

for (const path of ['index.html', 'notes.txt']) {
  test(`内容区加载 ${path} 时显示无可见文案的奶油色三球动画`, async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 1000 })
    await page.emulateMedia({ reducedMotion: path.endsWith('.txt') ? 'reduce' : 'no-preference' })
    await installApiRoutes(page, () => [{ id: 'read', conversationId: CONVERSATION_ID, role: 'USER', content: '查看文件', status: 'COMPLETED', createdAt: '2026-10-03T00:00:00Z', updatedAt: '2026-10-03T00:00:00Z' }])
    await installBrowserStubs(page, { lines: [], holdBeforeIndex: -1 })
    const requests: Array<() => Promise<void>> = []
    await page.route('**/api/conversations/*/workspace**', (route) => {
      if (new URL(route.request().url()).pathname.endsWith('/file')) {
        requests.push(() => route.fulfill({ json: { success: true, code: 0, data: { encoding: 'base64', content: Buffer.from(path.endsWith('.html') ? '<html><body><h1>文件已读取</h1></body></html>' : '笔记内容').toString('base64') } } }))
        return
      }
      return route.fulfill({ json: { success: true, code: 0, data: { ...snapshot, files: [{ ...file, path }] } } })
    })
    await page.goto('/workspace')
    await page.locator('[data-open-workspace-files]').click()
    const panel = page.locator('[data-workspace-files-panel]')
    if (path.endsWith('.txt'))
      await panel.getByRole('button', { name: path, exact: true }).click()
    await expect.poll(() => requests.length).toBe(1)
    const content = panel.locator('.file-viewport')
    const loading = content.locator('[data-workspace-content-loading]')
    await expect(content).toHaveAttribute('aria-busy', 'true')
    await expect(loading).toBeVisible()
    await expect(loading).toContainText('正在读取文件…')
    await expect(loading.locator('.loading-circle')).toHaveCount(3)
    await expect(loading.locator('.loading-shadow')).toHaveCount(3)
    await expect(content.getByText('从左侧选择文件，查看源码或预览页面。', { exact: true })).toHaveCount(0)
    await expect(loading.locator('p')).toHaveCount(0)
    const label = loading.locator('.sr-only')
    await expect(label).toHaveText('正在读取文件…')
    const labelBox = await label.boundingBox()
    assert.ok(labelBox && labelBox.width <= 1 && labelBox.height <= 1, '状态保留给读屏，不显示球下方文本')
    const style = await loading.locator('.loading-circle').first().evaluate(element => ({ color: getComputedStyle(element).backgroundColor, animation: getComputedStyle(element).animationName }))
    assert.equal(style.color, 'rgb(200, 168, 117)')
    if (path.endsWith('.txt'))
      assert.equal(style.animation, 'none')
    else
      assert.notEqual(style.animation, 'none')
    await panel.screenshot({ path: test.info().outputPath(`loading-${path}.png`) })
    await requests[0]!()
    await expect(loading).toHaveCount(0)
    await expect(content).toHaveAttribute('aria-busy', 'false')
    if (path.endsWith('.html'))
      await expect(page.frameLocator('[data-workspace-files-panel] [data-html-preview-panel] > iframe').frameLocator('iframe').getByRole('heading', { name: '文件已读取' })).toBeVisible()
    else
      await expect(panel.locator('[data-workspace-source]')).toContainText('笔记内容')
  })
}

test('Markdown 文件直接渲染标题列表与代码块，不自动加载外部图片，下载保留原文', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 })
  await installApiRoutes(page, () => [{ id: 'md', conversationId: CONVERSATION_ID, role: 'USER', content: '查看说明', status: 'COMPLETED', createdAt: '2026-10-03T00:00:00Z', updatedAt: '2026-10-03T00:00:00Z' }])
  await installBrowserStubs(page, { lines: [], holdBeforeIndex: -1 })
  const markdown = '\uFEFF# 项目说明\r\n\r\n这是**重点**。\r\n\r\n- 第一步\r\n- 第二步\r\n\r\n```html\r\n<html><body>示例代码</body></html>\r\n```\r\n\r\n![外部图片](https://fixture.invalid/md-image)\r\n\r\n<script>window.__mdUnsafe=true</script>\r\n'
  const bytes = Buffer.from(markdown)
  let imageRequests = 0
  await page.route('**/md-image', (route) => {
    imageRequests++
    return route.abort()
  })
  await page.route('**/api/conversations/*/workspace**', (route) => {
    const data = new URL(route.request().url()).pathname.endsWith('/file')
      ? { encoding: 'base64', content: bytes.toString('base64') }
      : { ...snapshot, files: [{ path: 'README.md', bytes: bytes.length, sha256: 'a'.repeat(64) }] }
    return route.fulfill({ json: { success: true, code: 0, data } })
  })
  await openWorkspaceFiles(page)
  const panel = page.locator('[data-workspace-files-panel]')
  await panel.getByRole('button', { name: 'README.md', exact: true }).click()
  const preview = panel.locator('[data-workspace-markdown]')
  await expect(preview.getByRole('heading', { name: '项目说明', level: 1 })).toBeVisible()
  await expect(preview.locator('strong')).toHaveText('重点')
  await expect(preview.getByRole('listitem')).toHaveCount(2)
  await expect(preview.locator('code')).toContainText('<html><body>示例代码</body></html>')
  await expect(panel.locator('[data-workspace-source], .view-switch')).toHaveCount(0)
  await expect(preview.locator('script, img')).toHaveCount(0)
  await expect(preview.getByRole('link', { name: '外部图片', exact: true })).toHaveAttribute('rel', 'noreferrer noopener')
  await expect(preview.getByRole('button', { name: '预览', exact: true })).toBeDisabled()
  assert.equal(await page.evaluate(() => '__mdUnsafe' in window), false)
  assert.equal(imageRequests, 0)
  const download = page.waitForEvent('download')
  await panel.getByRole('button', { name: '下载 README.md', exact: true }).first().click()
  assert.deepEqual(await readFile((await (await download).path())!), bytes)
})

test('同面板 A→B→A 复用已读文件，编辑 B 后失效而未改的 A 不重新下载', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1000 })
  await installApiRoutes(page, () => [{ id: 'files', conversationId: CONVERSATION_ID, role: 'USER', content: '查看两个文件', status: 'COMPLETED', createdAt: '2026-10-03T00:00:00Z', updatedAt: '2026-10-03T00:00:00Z' }])
  await installBrowserStubs(page, { lines: [], holdBeforeIndex: -1 })
  let revision = 1
  const reads: Array<{ path: string, revision: number }> = []
  await page.route('**/api/conversations/*/workspace**', (route) => {
    const url = new URL(route.request().url())
    if (url.pathname.endsWith('/file')) {
      const path = url.searchParams.get('path')!
      const requested = Number(url.searchParams.get('revision'))
      reads.push({ path, revision: requested })
      if (requested !== revision)
        return route.fulfill({ status: 409, json: { success: false, code: 409, message: '文件版本已更新' } })
      return route.fulfill({ json: { success: true, code: 0, data: { encoding: 'base64', content: Buffer.from(path === 'a.txt' ? 'A 内容不变' : `B 内容 ${revision}`).toString('base64') } } })
    }
    return route.fulfill({ json: { success: true, code: 0, data: { ...snapshot, revision, files: [
      { path: 'a.txt', bytes: 20, sha256: 'a'.repeat(64) },
      { path: 'b.txt', bytes: 20, sha256: (revision === 1 ? 'b' : revision === 2 ? 'c' : 'd').repeat(64) },
    ] } } })
  })
  await page.goto('/workspace')
  await page.locator('[data-open-workspace-files]').click()
  const panel = page.locator('[data-workspace-files-panel]')
  const source = panel.locator('[data-workspace-source]')
  await panel.getByRole('button', { name: 'a.txt', exact: true }).click()
  await expect(source).toContainText('A 内容不变')
  await panel.getByRole('button', { name: 'b.txt', exact: true }).click()
  await expect(source).toContainText('B 内容 1')
  await panel.getByRole('button', { name: 'a.txt', exact: true }).click()
  await expect(source).toContainText('A 内容不变')
  assert.deepEqual(reads, [{ path: 'a.txt', revision: 1 }, { path: 'b.txt', revision: 1 }])
  revision = 2
  await panel.getByRole('button', { name: '刷新文件', exact: true }).click()
  await expect(panel.getByText(/已保存版本 2/)).toBeVisible()
  await expect(panel.getByRole('button', { name: '刷新文件', exact: true })).toBeEnabled()
  assert.equal(reads.length, 2, '只改 B 不应重新下载 A')
  await panel.getByRole('button', { name: 'b.txt', exact: true }).click()
  await expect(source).toContainText('B 内容 2')
  assert.deepEqual(reads, [{ path: 'a.txt', revision: 1 }, { path: 'b.txt', revision: 1 }, { path: 'b.txt', revision: 2 }])
  revision = 3
  await panel.getByRole('button', { name: '刷新文件', exact: true }).click()
  await expect(source).toContainText('B 内容 3')
  assert.deepEqual(reads.at(-1), { path: 'b.txt', revision: 3 }, '当前文件被编辑后也不能继续展示缓存旧内容')
})

test('同文件重复选择与下载复用原始字节，失败恢复、显式刷新与变版仍可重新读取', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 })
  await installApiRoutes(page, () => [{ id: 'view', conversationId: CONVERSATION_ID, role: 'USER', content: '查看文件', status: 'COMPLETED', createdAt: '2026-10-02T00:00:00Z', updatedAt: '2026-10-02T00:00:00Z' }])
  await installBrowserStubs(page, { lines: [], holdBeforeIndex: -1 })
  const original = Buffer.from(`\uFEFF${html}\r\n`)
  let revision = 1
  let manifests = 0
  let queries = 0
  const reads: number[] = []
  let failFirst!: () => Promise<void>
  await page.route('**/api/conversations/*/workspace**', (route) => {
    const url = new URL(route.request().url())
    if (url.pathname.endsWith('/traffic')) {
      queries++
      return route.fulfill({ json: { success: true, code: 0, data: { totals: { visitors: 99 } } } })
    }
    if (url.pathname.endsWith('/file')) {
      reads.push(Number(url.searchParams.get('revision')))
      if (reads.length === 1) {
        failFirst = () => route.fulfill({ status: 503, json: { success: false, message: '暂时不可用' } })
        return
      }
      return route.fulfill({ json: { success: true, code: 0, data: { encoding: 'base64', content: (revision === 1 ? original : Buffer.from('<html><body><h1>新版本</h1></body></html>')).toString('base64') } } })
    }
    manifests++
    return route.fulfill({ json: { success: true, code: 0, data: { ...snapshot, revision, files: [{ ...file, sha256: String(revision).repeat(64) }] } } })
  })
  await openWorkspaceFiles(page)
  const panel = page.locator('[data-workspace-files-panel]')
  const select = panel.getByRole('button', { name: file.path, exact: true })
  await expect.poll(() => reads.length).toBe(1)
  await expect(select).toBeDisabled()
  await expect(panel.getByRole('status')).toHaveText('正在读取文件…')
  await select.evaluate((button: HTMLButtonElement) => {
    button.click()
    button.click()
  })
  assert.deepEqual(reads, [1])
  await failFirst()
  await expect(panel.getByRole('alert')).toBeVisible()
  await expect(select).toBeEnabled()
  await select.click()
  const frame = page.frameLocator('[data-workspace-files-panel] [data-html-preview-panel] > iframe').frameLocator('iframe')
  await expect(frame.getByRole('heading', { name: 'topuplist 最近七天流量' })).toBeVisible()
  await expect(panel.getByRole('alert')).toHaveCount(0)
  await frame.getByRole('button', { name: '访客', exact: true }).click()
  await expect(frame.locator('#metricValue')).toHaveText('81940')
  await select.click()
  await select.click()
  assert.deepEqual(reads, [1, 1], '重复点击未再次读取文件')
  await expect(frame.locator('#metricValue')).toHaveText('81940')
  await expect(panel.getByRole('status')).toHaveCount(0)
  assert.deepEqual(reads, [1, 1], '重复选择不下载、不重建预览或闪 loading')
  await frame.getByRole('button', { name: '刷新数据', exact: true }).click()
  await expect(frame.locator('#fresh')).toHaveText('数据已更新：99')
  assert.equal(queries, 1, '页面内显式业务查询不受文件复用影响')
  await panel.getByRole('button', { name: '代码', exact: true }).click()
  await panel.getByRole('button', { name: '格式化', exact: true }).click()
  await expect(panel.getByRole('button', { name: '查看原文', exact: true })).toBeVisible()
  const downloaded = page.waitForEvent('download')
  await panel.getByRole('button', { name: `下载 ${file.path}`, exact: true }).first().click()
  assert.deepEqual(await readFile((await (await downloaded).path())!), original, '下载保留 BOM、CRLF，不使用格式化文本')
  assert.deepEqual(reads, [1, 1])
  const beforeRefresh = manifests
  await page.locator('[data-open-workspace-files]').click()
  await page.locator('[data-open-workspace-files]').click()
  assert.equal(manifests, beforeRefresh, '已打开的文件面板重复打开不刷新 manifest')
  await panel.getByRole('button', { name: '刷新文件', exact: true }).click()
  await expect(panel.getByRole('button', { name: '刷新文件', exact: true })).toBeEnabled()
  assert.equal(manifests, beforeRefresh + 1)
  assert.deepEqual(reads, [1, 1], '未变版的 manifest 刷新不重读文件')
  revision = 2
  await panel.getByRole('button', { name: '刷新文件', exact: true }).click()
  await expect(panel.locator('[data-workspace-source]')).toContainText('新版本')
  assert.deepEqual(reads, [1, 1, 2])
  await panel.getByRole('button', { name: '关闭文件面板' }).click()
  await page.getByRole('button', { name: '工作文件', exact: true }).click()
  await expect(frame.getByRole('heading', { name: '新版本' })).toBeVisible()
  assert.deepEqual(reads, [1, 1, 2], '关闭重开确认新清单后复用未改内容，不重复下载')
})

test('当前文件修改后读取失败不展示旧正文，重试成功后才恢复缓存', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 })
  await installApiRoutes(page, () => [{ id: 'cache-failure', conversationId: CONVERSATION_ID, role: 'USER', content: '查看文件', status: 'COMPLETED', createdAt: '2026-10-03T00:00:00Z', updatedAt: '2026-10-03T00:00:00Z' }])
  await installBrowserStubs(page, { lines: [], holdBeforeIndex: -1 })
  let revision = 1
  let fail = true
  let reads = 0
  await page.route('**/api/conversations/*/workspace**', (route) => {
    if (new URL(route.request().url()).pathname.endsWith('/file')) {
      reads++
      if (revision === 2 && fail)
        return route.fulfill({ status: 503, json: { success: false, code: 503, message: '读取失败' } })
      return route.fulfill({ json: { success: true, code: 0, data: { encoding: 'base64', content: Buffer.from(`正文 V${revision}`).toString('base64') } } })
    }
    return route.fulfill({ json: { success: true, code: 0, data: { ...snapshot, revision, files: [{ path: 'notes.txt', bytes: 10, sha256: String(revision).repeat(64) }] } } })
  })
  await openWorkspaceFiles(page)
  const panel = page.locator('[data-workspace-files-panel]')
  await panel.getByRole('button', { name: 'notes.txt', exact: true }).click()
  await expect(panel.locator('[data-workspace-source]')).toContainText('正文 V1')
  revision = 2
  await panel.getByRole('button', { name: '刷新文件', exact: true }).click()
  await expect(panel.getByRole('alert')).toBeVisible()
  await expect(panel.locator('[data-workspace-source]')).toHaveCount(0)
  await expect(panel).not.toContainText('正文 V1')
  fail = false
  await panel.getByRole('button', { name: '重试', exact: true }).click()
  await expect(panel.locator('[data-workspace-source]')).toContainText('正文 V2')
  await panel.getByRole('button', { name: 'notes.txt', exact: true }).click()
  assert.equal(reads, 3, '失败不缓存，成功后重复选择不重读')
})

test('重新打开先等待清单，不按旧版本预读；清单失败不能使用已有正文缓存', async ({ page }) => {
  await installApiRoutes(page, () => [{ id: 'cache-revalidate', conversationId: CONVERSATION_ID, role: 'USER', content: '查看文件', status: 'COMPLETED', createdAt: '2026-10-03T00:00:00Z', updatedAt: '2026-10-03T00:00:00Z' }])
  await installBrowserStubs(page, { lines: [], holdBeforeIndex: -1 })
  let revision = 1
  let hold = false
  let fail = false
  let finish!: () => Promise<void>
  const reads: number[] = []
  await page.route('**/api/conversations/*/workspace**', (route) => {
    if (new URL(route.request().url()).pathname.endsWith('/file')) {
      reads.push(Number(new URL(route.request().url()).searchParams.get('revision')))
      return route.fulfill({ json: { success: true, code: 0, data: { encoding: 'base64', content: Buffer.from(`<html><body><h1>版本 ${revision}</h1></body></html>`).toString('base64') } } })
    }
    const respond = () => fail
      ? route.fulfill({ status: 503, json: { success: false, code: 503, message: '清单不可用' } })
      : route.fulfill({ json: { success: true, code: 0, data: { ...snapshot, revision, files: [{ ...file, sha256: String(revision).repeat(64) }] } } })
    if (hold) {
      finish = respond
      return
    }
    return respond()
  })
  await openWorkspaceFiles(page)
  const panel = page.locator('[data-workspace-files-panel]')
  const open = page.locator('[data-open-workspace-files]')
  const frame = page.frameLocator('[data-workspace-files-panel] [data-html-preview-panel] > iframe').frameLocator('iframe')
  await expect(frame.getByRole('heading', { name: '版本 1' })).toBeVisible()
  await panel.getByRole('button', { name: '关闭文件面板' }).click()
  revision = 2
  hold = true
  await open.click()
  await expect(open).toHaveAttribute('aria-busy', 'true')
  await expect.poll(() => typeof finish).toBe('function')
  await expect(panel).toHaveCount(0)
  assert.deepEqual(reads, [1], '最新清单未返回前不能预读旧版')
  hold = false
  await finish()
  await expect(frame.getByRole('heading', { name: '版本 2' })).toBeVisible()
  assert.deepEqual(reads, [1, 2])
  await panel.getByRole('button', { name: '关闭文件面板' }).click()
  fail = true
  await open.click()
  await expect(open).toBeEnabled()
  await expect(panel).toHaveCount(0)
  assert.deepEqual(reads, [1, 2], '清单失败不使用缓存冒充最新内容')
  fail = false
  await open.click()
  await expect(frame.getByRole('heading', { name: '版本 2' })).toBeVisible()
  assert.deepEqual(reads, [1, 2], '重新确认清单成功后可以复用相同 SHA 的缓存')
})

test('清单只更新 revision 或状态时，不打断另一个未读文件的在途下载', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 })
  await installApiRoutes(page, () => [{ id: 'cache-download', conversationId: CONVERSATION_ID, role: 'USER', content: '下载文件', status: 'COMPLETED', createdAt: '2026-10-03T00:00:00Z', updatedAt: '2026-10-03T00:00:00Z' }])
  await installBrowserStubs(page, { lines: [], holdBeforeIndex: -1 })
  let revision = 1
  let finish!: () => Promise<void>
  const reads: string[] = []
  await page.route('**/api/conversations/*/workspace**', (route) => {
    const url = new URL(route.request().url())
    if (url.pathname.endsWith('/file')) {
      const path = url.searchParams.get('path')!
      reads.push(path)
      const respond = () => route.fulfill({ json: { success: true, code: 0, data: { encoding: 'base64', content: Buffer.from(path === 'a.txt' ? '正文 A' : '下载 B').toString('base64') } } })
      if (path === 'b.txt') {
        finish = respond
        return
      }
      return respond()
    }
    return route.fulfill({ json: { success: true, code: 0, data: { ...snapshot, revision, files: [
      { path: 'a.txt', bytes: 8, sha256: 'a'.repeat(64) },
      { path: 'b.txt', bytes: 8, sha256: 'b'.repeat(64) },
    ] } } })
  })
  await openWorkspaceFiles(page)
  const panel = page.locator('[data-workspace-files-panel]')
  await panel.getByRole('button', { name: 'a.txt', exact: true }).click()
  await expect(panel.locator('[data-workspace-source]')).toContainText('正文 A')
  const download = page.waitForEvent('download')
  await panel.getByRole('button', { name: '下载 b.txt', exact: true }).click()
  await expect.poll(() => typeof finish).toBe('function')
  revision = 2
  await panel.getByRole('button', { name: '刷新文件', exact: true }).click()
  await expect(panel.getByText(/已保存版本 2/)).toBeVisible()
  await expect(panel.locator('.file-viewport')).toHaveAttribute('aria-busy', 'false')
  await expect(panel.locator('[data-workspace-download-loading]')).toContainText('b.txt')
  await finish()
  assert.equal(await readFile((await (await download).path())!, 'utf8'), '下载 B')
  await expect(panel.locator('.file-viewport')).toHaveAttribute('aria-busy', 'false')
  await expect(panel.locator('[data-workspace-source]')).toContainText('正文 A')
  await panel.getByRole('button', { name: 'b.txt', exact: true }).click()
  await expect(panel.locator('[data-workspace-source]')).toContainText('下载 B')
  assert.deepEqual(reads, ['a.txt', 'b.txt'], '下载成功的字节进入缓存，切到该文件不重读')
})

test('桌面打开动画的旧帧晚到，不能让旧关闭定时器隐藏重开的文件面板', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 })
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await installApiRoutes(page, () => [{ id: 'late-animation', conversationId: CONVERSATION_ID, role: 'USER', content: '查看文件', status: 'COMPLETED', createdAt: '2026-10-03T00:00:00Z', updatedAt: '2026-10-03T00:00:00Z' }])
  await installBrowserStubs(page, { lines: [], holdBeforeIndex: -1 })
  await page.route('**/api/conversations/*/workspace', route => route.fulfill({ json: { success: true, code: 0, data: { ...snapshot, files: [{ path: 'notes.txt', bytes: 0, sha256: 'a'.repeat(64) }] } } }))
  await page.goto('/workspace')
  const open = page.locator('[data-open-workspace-files]')
  const panel = page.locator('[data-workspace-files-panel]')
  await expect(open).toBeEnabled()
  await page.evaluate(() => new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  }))
  await page.evaluate(() => {
    const state = window as unknown as { __lateFrames: FrameRequestCallback[], __deliverLateFrames: () => void }
    const schedule = window.requestAnimationFrame.bind(window)
    const cancel = window.cancelAnimationFrame.bind(window)
    state.__lateFrames = []
    window.requestAnimationFrame = callback => -state.__lateFrames.push(callback)
    // 故障注入：模拟取消已来不及阻止的旧帧，不能只靠 cancelAnimationFrame 才正确。
    window.cancelAnimationFrame = (id) => {
      if (id >= 0)
        cancel(id)
    }
    state.__deliverLateFrames = () => {
      window.requestAnimationFrame = schedule
      window.cancelAnimationFrame = cancel
      for (const callback of state.__lateFrames.splice(0))
        callback(performance.now())
    }
  })
  await open.click()
  await expect.poll(() => page.evaluate(() => (window as unknown as { __lateFrames: unknown[] }).__lateFrames.length)).toBeGreaterThan(0)
  const closedAt = await panel.getByRole('button', { name: '关闭文件面板', includeHidden: true }).evaluate((button: HTMLButtonElement) => {
    button.click()
    return performance.now()
  })
  await page.evaluate(() => (window as unknown as { __deliverLateFrames: () => void }).__deliverLateFrames())
  // 在关闭动画窗口内触发重开，不让 Playwright 的指针稳定等待绕过竞态。
  await open.evaluate((button: HTMLButtonElement) => button.click())
  await expect(open).toHaveAttribute('aria-expanded', 'true')
  // 跨过旧关闭与新打开的动画时限，检查最终界面而不是刚重开的瞬间。
  await page.waitForFunction(closedAt => performance.now() - closedAt > 450, closedAt, { polling: 50 })
  await expect(panel).toBeVisible()
  await expect(panel.getByRole('button', { name: 'notes.txt', exact: true })).toBeVisible()
})

test('减少动态效果时，窄屏 HTML 预览和文件面板的打开关闭都没有滑动过渡', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await installApiRoutes(page, () => [
    { id: 'u-motion', conversationId: CONVERSATION_ID, role: 'USER', content: '查看页面', status: 'COMPLETED', createdAt: '2026-10-03T00:00:00Z', updatedAt: '2026-10-03T00:00:00Z' },
    { id: 'a-motion', conversationId: CONVERSATION_ID, role: 'ASSISTANT', content: `\`\`\`html\n${html}\n\`\`\``, status: 'COMPLETED', createdAt: '2026-10-03T00:01:00Z', updatedAt: '2026-10-03T00:01:00Z' },
  ])
  await installBrowserStubs(page, { lines: [], holdBeforeIndex: -1 })
  await page.route('**/api/conversations/*/workspace**', route => route.fulfill({ json: { success: true, code: 0, data: new URL(route.request().url()).pathname.endsWith('/file') ? { encoding: 'base64', content: Buffer.from(html).toString('base64') } : { ...snapshot, files: [file] } } }))
  await page.goto('/workspace')
  await page.evaluate(() => {
    const state = window as unknown as { __transitionSamples: { kind: string, phase: string, duration: string }[] }
    state.__transitionSamples = []
    new MutationObserver(() => {
      for (const element of document.querySelectorAll('[data-html-preview-panel].transition-transform, [data-workspace-files-panel].transition-transform')) {
        state.__transitionSamples.push({ kind: element.hasAttribute('data-workspace-files-panel') ? 'files' : 'preview', phase: element.classList.contains('duration-300') ? 'enter' : 'leave', duration: getComputedStyle(element).transitionDuration })
      }
    }).observe(document.body, { attributes: true, attributeFilter: ['class'], childList: true, subtree: true })
  })
  await page.locator('.agent-code-card').getByRole('button', { name: '预览', exact: true }).click()
  await expect(page.locator('[data-html-preview-panel]')).toBeVisible()
  await page.getByRole('button', { name: '关闭预览', exact: true }).click()
  await expect(page.locator('[data-html-preview-panel]')).toHaveCount(0)
  await page.locator('[data-open-workspace-files]').click()
  const panel = page.locator('[data-workspace-files-panel]')
  await expect(panel).toBeVisible()
  await panel.getByRole('button', { name: '关闭文件面板', exact: true }).click()
  await expect(panel).toHaveCount(0)
  const samples = await page.evaluate(() => (window as unknown as { __transitionSamples: { kind: string, phase: string, duration: string }[] }).__transitionSamples)
  for (const kind of ['files', 'preview']) {
    for (const phase of ['enter', 'leave'])
      assert.ok(samples.some(sample => sample.kind === kind && sample.phase === phase), `必须实际检查 ${kind} 的 ${phase} 过渡`)
  }
  assert.ok(samples.every(sample => sample.duration.split(',').every(duration => Number.parseFloat(duration) === 0)), JSON.stringify(samples))
})
