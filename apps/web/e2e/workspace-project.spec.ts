import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import dgram from 'node:dgram'
import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import { sourceZip } from '../../api/src/workspaces/workspace-archive'
import { artifactMime, previewCsp, previewDocument } from '../../api/src/workspaces/workspace-preview'
import { CONVERSATION_ID, installApiRoutes, installBrowserStubs } from './fixtures'

const token = 'a'.repeat(64)
const secondToken = 'b'.repeat(64)
const source = [{ path: 'src/App.tsx', content: Buffer.from('export default function App(){return <h1>演示数据</h1>}') }, { path: 'public/icon.svg', content: Buffer.from('<svg/>') }, { path: 'package.json', content: Buffer.from('{}') }, { path: 'pnpm-lock.yaml', content: Buffer.from('lockfileVersion: 9') }, ...['README.md', 'SHADCN-LICENSE.md', '.gitignore', '.npmrc', '.nvmrc', 'tests/kuro-api.test.ts'].map(path => ({ path, content: Buffer.from(`preserved ${path}`) }))]
const html = '<!doctype html><html><head><script type="module" src="./assets/main.js?v=1"></script><link rel="stylesheet" href="./assets/main.css?v=1"></head><body><h1>演示数据看板</h1><button id="metric">切换指标</button><output id="value">42</output><img src="./icon.svg?v=1"><div id="probe"></div></body></html>'
const dist: Record<string, string> = {
  'index.html': html,
  'assets/main.js': 'import { n } from "./chunk.js?v=2";document.querySelector("#metric").onclick=()=>document.querySelector("#value").textContent=n;document.body.dataset.loaded="true";',
  'assets/chunk.js': 'export const n="84";',
  'assets/main.css': 'body{color:rgb(10, 20, 30);background-image:url(../icon.svg?q=3)}',
  'icon.svg': '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><rect width="20" height="20" fill="red"/></svg>',
}
const artifact = { id: 'build-1', sourceRevision: 2, runId: 'run-build', command: 'pnpm build', createdAt: '2026-10-04T00:00:00Z', files: Object.keys(dist).map(path => ({ path, bytes: Buffer.byteLength(dist[path]!), sha256: 'b'.repeat(64) })) }
const snapshot = { configured: true, conversationId: CONVERSATION_ID, revision: 3, webProject: true, artifact, state: 'idle', files: source.map(file => ({ path: file.path, bytes: file.content.length, sha256: 'a'.repeat(64) })), lastOperation: 'saving', lastError: '本轮构建失败，保留上次成功预览', updatedAt: '2026-10-04T00:00:00Z' }

