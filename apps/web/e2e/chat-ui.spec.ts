import type { Page } from '@playwright/test'
import type { ConversationTurn } from '../src/types/chat'

import { expect, test } from '@playwright/test'

import { installApiRoutes, installBrowserStubs, toNdjsonLines } from './fixtures'

declare global {
  interface Window {
    __chatUi: {
      turns: ConversationTurn[]
      anchorLatestTurn: boolean
      conversationId: string
      isLoadingMessages: boolean
      lastGeneratedAt: string
    }
    __renderCount: number
  }
}

const viewportSelector = '#chat-ui-test [data-agent-conversation-viewport]'
const longProse = '这是一段用于验证流式阅读位置保持不动的正文。\n\n'.repeat(100)
const longCode = Array.from({ length: 100 }, (_, i) => `  const value${i} = "${'x'.repeat(140)}";`).join('\n')

/** 复用运行中的 Vite 与真实组件，控制 props 而不连接后端或新增组件测试框架。 */
async function mountConversation(page: Page, reply: string, status: ConversationTurn['status'] = 'generating') {
  await installApiRoutes(page, () => [])
  await installBrowserStubs(page, { lines: [], holdBeforeIndex: -1 })
  await page.goto('/workspace')
  await expect(page.getByRole('textbox').first()).toBeVisible()
  await page.evaluate(async ({ reply, status }) => {
    const vuePath = '/node_modules/.vite/deps/vue.js'
    const componentPath = '/src/components/agent/AgentConversation.vue'
    const i18nPath = '/src/i18n/index.ts'
    const { createApp, h, reactive } = await import(vuePath)
    const { default: Conversation } = await import(componentPath)
    const { i18n } = await import(i18nPath)
    document.querySelector<HTMLElement>('#app')!.style.display = 'none'
    const root = document.createElement('div')
    root.id = 'chat-ui-test'
    root.style.cssText = 'height: 100dvh; display: flex; flex-direction: column; width: 100%;'
    document.body.append(root)
    window.__chatUi = reactive({
      turns: [
        { id: 'previous', userMessage: '上一轮', reply: '历史正文\n\n'.repeat(80), status: 'success', createdAt: '' },
        { id: 'current', userMessage: '新问题', reply, status, createdAt: '' },
      ],
      anchorLatestTurn: true,
      conversationId: 'ui-test',
      isLoadingMessages: false,
      lastGeneratedAt: '--:--',
    })
    createApp({ render: () => h(Conversation, window.__chatUi) }).use(i18n).mount(root)
  }, { reply, status })
  await expect(page.locator(viewportSelector)).toBeVisible()
  await expect.poll(() => page.locator(viewportSelector).evaluate(el => el.scrollTop)).toBeGreaterThan(0)
}

async function updateReply(page: Page, reply: string, status: ConversationTurn['status'] = 'generating') {
  await page.evaluate(({ reply, status }) => {
    Object.assign(window.__chatUi.turns[1], { reply, status })
  }, { reply, status })
}

async function bottomGap(page: Page) {
  return page.locator(viewportSelector).evaluate(el => el.scrollHeight - el.clientHeight - el.scrollTop)
}

