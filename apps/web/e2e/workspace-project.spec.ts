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
const source = [{ path: 'src/App.tsx', content: Buffer.from('export default function App(){return <h1>演示数据</h1>}') }, { path: 'public/icon.svg', content: Buffer.from('<svg/>') }, { path: 'package.json', content: Buffer.from('{}') }, { path: 'pnpm-lock.yaml', content: Buffer.from('lockfileVersion: 9') }]
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
  await page.route('**/api/conversations/*/workspace**', (route) => {
    const url = new URL(route.request().url())
    let data: unknown = { ...snapshot, revision }
    if (url.pathname.endsWith('/preview'))
      data = { artifactId: artifact.id, url: `/api/workspace-preview/${token}/document` }
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
    const base = `${baseURL}/api/workspace-preview/${token}/files/`
    if (url.pathname.endsWith('/document'))
      return route.fulfill({ body: previewDocument(scripts['index.html']!, base), headers: { 'Content-Type': 'text/html', 'Content-Security-Policy': previewCsp(base), 'Referrer-Policy': 'no-referrer' } })
    const path = url.pathname.split('/files/')[1]!
    return route.fulfill({ body: scripts[path] ?? '', status: scripts[path] === undefined ? 404 : 200, headers: { 'Content-Type': artifactMime(path), 'Access-Control-Allow-Origin': 'null', 'Content-Disposition': 'attachment', 'Content-Security-Policy': 'sandbox; default-src \'none\'', 'X-Content-Type-Options': 'nosniff' } })
  })
  return { changeVersion: () => {
    revision++
  } }
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
    await expect(panel.locator('[data-build-identity]')).toContainText('源码版本 2')
    await expect(panel).toContainText('已保存版本 3')
    await expect(panel).toContainText('本轮构建失败')
    await expect(panel.getByRole('button', { name: '下载 src/App.tsx', exact: true })).toHaveCount(0)
    const downloading = page.waitForEvent('download')
    await panel.getByRole('button', { name: '下载源码 ZIP', exact: true }).click({ delay: 50 })
    const download = await downloading
    assert.equal(download.suggestedFilename(), 'project-v3.zip')
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
  await expect(error).toContainText('下载 project-v3.zip 失败')
  const retry = error.getByRole('button')
  const download = page.waitForEvent('download')
  await retry.click()
  assert.equal((await download).suggestedFilename(), 'project-v3.zip')
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
  assert.equal((await current).suggestedFilename(), 'project-v4.zip')
  assert.deepEqual(revisions, [3, 3, 3, 4])
})

test('Source 读取失败不阻断独立成功 Artifact 的侧栏和整页预览', async ({ page, baseURL }) => {
  await setup(page, baseURL!)
  await page.route('**/workspace/file?**', route => route.fulfill({ status: 503, json: { success: false, message: 'Source 暂时不可读取' } }))
  await page.goto('/workspace')
  await page.locator('[data-open-workspace-files]').click()
  const panel = page.locator('[data-workspace-files-panel]')
  await expect(panel.getByRole('alert')).toContainText('文件已更新或暂时不可用')
  await expect(panel.frameLocator('[data-html-preview-panel] > iframe').frameLocator('iframe').locator('body')).toHaveAttribute('data-loaded', 'true')
  await panel.getByRole('button', { name: '代码', exact: true }).click()
  await panel.getByRole('button', { name: '预览', exact: true }).click()
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