async function setup(page: import('@playwright/test').Page, baseURL: string, scripts = dist, onCrossArtifact = () => {}) {
  await installApiRoutes(page, () => [{ id: 'question', conversationId: CONVERSATION_ID, role: 'USER', content: '做一个页面', status: 'COMPLETED', createdAt: '2026-10-04T00:00:00Z', updatedAt: '2026-10-04T00:00:00Z' }])
  await installBrowserStubs(page, { lines: [], holdBeforeIndex: -1 })
  let revision = 3
  let currentArtifact: typeof artifact | null = artifact
  let previewTtl = 600_000
  await page.route('**/api/conversations/*/workspace**', (route) => {
    const url = new URL(route.request().url())
    let data: unknown = { ...snapshot, revision, artifact: currentArtifact }
    if (url.pathname.endsWith('/preview')) {
      if (!currentArtifact || url.pathname.split('/').at(-2) !== currentArtifact.id)
        return route.fulfill({ status: 404, json: { success: false, message: '旧构建已退役' } })
      data = { artifactId: currentArtifact.id, url: `/api/workspace-preview/${currentArtifact.id === 'build-2' ? secondToken : token}/document`, expiresAt: new Date(Date.now() + previewTtl).toISOString() }
    }
    if (url.pathname.endsWith('/file'))
      data = { encoding: 'base64', content: source.find(file => file.path === url.searchParams.get('path'))!.content.toString('base64') }
    if (url.pathname.endsWith('/archive'))
      data = { revision: Number(url.searchParams.get('revision')), encoding: 'base64', content: sourceZip(source).toString('base64') }
    return route.fulfill({ json: { success: true, code: 0, data } })
  })
  await page.route('**/api/workspace-preview/**', (route) => {
    const url = new URL(route.request().url())
    if (url.pathname.includes(secondToken))
      onCrossArtifact()
    const base = `${baseURL}/api/workspace-preview/${url.pathname.split('/')[3]}/files/`
    if (url.pathname.endsWith('/document'))
      return route.fulfill({ body: previewDocument(scripts[url.searchParams.get('path') ?? 'index.html']!, base, url.searchParams.get('path') ?? 'index.html'), headers: { 'Content-Type': 'text/html', 'Content-Security-Policy': previewCsp(base), 'Referrer-Policy': 'no-referrer' } })
    const path = url.pathname.split('/files/')[1]!
    return route.fulfill({ body: scripts[path] ?? '', status: scripts[path] === undefined ? 404 : 200, headers: { 'Content-Type': artifactMime(path), 'Access-Control-Allow-Origin': 'null', 'Content-Disposition': 'attachment', 'Content-Security-Policy': 'sandbox; default-src \'none\'', 'X-Content-Type-Options': 'nosniff' } })
  })
  return {
    setArtifact: (id: string | null) => { currentArtifact = id ? { ...artifact, id } : null },
    expireAfter: (ms: number) => { previewTtl = ms },
    changeVersion: () => { revision++ },
  }
}

for (const width of [1920, 390]) {
  test(`完整 dist ${width}px：模块/查询参数/CSS/SVG、交互、整页、只读 TSX 和 Source ZIP`, async ({ page, baseURL }) => {
    await setup(page, baseURL!)
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.setViewportSize({ width, height: 900 })
    await page.goto('/workspace')
    await page.locator('[data-open-workspace-files]').click()
    const panel = page.locator('[data-workspace-files-panel]')
    const frame = panel.frameLocator('[data-html-preview-panel] > iframe').frameLocator('iframe')
    await expect(frame.locator('body')).toHaveAttribute('data-loaded', 'true')
    await frame.getByRole('button', { name: '切换指标' }).click({ delay: 50 })
    await expect(frame.locator('#value')).toHaveText('84')
    assert.equal(await frame.locator('body').evaluate(element => getComputedStyle(element).color), 'rgb(10, 20, 30)')
    assert.equal(await frame.locator('img').evaluate((element: HTMLImageElement) => element.naturalWidth), 20)
    await expect(panel.locator('[data-build-identity]')).toContainText('当前显示上次成功构建')
    await expect(panel).not.toContainText('已保存版本')
    await expect(panel).not.toContainText('源码版本')
    await expect(panel).not.toContainText(artifact.id)
    await expect(panel).toContainText('本轮构建失败')
    await expect(panel.getByRole('button', { name: '下载 src/App.tsx', exact: true })).toHaveCount(0)
    const downloading = page.waitForEvent('download')
    await panel.getByRole('button', { name: '下载源码 ZIP', exact: true }).click({ delay: 50 })
    const download = await downloading
    assert.equal(download.suggestedFilename(), 'project.zip')
    assert.deepEqual(await readFile((await download.path())!), sourceZip(source))
    await panel.getByRole('button', { name: '代码', exact: true }).click()
    await expect(panel.locator('[data-workspace-source]')).toContainText('export default function App')
    await panel.getByRole('button', { name: '格式化', exact: true }).click()
    await expect(panel.getByRole('button', { name: '查看原文', exact: true })).toBeVisible()
    await panel.getByRole('button', { name: '放大预览' }).click()
    const dialog = page.locator('[data-expanded-preview]')
    await expect(dialog.frameLocator('[data-html-preview-panel] > iframe').frameLocator('iframe').getByRole('heading')).toHaveText('演示数据看板')
    await dialog.getByRole('button', { name: '关闭放大预览' }).click()
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
  })
}