test('代码卡片保持同一 DOM；闭合、终态未闭合、复制、键盘 Tooltip 与暗色样式', async ({ page }) => {
  await mountConversation(page, `\`\`\`js\n${longCode}`)
  const card = page.locator('#chat-ui-test .agent-code-card')
  await expect(card).toHaveCount(1)
  expect(await card.evaluate(el => el.getBoundingClientRect().height)).toBeLessThanOrEqual(380)
  await expect(card.getByRole('button', { name: '复制代码' })).toHaveCount(0)
  await expect(card.getByLabel('正在生成...')).toBeVisible()
  await card.evaluate(el => el.setAttribute('data-original', 'yes'))
  await updateReply(page, `\`\`\`js\n${longCode}\n\`\`\`\n还在继续回答`)
  await expect(card).toHaveAttribute('data-original', 'yes')
  await expect(card.getByRole('button', { name: '复制代码' })).toBeVisible()
  await expect(card.getByLabel('正在生成...')).toHaveCount(0)
  await expect(card.getByRole('button', { name: '预览（暂不可用）' })).toHaveAttribute('aria-disabled', 'true')

  const copy = card.getByRole('button', { name: '复制代码' })
  await copy.focus()
  await expect(page.getByRole('tooltip', { includeHidden: true })).toHaveText('复制代码')
  await expect(copy).toHaveAttribute('aria-describedby', /reka-tooltip-content/)
  await page.keyboard.press('Enter')
  await expect.poll(() => page.evaluate(() => window.__copiedText)).toBe(`${longCode}\n`)
  await expect(card.getByRole('button', { name: '已复制' })).toBeVisible()

  await updateReply(page, '```text\n  未闭合原文', 'success')
  await expect(card.getByLabel('正在生成...')).toHaveCount(0)
  await expect(card.locator('code')).toHaveText('  未闭合原文')
  await updateReply(page, '```text\n  中断', 'aborted')
  await expect(card.getByLabel('正在生成...')).toHaveCount(0)
  await expect(card.getByRole('button', { name: '复制代码' })).toBeVisible()
  await page.evaluate(async () => {
    const themePath = '/src/hooks/useWorkspaceTheme.ts'
    const { useWorkspaceTheme } = await import(themePath)
    useWorkspaceTheme().updateWorkspaceTheme('olive-ember')
  })
  await expect(card.locator('pre')).toHaveCSS('color', 'rgb(171, 178, 191)')
  await updateReply(page, '```js\nconst x = 1\n```', 'success')
  await expect(card.locator('.hljs-keyword')).toHaveCSS('color', 'rgb(198, 120, 221)')
})

test('定点阅读、内容增长后的胶囊、点击跟随、主动退出与窗口缩放', async ({ page }) => {
  await mountConversation(page, '开始')
  const viewport = page.locator(viewportSelector)
  await expect.poll(() => viewport.evaluate((el) => {
    const anchor = el.querySelector('[data-agent-user-turn-id="current"]')!
    return Math.abs(anchor.getBoundingClientRect().top - el.getBoundingClientRect().top - el.clientHeight * 0.24)
  })).toBeLessThan(2)
  const top = await viewport.evaluate(el => el.scrollTop)
  await updateReply(page, longProse)
  const capsule = page.locator('#chat-ui-test').getByRole('button', { name: '直达底部' })
  await expect(capsule).toBeVisible()
  expect(await viewport.evaluate(el => el.scrollTop)).toBeCloseTo(top, 0)
  await capsule.click()
  await expect.poll(() => bottomGap(page)).toBeLessThan(2)
  await updateReply(page, longProse.repeat(2))
  await expect.poll(() => bottomGap(page)).toBeLessThan(2)
  await viewport.hover()
  await page.mouse.wheel(0, -500)
  await expect(capsule).toBeVisible()
  await expect.poll(() => bottomGap(page)).toBeGreaterThan(300)
  const readingTop = await viewport.evaluate(el => el.scrollTop)
  await updateReply(page, `${longProse.repeat(2)}\n更多内容`)
  await expect(page.locator('#chat-ui-test .agent-markdown-prose').last()).toContainText('更多内容')
  expect(await viewport.evaluate(el => el.scrollTop)).toBeCloseTo(readingTop, 0)
  // 主动向下滚到末尾后恢复跟随。
  await page.mouse.wheel(0, 100_000)
  await expect.poll(() => bottomGap(page)).toBeLessThan(2)
  await updateReply(page, longProse.repeat(3))
  await expect.poll(() => bottomGap(page)).toBeLessThan(2)
  await page.setViewportSize({ width: 1000, height: 500 })
  await expect.poll(() => bottomGap(page)).toBeLessThan(2)
  await updateReply(page, longProse.repeat(3), 'success')
  await expect(capsule).toBeHidden()
})

