import type { Page } from '@playwright/test'
import assert from 'node:assert/strict'
import dgram from 'node:dgram'
import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'

import { CONVERSATION_ID, installApiRoutes, installBrowserStubs } from './fixtures'

const html = '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><style>body{background:#fff8ef}h1{color:rgb(50,80,100)}</style></head><body><h1>奶油博客</h1><button onclick="this.textContent=Number(this.textContent)+1">0</button><script>document.body.dataset.ready="yes"</script></body></html>\n'
const fenced = (code: string, language = 'html') => `\`\`\`${language}\n${code}\`\`\``

async function openReply(page: Page, reply: string) {
  await installApiRoutes(page, () => [{
    id: 'user-html',
    conversationId: CONVERSATION_ID,
    role: 'USER',
    content: '创建一个页面',
    status: 'COMPLETED',
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
  }, {
    id: 'assistant-html',
    conversationId: CONVERSATION_ID,
    role: 'ASSISTANT',
    content: reply,
    status: 'COMPLETED',
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
  }])
  await installBrowserStubs(page, { lines: [], holdBeforeIndex: -1 })
  await page.goto('/workspace')
  await expect(page.locator('.agent-code-card').first()).toBeVisible()
}

test('HTML 按需静态预览、脚本不执行、复制与原文下载；多卡片独立且窄屏不溢出', async ({ page }) => {
  await openReply(page, `${fenced(html, 'HTML')}\n\n${fenced('<html><body><h1>第二张页面</h1></body></html>\n')}`)
  const card = page.locator('.agent-code-card').first()
  const preview = card.getByRole('button', { name: '预览', exact: true })
  await expect(page.locator('iframe')).toHaveCount(0)
  await preview.focus()
  await page.keyboard.press('Enter')
  const panel = page.locator('[data-html-preview-panel]')
  const frame = page.frameLocator('[data-html-preview-panel] > iframe').frameLocator('iframe')
  await expect(frame.getByRole('heading', { name: '奶油博客' })).toHaveCSS('color', 'rgb(50, 80, 100)')
  await frame.getByRole('button', { name: '0', exact: true }).click()
  await expect(frame.getByRole('button', { name: '0', exact: true })).toBeVisible()
  await expect(preview).toHaveAttribute('aria-pressed', 'true')
  await expect(panel.locator('iframe')).toHaveAttribute('title', 'HTML 预览')
  await expect(card.locator('code')).toBeVisible()
  await expect(page.locator('.agent-code-card').nth(1).locator('iframe')).toHaveCount(0)

  await card.getByRole('button', { name: '复制代码' }).click()
  assert.equal(await page.evaluate(() => window.__copiedText), html)
  const downloadPending = page.waitForEvent('download')
  await card.getByRole('link', { name: '下载 HTML' }).click()
  const download = await downloadPending
  assert.equal(download.suggestedFilename(), 'index.html')
  assert.equal(await readFile((await download.path())!, 'utf8'), html)

  await card.getByRole('button', { name: '代码', exact: true }).click()
  await expect(panel).toHaveCount(0)
  await expect(card.getByRole('button', { name: '代码', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await preview.click()
  await expect(frame.getByRole('button', { name: '0', exact: true })).toBeVisible()
  await page.setViewportSize({ width: 320, height: 720 })
  await expect(panel).toBeVisible()
  await expect(panel.getByRole('button', { name: '关闭预览' })).toBeFocused()
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false)
  await panel.getByRole('button', { name: '关闭预览' }).click()
  await expect(panel).toHaveCount(0)
  await expect(page.getByRole('textbox').first()).toBeVisible()
})

test('流式 HTML 未闭合时不执行；闭合后可预览，离开会话释放下载 URL', async ({ page }) => {
  const identity = { conversationId: CONVERSATION_ID, assistantMessageId: 'assistant-live' }
  await installApiRoutes(page, () => [])
  await installBrowserStubs(page, {
    lines: [
      JSON.stringify({ ...identity, type: 'start', userMessageId: 'user-live' }),
      JSON.stringify({ ...identity, type: 'delta', contentDelta: `\`\`\`html\n${html}` }),
      JSON.stringify({ ...identity, type: 'delta', contentDelta: '```' }),
      JSON.stringify({ ...identity, type: 'done', content: fenced(html), generatedAt: '2026-10-01T00:00:00.000Z' }),
    ],
    holdBeforeIndex: 2,
  })
  await page.goto('/workspace')
  await page.getByRole('textbox').first().fill('生成页面')
  await page.getByRole('button', { name: '发送消息' }).click()
  const card = page.locator('.agent-code-card')
  await expect(card.getByLabel('正在生成...')).toBeVisible()
  await expect(card.getByRole('button', { name: '预览', exact: true })).toHaveCount(0)
  await expect(card.getByRole('link', { name: '下载 HTML' })).toHaveCount(0)
  await expect(page.locator('iframe')).toHaveCount(0)
  await page.evaluate(() => window.__releaseStream?.())
  await expect(card.getByRole('button', { name: '预览', exact: true })).toBeVisible()
  const url = await card.getByRole('link', { name: '下载 HTML' }).getAttribute('href')
  assert.ok(url?.startsWith('blob:'))
  await card.getByRole('button', { name: '预览', exact: true }).click()
  await expect(page.frameLocator('[data-html-preview-panel] > iframe').frameLocator('iframe').getByRole('heading')).toHaveText('奶油博客')
  await page.getByRole('button', { name: '新建对话', exact: true }).click()
  await expect(page.locator('.agent-code-card')).toHaveCount(0)
  assert.equal(await page.evaluate(async (oldUrl) => {
    try {
      await fetch(oldUrl!)
      return false
    }
    catch {
      return true
    }
  }, url), true)
})

test('不可信 HTML 无法访问主应用、打开弹窗或外发网络；自身导航也受约束', async ({ page, baseURL }) => {
  const target = `${baseURL}/preview-leak`
  let leakedRequests = 0
  await page.route('**/preview-leak**', (route) => {
    leakedRequests++
    return route.abort()
  })
  const malicious = `<html><body><h1>隔离测试</h1><pre id="result"></pre><a href="${target}/navigation">外部页面</a>
<img src="${target}/image"><script src="${target}/script"></script><iframe src="${target}/frame"></iframe>
<style>@import url('${target}/style');</style>
<form action="${target}/form"><button>提交</button></form>
<button onclick="document.querySelector('#result').textContent='执行了脚本'; fetch('${target}/fetch')">执行脚本</button>
<script>document.querySelector('#result').textContent='执行了脚本'; fetch('${target}/script-fetch');</script></body></html>\n`
  await openReply(page, fenced(malicious))
  await page.locator('.agent-code-card').getByRole('button', { name: '预览', exact: true }).click()
  const frame = page.frameLocator('[data-html-preview-panel] > iframe').frameLocator('iframe')
  await expect(frame.getByRole('heading', { name: '隔离测试' })).toBeVisible()
  await frame.getByRole('button', { name: '执行脚本' }).click()
  await expect(frame.locator('#result')).toHaveText('')
  assert.equal(await frame.locator('body').evaluate(() => {
    try {
      return Boolean(parent.parent.document.body)
    }
    catch {
      return false
    }
  }), false)
  assert.equal(await frame.locator('body').evaluate(() => {
    try {
      localStorage.getItem('secret')
      return true
    }
    catch {
      return false
    }
  }), false)
  await frame.getByRole('button', { name: '提交', exact: true }).click()
  assert.equal(leakedRequests, 0)
  await frame.getByRole('link', { name: '外部页面' }).click()
  // 等实际导航完成/被拒后检查；仅有 sandbox 属性不代表浏览器真的阻止网络外发。
  await expect.poll(() => page.frames().some(f => f.url().includes('preview-leak'))).toBe(false)
  await page.waitForTimeout(200)
  assert.equal(leakedRequests, 0)
  assert.equal(new URL(page.url()).pathname, '/workspace')
  await page.locator('.agent-code-card').getByRole('button', { name: '代码', exact: true }).click()
  await expect(page.locator('.agent-code-card > div iframe')).toHaveCount(0)
})

test('预览中的 WebRTC 脚本与事件处理器不执行，localhost STUN 收不到包', async ({ page }) => {
  const socket = dgram.createSocket('udp4')
  let packets = 0
  socket.on('message', () => packets++)
  await new Promise<void>(resolve => socket.bind(0, '127.0.0.1', resolve))
  try {
    const port = socket.address().port
    const attack = `const pc=new RTCPeerConnection({iceServers:[{urls:'stun:127.0.0.1:${port}'}]});window.pc=pc;pc.createDataChannel('probe');pc.createOffer().then(offer=>pc.setLocalDescription(offer));document.querySelector('#result').textContent='执行了脚本'`
    await openReply(page, fenced(`<html><body><pre id="result">脚本未执行</pre><script>${attack}</script><button onclick="${attack}">连接 WebRTC</button><h1>RTC 测试</h1></body></html>\n`))
    await page.locator('.agent-code-card').getByRole('button', { name: '预览', exact: true }).click()
    const frame = page.frameLocator('[data-html-preview-panel] > iframe').frameLocator('iframe')
    await expect(frame.getByRole('heading', { name: 'RTC 测试' })).toBeVisible()
    await frame.getByRole('button', { name: '连接 WebRTC' }).click()
    await page.waitForTimeout(1000)
    await expect(frame.locator('#result')).toHaveText('脚本未执行')
    assert.equal(packets, 0)
  }
  finally {
    socket.close()
  }
})

test('TS/JS/JSX 和 HTML 片段没有预览入口；完整 HTML 的英文控件与面板标题一致', async ({ page }) => {
  await openReply(page, `${fenced('const n: number = 1\n', 'ts')}\n\n${fenced('const n = 1\n', 'js')}\n\n${fenced('const node = <div>你好</div>\n', 'jsx')}\n\n${fenced('<h1>片段</h1>\n')}\n\n${fenced(html)}`)
  for (let index = 0; index < 4; index++) {
    const card = page.locator('.agent-code-card').nth(index)
    await expect(card.getByRole('button', { name: '预览', exact: true })).toHaveCount(0)
    await expect(card.getByRole('link', { name: '下载 HTML' })).toHaveCount(0)
    await expect(card.getByRole('button', { name: '复制代码' })).toBeVisible()
  }
  await expect(page.locator('[data-html-preview-panel]')).toHaveCount(0)
  await page.evaluate(async () => {
    const modulePath = '/src/i18n/index.ts'
    const { i18n } = await import(modulePath)
    i18n.global.locale.value = 'en-US'
  })
  const card = page.locator('.agent-code-card').nth(4)
  await card.getByRole('button', { name: 'Preview', exact: true }).click()
  await expect(page.locator('[data-html-preview-panel] > iframe')).toHaveAttribute('title', 'HTML preview')
  await expect(card.getByRole('link', { name: 'Download HTML' })).toBeVisible()
})

test('两栏鼠标与键盘调整，关闭恢复聊天全宽，重开记住比例，换文档只替换面板', async ({ page }) => {
  await openReply(page, `${fenced(html)}\n\n${fenced('<html><body><h1>第二张页面</h1></body></html>\n')}`)
  const chat = page.locator('[data-chat-pane]')
  const fullWidth = (await chat.boundingBox())!.width
  await page.locator('.agent-code-card').first().getByRole('button', { name: '预览', exact: true }).click()
  const handle = page.getByRole('separator', { name: '调整聊天与预览宽度' })
  await expect(handle).toBeVisible()
  const before = (await chat.boundingBox())!.width
  const box = (await handle.boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + 70, box.y + box.height / 2, { steps: 8 })
  await page.mouse.up()
  await expect.poll(async () => (await chat.boundingBox())!.width).toBeGreaterThan(before + 40)
  await handle.focus()
  await page.keyboard.press('ArrowLeft')
  await expect.poll(async () => (await chat.boundingBox())!.width).toBeLessThan(before + 40)
  const resized = (await chat.boundingBox())!.width
  assert.ok(resized >= 320)
  for (let index = 0; index < 6; index++)
    await handle.press('ArrowLeft')
  assert.ok((await chat.boundingBox())!.width >= 319.9)
  await handle.press('ArrowRight')
  const savedWidth = (await chat.boundingBox())!.width
  await page.locator('[data-html-preview-panel]').getByRole('button', { name: '关闭预览' }).click()
  await expect.poll(async () => (await chat.boundingBox())!.width).toBeCloseTo(fullWidth, 0)
  await page.locator('.agent-code-card').first().getByRole('button', { name: '预览', exact: true }).click()
  await expect.poll(async () => (await chat.boundingBox())!.width).toBeCloseTo(savedWidth, 0)
  await page.locator('.agent-code-card').nth(1).getByRole('button', { name: '预览', exact: true }).click()
  await expect(page.locator('[data-html-preview-panel]')).toHaveCount(1)
  await expect(page.frameLocator('[data-html-preview-panel] > iframe').frameLocator('iframe').getByRole('heading')).toHaveText('第二张页面')
})

for (const finalReply of [fenced('const n: number = 1\n', 'ts'), '终态只保留普通文本']) {
  test(`已打开的 HTML 被终态替换为${finalReply.startsWith('```') ? ' TS 片段' : '普通文本'}时，移除旧预览`, async ({ page }) => {
    const identity = { conversationId: CONVERSATION_ID, assistantMessageId: 'assistant-live' }
    await installApiRoutes(page, () => [])
    await installBrowserStubs(page, {
      lines: [
        JSON.stringify({ ...identity, type: 'start', userMessageId: 'user-live' }),
        JSON.stringify({ ...identity, type: 'delta', contentDelta: fenced(html) }),
        JSON.stringify({ ...identity, type: 'done', content: finalReply, generatedAt: '2026-10-01T00:00:00.000Z' }),
      ],
      holdBeforeIndex: 2,
    })
    await page.goto('/workspace')
    await page.getByRole('textbox').first().fill('生成页面')
    await page.getByRole('button', { name: '发送消息' }).click()
    await page.locator('.agent-code-card').getByRole('button', { name: '预览', exact: true }).click()
    await expect(page.locator('[data-html-preview-panel]')).toBeVisible()
    await page.evaluate(() => window.__releaseStream?.())
    if (finalReply.startsWith('```'))
      await expect(page.locator('.agent-code-card code')).toHaveText('const n: number = 1')
    else
      await expect(page.locator('.agent-code-card')).toHaveCount(0)
    await expect(page.locator('.agent-code-card').getByRole('button', { name: '预览', exact: true })).toHaveCount(0)
    await expect(page.locator('[data-html-preview-panel]')).toHaveCount(0)
  })
}

test('拖动中进入窄屏再恢复，预览不会残留不可点击状态', async ({ page }) => {
  await openReply(page, fenced(html))
  await page.locator('.agent-code-card').getByRole('button', { name: '预览', exact: true }).click()
  const handle = page.getByRole('separator', { name: '调整聊天与预览宽度' })
  const box = (await handle.boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + 20, box.y + box.height / 2, { steps: 4 })
  await page.setViewportSize({ width: 320, height: 720 })
  await expect(handle).toBeHidden()
  await page.mouse.move(160, 360)
  await page.mouse.up()
  await page.setViewportSize({ width: 1280, height: 720 })
  await expect(handle).toBeVisible()
  const panel = page.locator('[data-html-preview-panel]')
  await expect(panel).toHaveCSS('pointer-events', 'auto')
  await panel.getByRole('button', { name: '关闭预览' }).click({ timeout: 3000 })
  await expect(panel).toHaveCount(0)
})