test('同一 iframe 浏览上下文跨 Code/Preview 和 native 全屏复用，Source 刷新不重载', async ({ page, baseURL }) => {
  const state = await setup(page, baseURL!)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.setViewportSize({ width: 1920, height: 900 })
  const requests: string[] = []
  page.on('request', (request) => {
    if (request.url().includes('/preview?') || request.url().includes('/api/workspace-preview/'))
      requests.push(request.url())
  })
  await page.goto('/workspace')
  await page.locator('[data-open-workspace-files]').click()
  const panel = page.locator('[data-workspace-files-panel]')
  const child = panel.frameLocator('[data-html-preview-panel] > iframe').frameLocator('iframe')
  await expect(child.locator('body')).toHaveAttribute('data-loaded', 'true')
  const outer = (await panel.locator('[data-html-preview-panel] > iframe').elementHandle())!
  const inner = (await (await outer.contentFrame())!.locator('iframe').elementHandle())!
  await child.getByRole('button', { name: '切换指标' }).click({ delay: 50 })
  await child.locator('body').evaluate(() => {
    document.body.style.height = '1800px'
    scrollTo(0, 200)
  })
  const before = [...requests]
  await panel.getByRole('button', { name: '代码', exact: true }).click()
  await panel.getByRole('button', { name: '预览', exact: true }).click()
  await expect(child.locator('#value')).toHaveText('84')
  assert.equal(await child.locator('body').evaluate(() => scrollY), 200)
  state.changeVersion()
  await panel.getByRole('button', { name: '刷新文件', exact: true }).click()
  await panel.getByRole('button', { name: '放大预览' }).click()
  const expanded = page.locator('[data-expanded-preview]')
  await expect(expanded).toBeVisible()
  await expect(expanded.frameLocator('[data-html-preview-panel] > iframe').frameLocator('iframe').locator('#value')).toHaveText('84')
  await expanded.getByRole('button', { name: '关闭放大预览' }).click()
  await expect(panel.getByRole('button', { name: '放大预览' })).toBeFocused()
  await panel.getByRole('button', { name: '放大预览' }).click()
  await page.keyboard.press('Escape')
  await expect(expanded).toHaveCount(0)
  assert.equal(await outer.evaluate(element => element.isConnected), true)
  assert.equal(await inner.evaluate(element => element.isConnected), true)
  await expect(child.locator('#value')).toHaveText('84')
  assert.equal(await child.locator('body').evaluate(() => scrollY), 200)
  assert.deepEqual(requests, before)
  console.log('iframe-reuse requests:', JSON.stringify(requests))
})

test('只看 Code 不预加载新 Artifact；切预览才加载一次', async ({ page, baseURL }) => {
  const state = await setup(page, baseURL!)
  state.setArtifact(null)
  const capabilities: string[] = []
  page.on('request', (r) => {
    if (r.url().includes('/preview?'))
      capabilities.push(r.url())
  })
  await page.goto('/workspace')
  await page.locator('[data-open-workspace-files]').click()
  const panel = page.locator('[data-workspace-files-panel]')
  await panel.getByRole('button', { name: 'src/App.tsx', exact: true }).click()
  state.setArtifact('build-2')
  await panel.getByRole('button', { name: '刷新文件', exact: true }).click()
  await expect(panel.getByRole('button', { name: '预览', exact: true })).toBeVisible()
  assert.deepEqual(capabilities, [])
  await panel.getByRole('button', { name: '预览', exact: true }).click()
  await expect(panel.frameLocator('[data-html-preview-panel] > iframe').frameLocator('iframe').locator('body')).toHaveAttribute('data-loaded', 'true')
  assert.equal(capabilities.length, 1)
})