test('代码内部滚动不改变外层跟随；320px 不横溢；减少动画偏好生效', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 720 })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await mountConversation(page, `\`\`\`js\n${longCode}`)
  const viewport = page.locator(viewportSelector)
  const code = page.locator('#chat-ui-test [data-agent-code-scroll]')
  const outerTop = await viewport.evaluate(el => el.scrollTop)
  await expect.poll(() => code.evaluate(el => el.scrollHeight - el.clientHeight - el.scrollTop)).toBeLessThan(2)
  await code.hover()
  await page.mouse.wheel(0, -100)
  await expect.poll(() => code.evaluate(el => el.scrollHeight - el.clientHeight - el.scrollTop)).toBeGreaterThan(32)
  const innerTop = await code.evaluate(el => el.scrollTop)
  await updateReply(page, `\`\`\`js\n${longCode}\n  // appended`)
  await expect(code).toContainText('// appended')
  expect(await code.evaluate(el => el.scrollTop)).toBeCloseTo(innerTop, 0)
  expect(await viewport.evaluate(el => el.scrollTop)).toBeCloseTo(outerTop, 0)
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320)
  await updateReply(page, `${longProse}\n\n\`\`\`js\n${longCode}`)
  const dot = page.locator('#chat-ui-test .dot-bounce').first()
  await expect(dot).toHaveCSS('animation-name', 'none')
})

test('高频纯文本和代码更新合并，终态立即补齐；复制失败不报成功', async ({ page }) => {
  await mountConversation(page, '```js\nlet x = 0')
  const code = page.locator('#chat-ui-test .agent-code-card code')
  await page.evaluate(async () => {
    const el = document.querySelector('#chat-ui-test .agent-code-card code')!
    window.__renderCount = 0
    const observer = new MutationObserver(() => window.__renderCount++)
    observer.observe(el, { childList: true, subtree: true, characterData: true })
    for (let i = 1; i <= 60; i++) {
      window.__chatUi.turns[1].reply = `\`\`\`js\nlet x = ${i}`
      await new Promise(resolve => setTimeout(resolve, 2))
    }
    observer.disconnect()
    window.__chatUi.turns[1].reply = '```js\nlet final = 999'
    window.__chatUi.turns[1].status = 'success'
  })
  expect(await page.evaluate(() => window.__renderCount)).toBeLessThan(20)
  await expect(code).toHaveText('let final = 999')
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined })
    document.execCommand = () => false
  })
  const copy = page.locator('#chat-ui-test').getByRole('button', { name: '复制代码' })
  await copy.click()
  await expect(copy).toHaveAttribute('aria-label', '复制代码')
  await expect(page.locator('textarea[readonly]')).toHaveCount(0)
  await page.evaluate(() => {
    document.execCommand = () => true
  })
  await copy.click()
  await expect(page.locator('#chat-ui-test .agent-code-card').getByRole('button', { name: '已复制' })).toBeVisible()

  await updateReply(page, '初始正文')
  await expect(page.locator('#chat-ui-test .agent-markdown-prose').last()).toHaveText('初始正文')
  await page.evaluate(async () => {
    const prose = [...document.querySelectorAll('#chat-ui-test .agent-markdown-prose')].at(-1)!
    window.__renderCount = 0
    const observer = new MutationObserver(() => window.__renderCount++)
    observer.observe(prose, { childList: true, subtree: true, characterData: true })
    for (let i = 0; i < 60; i++) {
      window.__chatUi.turns[1].reply = `初始正文${'追加'.repeat(i)}`
      await new Promise(resolve => setTimeout(resolve, 2))
    }
    observer.disconnect()
    window.__chatUi.turns[1].reply = '最终正文'
    window.__chatUi.turns[1].status = 'success'
  })
  expect(await page.evaluate(() => window.__renderCount)).toBeLessThan(20)
  await expect(page.locator('#chat-ui-test .agent-markdown-prose').last()).toHaveText('最终正文')
})

test('历史恢复滚动位置不被新轮定位覆盖', async ({ page }) => {
  await mountConversation(page, longProse, 'success')
  const viewport = page.locator(viewportSelector)
  await page.evaluate(() => {
    window.__chatUi.anchorLatestTurn = false
  })
  await expect.poll(() => bottomGap(page)).toBeLessThan(2)
  await viewport.evaluate(el => el.scrollTo({ top: 250, behavior: 'instant' }))
  await expect.poll(() => viewport.evaluate(el => el.scrollTop)).toBe(250)
  await page.evaluate(() => {
    window.__chatUi.conversationId = 'other'
  })
  await expect.poll(() => bottomGap(page)).toBeLessThan(2)
  await page.evaluate(() => {
    window.__chatUi.conversationId = 'ui-test'
  })
  await expect.poll(() => viewport.evaluate(el => el.scrollTop)).toBe(250)
})

