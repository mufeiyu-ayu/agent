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
  await page.goto('/workspace')
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
  await panel.getByRole('checkbox', { name: '显示环境状态' }).check()
  await expect(panel.locator('[data-workspace-environment]')).toContainText('环境已关闭')
  const downloaded = page.waitForEvent('download')
  await panel.getByRole('button', { name: `下载 ${file.path}`, exact: true }).click()
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
  await page.goto('/workspace')
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
  await panel.getByRole('button', { name: '关闭文件面板' }).click()
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
  await page.goto('/workspace')
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
  await page.goto('/workspace')
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
  await page.goto('/workspace')
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
    await page.goto('/workspace')
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
  await page.goto('/workspace')
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
  assert.equal(revisions.at(-1), 2)
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
  await page.goto('/workspace')
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
  await page.goto('/workspace')
  const panel = page.locator('[data-workspace-files-panel]')
  await page.locator('[data-workspace-artifact]').getByRole('button', { name: '打开面板', exact: true }).click()
  await expect.poll(() => Boolean(finishOld)).toBe(true)
  changed = true
  await panel.getByRole('button', { name: '刷新文件', exact: true }).click()
  await expect(panel.getByRole('alert')).toContainText('文件已更新')
  assert.deepEqual(reads, [1])
  const oldResponse = page.waitForResponse(response => new URL(response.url()).pathname.endsWith('/workspace/file'))
  await finishOld!()
  await (await oldResponse).finished()
  await expect(panel).not.toContainText('内容 A')
  await panel.getByRole('button', { name: saved.path, exact: true }).click()
  await expect(panel.locator('[data-workspace-source]')).toContainText('内容 B')
  assert.deepEqual(reads, [1, 2], '只有明确选择当前工作文件才读取 B')
})

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
      if (holdDownload && url.searchParams.get('path') === file.path) {
        await new Promise<void>((resolve) => {
          finishDownload = resolve
        })
      }
      return route.fulfill({ json: { success: true, code: 0, data: { encoding: 'base64', content: Buffer.from(url.searchParams.get('path') === file.path ? html : 'B').toString('base64') } } })
    }
    return route.fulfill({ json: { success: true, code: 0, data: { ...snapshot, revision: removed ? 3 : 2, files: removed ? [kept] : [file, kept] } } })
  })
  await page.goto('/workspace')
  const panel = page.locator('[data-workspace-files-panel]')
  const frame = page.frameLocator('[data-workspace-files-panel] [data-html-preview-panel] > iframe').frameLocator('iframe')
  await expect(frame.getByRole('heading', { name: 'topuplist 最近七天流量' })).toBeVisible()
  holdDownload = true
  const lateResponse = page.waitForResponse(response => new URL(response.url()).pathname.endsWith('/workspace/file') && new URL(response.url()).searchParams.get('path') === file.path)
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
    await (await lateResponse).finished()
  }
  await expect(panel.locator('[data-workspace-source]')).toContainText('B')
})

test('关闭未完成的交付文件后可重新打开，旧读取结束不解除新操作的 loading', async ({ page }) => {
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
  await page.goto('/workspace')
  const panel = page.locator('[data-workspace-files-panel]')
  const open = page.locator('[data-workspace-artifact]').getByRole('button', { name: '打开面板', exact: true })
  await open.click()
  await expect.poll(() => pending.length).toBe(1)
  await expect(open).toBeDisabled()
  await panel.getByRole('button', { name: '关闭文件面板' }).click()
  await expect(open).toBeEnabled()
  await open.click()
  await expect.poll(() => pending.length).toBe(2)
  await expect(open).toBeDisabled()
  const oldResponse = page.waitForResponse(response => new URL(response.url()).pathname.endsWith('/workspace/file'))
  await pending[0]!()
  await (await oldResponse).finished()
  await expect(open).toBeDisabled()
  await pending[1]!()
  await expect(open).toBeEnabled()
  await expect(panel.locator('[data-workspace-source]')).toContainText('B')
})

test('首次自动预览读取期间版本更新，会重读最新版本并丢弃旧文件', async ({ page }) => {
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
    return route.fulfill({ json: { success: true, code: 0, data: { ...snapshot, revision, files: [file] } } })
  })
  await page.goto('/workspace')
  const panel = page.locator('[data-workspace-files-panel]')
  await expect.poll(() => Boolean(finishOld)).toBe(true)
  revision = 2
  await panel.getByRole('button', { name: '刷新文件', exact: true }).click()
  const frame = page.frameLocator('[data-workspace-files-panel] [data-html-preview-panel] > iframe').frameLocator('iframe')
  await expect(frame.getByRole('heading', { name: '版本 2' })).toBeVisible()
  const oldResponse = page.waitForResponse(response => new URL(response.url()).pathname.endsWith('/workspace/file'))
  await finishOld!()
  await (await oldResponse).finished()
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
  await page.goto('/workspace')
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