test('旧预览到期明确失效，重试旧 Artifact 不重开；按需打开当前成功构建', async ({ page, baseURL }) => {
  const state = await setup(page, baseURL!)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  state.expireAfter(1500)
  const capabilities: string[] = []
  page.on('request', (r) => {
    if (r.url().includes('/preview?'))
      capabilities.push(r.url())
  })
  await page.goto('/workspace')
  await page.locator('[data-open-workspace-files]').click()
  const panel = page.locator('[data-workspace-files-panel]')
  const preview = panel.locator('[data-html-preview-panel]')
  await expect(preview.frameLocator(':scope > iframe').frameLocator('iframe').locator('body')).toHaveAttribute('data-loaded', 'true')
  state.setArtifact('build-2')
  state.expireAfter(600_000)
  await expect(preview.getByRole('alert')).toContainText('此预览已失效')
  await preview.getByRole('button', { name: '重试', exact: true }).click({ delay: 50 })
  await expect(preview.getByRole('alert')).toContainText('此预览已失效')
  await preview.getByRole('button', { name: '打开当前最近成功构建', exact: true }).click({ delay: 50 })
  await expect(preview.frameLocator(':scope > iframe').frameLocator('iframe').locator('body')).toHaveAttribute('data-loaded', 'true')
  await expect(preview.getByRole('alert')).toHaveCount(0)
  assert.deepEqual(capabilities.map(url => new URL(url).pathname.split('/').at(-2)), ['build-1', 'build-1', 'build-2'])
})

test('所有展示文件被隐藏时准确空态，Source 非空仍可下载完整 ZIP', async ({ page, baseURL }) => {
  await setup(page, baseURL!)
  const hidden = source.slice(4)
  await page.route('**/api/conversations/*/workspace', route => route.fulfill({ json: { success: true, code: 0, data: { ...snapshot, artifact: null, files: hidden.map(file => ({ path: file.path, bytes: file.content.length, sha256: 'a'.repeat(64) })) } } }))
  await page.route('**/workspace/archive?**', route => route.fulfill({ json: { success: true, code: 0, data: { revision: 3, encoding: 'base64', content: sourceZip(hidden).toString('base64') } } }))
  await page.goto('/workspace')
  await page.locator('[data-open-workspace-files]').click()
  const panel = page.locator('[data-workspace-files-panel]')
  await expect(panel.getByText('没有默认展示的文件，完整源码仍可下载。').first()).toBeVisible()
  await expect(panel.getByText('会话中生成的文件将保存在这里。')).toHaveCount(0)
  for (const file of hidden)
    await expect(panel.getByRole('button', { name: file.path, exact: true })).toHaveCount(0)
  const pending = page.waitForEvent('download')
  await panel.getByRole('button', { name: '下载源码 ZIP', exact: true }).click({ delay: 50 })
  assert.deepEqual(await readFile((await (await pending).path())!), sourceZip(hidden))
})