for (const terminal of ['success', 'aborted', 'error'] as const) {
  test(`生成直接进入 ${terminal} 不重建卡片、不重置内部阅读位置`, async ({ page }) => {
    const reply = `\`\`\`js\n${longCode}`
    await mountConversation(page, reply)
    const card = page.locator('#chat-ui-test .agent-code-card')
    const code = card.locator('[data-agent-code-scroll]')
    await expect.poll(() => code.evaluate(el => el.scrollTop)).toBeGreaterThan(200)
    await code.hover()
    await page.mouse.wheel(0, -200)
    await expect.poll(() => code.evaluate(el => el.scrollHeight - el.clientHeight - el.scrollTop)).toBeGreaterThan(100)
    const position = await code.evaluate(el => el.scrollTop)
    await card.evaluate(el => el.setAttribute('data-original', 'yes'))
    await updateReply(page, reply, terminal)
    await expect(card.getByRole('button', { name: '复制代码' })).toBeVisible()
    await expect(card).toHaveAttribute('data-original', 'yes')
    expect(await code.evaluate(el => el.scrollTop)).toBeCloseTo(position, 0)
  })
}

test('返回生成中的会话：历史恢复不自动开启跟随，主动到底仍能恢复', async ({ page }) => {
  await mountConversation(page, longProse)
  const viewport = page.locator(viewportSelector)
  await page.evaluate(() => {
    window.__chatUi.anchorLatestTurn = false
    window.__chatUi.conversationId = 'other-live'
  })
  await expect.poll(() => bottomGap(page)).toBeLessThan(2)
  await page.evaluate(() => {
    window.__chatUi.conversationId = 'ui-test'
  })
  await expect(viewport).not.toHaveClass(/invisible/)
  const top = await viewport.evaluate(el => el.scrollTop)
  await updateReply(page, longProse.repeat(2))
  const capsule = page.locator('#chat-ui-test').getByRole('button', { name: '直达底部' })
  await expect(capsule).toBeVisible()
  expect(await viewport.evaluate(el => el.scrollTop)).toBeCloseTo(top, 0)
  await capsule.click()
  await expect.poll(() => bottomGap(page)).toBeLessThan(2)
  await updateReply(page, longProse.repeat(3))
  await expect(page.locator('#chat-ui-test .agent-markdown-prose').last()).toHaveText(longProse.repeat(3).trim())
  await expect.poll(() => bottomGap(page)).toBeLessThan(2)
})

test('真实 Workspace 发送链路与 Tooltip，流式未闭合卡片结束后可复制', async ({ page }) => {
  const [start] = toNdjsonLines()
  const content = '```ts\nconst x = 1'
  const identity = { conversationId: 'conversation-1', assistantMessageId: 'assistant-live' }
  await installApiRoutes(page, () => [])
  await installBrowserStubs(page, {
    lines: [start, JSON.stringify({ type: 'delta', ...identity, contentDelta: content }), JSON.stringify({ type: 'done', ...identity, content, generatedAt: '2026-09-21T00:00:00.000Z' })],
    holdBeforeIndex: 2,
  })
  await page.goto('/workspace')
  await page.getByRole('textbox').first().fill('生成代码')
  const send = page.getByRole('button', { name: '发送消息' })
  await send.hover()
  await expect(page.getByRole('tooltip', { includeHidden: true })).toHaveText('发送消息')
  await expect(send).not.toHaveAttribute('title')
  await send.click()
  await expect(page.locator('.agent-code-card')).toBeVisible()
  await expect(page.locator('.agent-code-card').getByLabel('正在生成...')).toBeVisible()
  await page.evaluate(() => window.__releaseStream?.())
  await expect(page.locator('.agent-code-card').getByRole('button', { name: '复制代码' })).toBeVisible()
  await page.locator('.agent-code-card').getByRole('button', { name: '复制代码' }).click()
  await expect.poll(() => page.evaluate(() => window.__copiedText)).toBe('const x = 1')
})