test('ready 等内层有效 load；空 load 和旧代次消息无效，错误后 ready 不覆盖失败', async ({ page, baseURL }) => {
  // 同一 source 的 postMessage 有序：wrapper 收到攻击后的 checkpoint 再转发给宿主，
  // 宿主看到 checkpoint 时，可能被伪造的 ready 已处理，不能只等 module 请求挂起。
  await page.addInitScript(() => {
    if (window.top === window) {
      addEventListener('message', (event) => {
        const frame = document.querySelector<HTMLIFrameElement>('[data-workspace-files-panel] [data-html-preview-panel] > iframe')
        if (event.source === frame?.contentWindow && event.data?.type === 'artifact-test-checkpoint')
          document.documentElement.dataset.artifactAttackObserved = 'true'
      })
    }
    else if (location.pathname.endsWith('/document')) {
      addEventListener('message', (event) => {
        if (event.source === document.querySelector('iframe')?.contentWindow && event.data?.type === 'attack-checkpoint')
          parent.postMessage({ type: 'artifact-test-checkpoint' }, '*')
      })
    }
  })
  await setup(page, baseURL!, { ...dist, 'index.html': html.replace('</body>', '<form name="currentScript"></form><script>parent.postMessage({type:"artifact-loaded"},"*");window.dispatchEvent(new Event("load"));parent.postMessage({type:"attack-checkpoint"},"*");document.body.dataset.attackSent="true";</script></body>') })
  let release!: () => Promise<void>
  await page.route('**/files/assets/main.js?*', (route) => {
    release = () => route.fallback()
  })
  await page.goto('/workspace')
  await page.locator('[data-open-workspace-files]').click()
  const preview = page.locator('[data-workspace-files-panel] [data-html-preview-panel]')
  await expect.poll(() => !!release).toBe(true)
  await expect(preview.frameLocator(':scope > iframe').frameLocator('iframe').locator('body')).toHaveAttribute('data-attack-sent', 'true')
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.artifactAttackObserved)).toBe('true')
  const wrapper = await (await preview.locator(':scope > iframe').elementHandle())!.contentFrame()
  await wrapper!.evaluate(() => document.querySelector('iframe')!.dispatchEvent(new Event('load')))
  await page.evaluate(() => {
    const frame = document.querySelector<HTMLIFrameElement>('[data-workspace-files-panel] [data-html-preview-panel] > iframe')!
    for (const type of ['artifact-ready', 'artifact-error'])
      dispatchEvent(new MessageEvent('message', { source: frame.contentWindow, origin: 'null', data: { type, generation: 'previous-generation' } }))
  })
  await expect(preview).toHaveAttribute('aria-busy', 'true')
  await expect(preview.getByRole('status')).toBeVisible()
  await release()
  await expect(preview.frameLocator(':scope > iframe').frameLocator('iframe').locator('body')).toHaveAttribute('data-loaded', 'true')
  await expect(preview).toHaveAttribute('aria-busy', 'false')
  await page.evaluate(() => {
    const frame = document.querySelector<HTMLIFrameElement>('[data-workspace-files-panel] [data-html-preview-panel] > iframe')!
    const generation = new URL(frame.src).searchParams.get('generation')
    for (const type of ['artifact-error', 'artifact-ready'])
      dispatchEvent(new MessageEvent('message', { source: frame.contentWindow, origin: 'null', data: { type, generation } }))
  })
  await expect(preview.getByRole('alert')).toBeVisible()
  await expect(preview.getByRole('button', { name: '重试' })).toBeEnabled()
})

test('实际页面错误后的 load 不假报 ready，显式重试恢复', async ({ page, baseURL }) => {
  const scripts = { ...dist, 'assets/main.js': 'throw new Error("injected page error")' }
  await setup(page, baseURL!, scripts)
  await page.goto('/workspace')
  await page.locator('[data-open-workspace-files]').click()
  const preview = page.locator('[data-workspace-files-panel] [data-html-preview-panel]')
  await expect(preview.getByRole('alert')).toBeVisible()
  await expect(preview).toHaveAttribute('aria-busy', 'false')
  const outer = (await preview.locator(':scope > iframe').elementHandle())!
  const panel = page.locator('[data-workspace-files-panel]')
  await panel.getByRole('button', { name: '放大预览' }).click()
  await preview.getByRole('button', { name: '重试', exact: true }).focus()
  await page.keyboard.press('Escape')
  await expect(page.locator('[data-expanded-preview]')).toHaveCount(0)
  await expect(panel).toBeVisible()
  await expect(panel.getByRole('button', { name: '放大预览' })).toBeFocused()
  assert.equal(await outer.evaluate(element => element.isConnected), true)
  scripts['assets/main.js'] = dist['assets/main.js']!
  await preview.getByRole('button', { name: '重试', exact: true }).click({ delay: 50 })
  await expect(preview.frameLocator(':scope > iframe').frameLocator('iframe').locator('body')).toHaveAttribute('data-loaded', 'true')
  await expect(preview.getByRole('alert')).toHaveCount(0)
  await expect(preview).toHaveAttribute('aria-busy', 'false')
})

test('dist 隔离覆盖直接打开/新窗口、Cookie/父页面、外网、自身导航、跨 Artifact、Worker 与 WebRTC', async ({ page, baseURL, context }) => {
  const socket = dgram.createSocket('udp4')
  let packets = 0
  socket.on('message', () => packets++)
  await new Promise<void>(resolve => socket.bind(0, '127.0.0.1', resolve))
  try {
    let outside = 0
    let crossArtifact = 0
    await context.route('**/forbidden**', (route) => {
      outside++
      return route.abort()
    })
    const probe = `const results={};try{results.cookie=document.cookie}catch{results.cookie='blocked'};try{parent.document.body;results.parent='access'}catch{results.parent='blocked'};results.worker=typeof Worker;results.rtc=typeof RTCPeerConnection;try{new Worker('./chunk.js')}catch{};fetch('https://evil.invalid/forbidden').catch(()=>{});const image=new Image();image.src='https://evil.invalid/forbidden';try{window.open('https://evil.invalid/forbidden')}catch{};const cross=document.createElement('script');cross.type='module';cross.src='/api/workspace-preview/${secondToken}/files/assets/main.js';document.body.append(cross);const nested=document.createElement('iframe');document.body.append(nested);try{const RTC=nested.contentWindow.RTCPeerConnection;if(RTC){const pc=new RTC({iceServers:[{urls:'stun:127.0.0.1:${socket.address().port}'}]});pc.createDataChannel('x');pc.createOffer().then(x=>pc.setLocalDescription(x));results.nested='access'}}catch{results.nested='blocked'};document.querySelector('#probe').textContent=JSON.stringify(results);setTimeout(()=>location.href='https://evil.invalid/forbidden',500);`
    const scripts = { ...dist, 'assets/main.js': probe }
    await setup(page, baseURL!, scripts, () => {
      crossArtifact++
    })
    await page.goto('/workspace')
    await page.evaluate(() => document.cookie = 'private_fixture=secret;path=/')
    await page.locator('[data-open-workspace-files]').click()
    const frame = page.frameLocator('[data-workspace-files-panel] [data-html-preview-panel] > iframe').frameLocator('iframe')
    await expect(frame.locator('#probe')).toContainText('"parent":"blocked"')
    await expect(frame.locator('#probe')).toContainText('"worker":"undefined"')
    await expect(frame.locator('#probe')).toContainText('"rtc":"undefined"')
    await expect(frame.locator('#probe')).toContainText('"cookie":"blocked"')
    await expect(frame.locator('#probe')).toContainText('"nested":"blocked"')
    await page.waitForTimeout(1000)
    assert.equal(outside, 0)
    assert.equal(packets, 0)
    // 新窗口打开的入口仍只是同一个 sandbox 可信包装器，不给生成页面受信任 origin。
    const direct = await context.newPage()
    await setup(direct, baseURL!, scripts)
    await direct.goto(`/api/workspace-preview/${token}/document`)
    await expect(direct.frameLocator('iframe').locator('#probe')).toContainText('"parent":"blocked"')
    assert.equal(await direct.evaluate(() => {
      try {
        return document.cookie
      }
      catch {
        return 'blocked'
      }
    }), 'blocked')
    const resourceDownload = direct.waitForEvent('download')
    await direct.goto(`/api/workspace-preview/${token}/files/icon.svg`).catch(() => {})
    await resourceDownload
    assert.equal(outside, 0)
    await direct.close()
    assert.equal(crossArtifact, 0)
  }
  finally { socket.close() }
})

test('源码 ZIP 重试固定 revision；变版取消旧归档，迟到结果不能交付新版本', async ({ page, baseURL }) => {
  const state = await setup(page, baseURL!)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  const revisions: number[] = []
  let finish: (() => Promise<void>) | undefined
  let hold = false
  await page.route('**/workspace/archive?**', (route) => {
    const revision = Number(new URL(route.request().url()).searchParams.get('revision'))
    revisions.push(revision)
    if (revisions.length === 1)
      return route.fulfill({ status: 503, json: { success: false, message: '读取失败' } })
    const done = () => route.fulfill({ json: { success: true, code: 0, data: { revision, encoding: 'base64', content: sourceZip(source).toString('base64') } } })
    if (hold) {
      finish = done
      return
    }
    return done()
  })
  await page.goto('/workspace')
  await page.locator('[data-open-workspace-files]').click()
  const panel = page.locator('[data-workspace-files-panel]')
  const button = panel.getByRole('button', { name: '下载源码 ZIP', exact: true })
  await button.click()
  const error = panel.locator('[data-workspace-download-error]')
  await expect(error).toContainText('下载 project.zip 失败')
  const retry = error.getByRole('button')
  const download = page.waitForEvent('download')
  await retry.click()
  assert.equal((await download).suggestedFilename(), 'project.zip')
  assert.deepEqual(revisions, [3, 3])
  hold = true
  await button.click()
  await expect.poll(() => Boolean(finish)).toBe(true)
  await expect(button).toBeDisabled()
  state.changeVersion()
  const aborted = page.waitForEvent('requestfailed', request => request.url().includes('/workspace/archive'))
  await panel.getByRole('button', { name: '刷新文件', exact: true }).click()
  await aborted
  await expect(error).toContainText('已变化或删除')
  await finish!()
  await retry.click()
  assert.deepEqual(revisions, [3, 3, 3], '失败重试不能自动切换为 revision 4')
  hold = false
  const current = page.waitForEvent('download')
  await button.click({ delay: 50 })
  assert.equal((await current).suggestedFilename(), 'project.zip')
  assert.deepEqual(revisions, [3, 3, 3, 4])
})

test('普通锚点滚动、原生多页链接保持固定 Artifact 和隔离', async ({ page, baseURL }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await setup(page, baseURL!, {
    ...dist,
    'index.html': '<!doctype html><a href="#features">Features</a><a href="./pages/about 团队.html">About</a><div style="height:1500px"></div><h2 id="features">目标锚点</h2>',
    'pages/about 团队.html': '<!doctype html><h1>About page</h1><a href="../index.html">Home</a><script src="../assets/about.js"></script>',
    'assets/about.js': 'document.body.dataset.loaded="about";',
  })
  await page.goto('/workspace')
  await page.locator('[data-open-workspace-files]').click()
  const frame = page.frameLocator('[data-workspace-files-panel] [data-html-preview-panel] > iframe').frameLocator('iframe')
  await frame.getByRole('link', { name: 'Features' }).click()
  await expect(frame.getByRole('heading', { name: '目标锚点' })).toBeInViewport()
  assert.ok(await frame.locator('body').evaluate(() => scrollY > 0))
  await frame.locator('body').evaluate(() => scrollTo(0, 0))
  await frame.getByRole('link', { name: 'About', exact: true }).click({ delay: 50 })
  await expect(frame.getByRole('heading')).toHaveText('About page')
  await expect(frame.locator('body')).toHaveAttribute('data-loaded', 'about')
  await frame.getByRole('link', { name: 'Home' }).click({ delay: 50 })
  await expect(frame.getByRole('link', { name: 'Features' })).toBeVisible()
})

test('F2：固定 Artifact 跨页锚点往返在有效加载后定位真实目标', async ({ page, baseURL }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  const navigations: string[] = []
  const capabilities: string[] = []
  page.on('request', (request) => {
    const url = new URL(request.url())
    if (url.pathname.endsWith('/preview'))
      capabilities.push(url.pathname)
    if (url.pathname.includes('/workspace-preview/') && url.pathname.endsWith('/document'))
      navigations.push(request.url())
  })
  await setup(page, baseURL!, {
    ...dist,
    'index.html': '<!doctype html><a href="./pages/about 团队.html#pricing">About pricing</a><div style="height:1500px"></div><section id="features"><h2>Features area</h2></section><div style="height:1500px"></div>',
    'pages/about 团队.html': '<!doctype html><a href="../index.html#features">Home features</a><div style="height:1700px"></div><section id="pricing"><h2>Pricing area</h2></section><div style="height:1500px"></div><script src="../assets/about.js"></script>',
    'assets/about.js': 'document.body.dataset.loaded="about";',
  })
  await page.goto('/workspace')
  await page.locator('[data-open-workspace-files]').click()
  const frame = page.frameLocator('[data-workspace-files-panel] [data-html-preview-panel] > iframe').frameLocator('iframe')
  await frame.getByRole('link', { name: 'About pricing' }).click({ delay: 50 })
  await expect(frame.locator('body')).toHaveAttribute('data-loaded', 'about')
  await expect(frame.getByRole('heading', { name: 'Pricing area' })).toBeInViewport()
  const pricing = await frame.locator('#pricing').evaluate(element => ({ top: element.getBoundingClientRect().top, y: scrollY }))
  assert.ok(pricing.y >= 1700)
  assert.ok(Math.abs(pricing.top) < 2)
  await frame.getByRole('link', { name: 'Home features' }).click({ delay: 50 })
  await expect(frame.getByRole('heading', { name: 'Features area' })).toBeInViewport()
  const features = await frame.locator('#features').evaluate(element => ({ top: element.getBoundingClientRect().top, y: scrollY }))
  assert.ok(features.y >= 1500)
  assert.ok(Math.abs(features.top) < 2)
  assert.equal(capabilities.length, 1)
  assert.ok(capabilities[0]!.includes(`/artifacts/${artifact.id}/preview`))
  assert.equal(navigations.length, 3)
  assert.ok(navigations.every(url => new URL(url).pathname === `/api/workspace-preview/${token}/document`))
  assert.deepEqual(navigations.map(url => new URL(url).searchParams.get('path')), [null, 'pages/about 团队.html', 'index.html'], 'fragment 不进入资源 path')
  console.log('F2 navigation:', JSON.stringify({ pricing, features, capabilityCount: capabilities.length, documentPaths: navigations.map(url => new URL(url).searchParams.get('path')) }))
})

test('Source 读取失败不阻断独立成功 Artifact 的侧栏和整页预览', async ({ page, baseURL }) => {
  await setup(page, baseURL!)
  let fail = true
  await page.route('**/workspace/file?**', route => fail ? route.fulfill({ status: 503, json: { success: false, message: 'Source 暂时不可读取' } }) : route.fallback())
  await page.goto('/workspace')
  await page.locator('[data-open-workspace-files]').click()
  const panel = page.locator('[data-workspace-files-panel]')
  await expect(panel.getByRole('alert')).toContainText('文件已更新或暂时不可用')
  await expect(panel.frameLocator('[data-html-preview-panel] > iframe').frameLocator('iframe').locator('body')).toHaveAttribute('data-loaded', 'true')
  fail = false
  await panel.getByRole('button', { name: '重试', exact: true }).click()
  await expect(panel.locator('[data-workspace-preview-error]')).toContainText('本轮构建失败')
  await expect(panel.getByRole('button', { name: '预览', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(panel.frameLocator('[data-html-preview-panel] > iframe').frameLocator('iframe').locator('body')).toHaveAttribute('data-loaded', 'true')
  await panel.getByRole('button', { name: '放大预览' }).click()
  await expect(page.locator('[data-expanded-preview]').frameLocator('[data-html-preview-panel] > iframe').frameLocator('iframe').locator('body')).toHaveAttribute('data-loaded', 'true')
})

test('源码已清空时窄屏仍可预览上次成功构建，不回退成单文件/空白页面', async ({ page, baseURL }) => {
  await setup(page, baseURL!)
  await page.route('**/api/conversations/*/workspace', route => route.fulfill({ json: { success: true, code: 0, data: { ...snapshot, revision: 4, files: [] } } }))
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/workspace')
  await page.locator('[data-open-workspace-files]').click()
  const panel = page.locator('[data-workspace-files-panel]')
  await expect(panel.frameLocator('[data-html-preview-panel] > iframe').frameLocator('iframe').locator('body')).toHaveAttribute('data-loaded', 'true')
  await expect(panel.getByRole('button', { name: '下载源码 ZIP', exact: true })).toHaveCount(0)
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
})
