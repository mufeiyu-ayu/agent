import type { Page } from '@playwright/test'
import type { ConversationTurn } from '../src/types/chat'

import { expect, test } from '@playwright/test'

import { CONVERSATION_ID, installApiRoutes, installBrowserStubs, toNdjsonLines } from './fixtures'

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
    __assistantContents: string[]
    __workspace: {
      message: { value: string }
      messages: { value: Array<{ id: string, role: string, content: string, status: string }> }
      sendMessage: (model?: string | null) => Promise<void>
    }
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

test('高频纯文本和代码更新合并，终态替换正文后对齐；复制失败不报成功', async ({ page }) => {
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
  await expect(page.locator('#chat-ui-test .agent-markdown-content').last()).toHaveText(longProse.repeat(3).trim())
  await expect.poll(() => bottomGap(page)).toBeLessThan(2)
})

test('局域网 HTTP 缺少 randomUUID 时仍能生成临时 ID 并完成发送', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await installApiRoutes(page, () => [])
  await installBrowserStubs(page, { lines: toNdjsonLines(), holdBeforeIndex: 0 })
  await page.addInitScript(() => {
    // 模拟局域网 HTTP：getRandomValues 可用，randomUUID 未暴露。
    Object.defineProperty(crypto, 'randomUUID', { configurable: true, value: undefined })
  })
  await page.goto('/workspace')
  expect(await page.evaluate(() => typeof crypto.randomUUID)).toBe('undefined')
  await page.getByRole('textbox').first().fill('局域网发送测试')
  await page.getByRole('button', { name: '发送消息' }).click()
  await expect.poll(() => page.evaluate(() => window.__chatRequests?.length)).toBe(1)
  await expect(page.locator('[data-agent-user-turn-id]').last()).toHaveAttribute('data-agent-user-turn-id', /^local-[0-9a-f]{32}$/)
  await page.evaluate(() => window.__releaseStream?.())
  await expect(page.locator('.agent-markdown-prose').last()).toContainText('再检查内链锚文本。')
  // 生成结束：停止按钮退场；输入框已清空，发送按钮要等有内容才出现。
  await expect(page.getByRole('button', { name: '停止生成' })).toHaveCount(0)
  await page.getByRole('textbox').first().fill('再来一条')
  await expect(page.getByRole('button', { name: '发送消息' })).toBeVisible()
  expect(errors).toEqual([])
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

const modelUnavailableResponse = {
  success: false,
  code: 400,
  message: '请求的模型未对前台开放',
  error: { statusCode: 400, error: 'Bad Request', details: [] },
}

test('#155：追加内容后立即收到终态，最终 DOM 与全文的一次性渲染一致', async ({ page }) => {
  await mountConversation(page, '第一段')
  const content = page.locator('#chat-ui-test .agent-markdown-content').last()
  await expect(content).toHaveText('第一段')
  const full = '第一段\n\n要点如下：\n- **甲**\n- 乙 *.ts\n\n| 列 | 值 |\n|---|---|\n| a | 1 |\n\n结论\n='
  await page.evaluate((full) => {
    Object.assign(window.__chatUi.turns[1], { reply: full, status: 'success' })
  }, full)
  await expect(content.locator('h1')).toHaveText('结论')
  const [rendered, expected] = await page.evaluate(async (full) => {
    const blocksPath = '/src/utils/markdown-blocks.ts'
    const { renderMarkdownBlocks } = await import(blocksPath)
    const normalize = (html: string) => {
      const template = document.createElement('template')
      template.innerHTML = html
      return template.innerHTML
    }
    const prose = [...document.querySelectorAll('#chat-ui-test .agent-markdown-content')].at(-1)!
    return [
      [...prose.querySelectorAll('.agent-markdown-prose')].map(el => el.innerHTML),
      renderMarkdownBlocks(full).blocks.map((block: { html: string }) => normalize(block.html)),
    ]
  }, full)
  expect(rendered).toEqual(expected)
})

test('#155 AC-04：正文里的 Markdown 图片渲染成链接，浏览器不请求图片地址', async ({ page }) => {
  const imageRequests: string[] = []
  page.on('request', request => request.url().includes('leak.png') && imageRequests.push(request.url()))
  const reply = '见图 ![x](http://127.0.0.1:9/leak.png) 后续'
  await mountConversation(page, reply)
  const content = page.locator('#chat-ui-test .agent-markdown-content').last()
  await expect(content.getByRole('link', { name: 'x' })).toHaveAttribute('href', 'http://127.0.0.1:9/leak.png')
  await updateReply(page, `${reply}\n\n![y](http://127.0.0.1:9/leak.png?q=secret)`, 'success')
  await expect(content.getByRole('link', { name: 'y' })).toHaveAttribute('rel', 'noreferrer noopener')
  await expect(content.locator('img')).toHaveCount(0)
  await page.waitForTimeout(300)
  expect(imageRequests).toEqual([])
})

test('#155 AC-06：localStorage 访问抛 SecurityError 时页面仍正常渲染', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await installApiRoutes(page, () => [])
  await page.addInitScript(() => {
    // dev 模式下 vue-router 打包的 devtools-kit 会在模块求值时直接读 localStorage（生产构建不含这段）；
    // 只给这种依赖包自己的访问一个内存桩，应用代码的访问照常抛错。
    const devtoolsStorage = new Map<string, string>()
    const memoryStorage = {
      getItem: (key: string) => devtoolsStorage.get(key) ?? null,
      setItem: (key: string, value: string) => void devtoolsStorage.set(key, value),
      removeItem: (key: string) => void devtoolsStorage.delete(key),
    }
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() {
        const caller = new Error('caller').stack?.split('\n')[2] ?? ''
        if (caller.includes('/node_modules/.vite/deps/'))
          return memoryStorage
        throw new DOMException('The operation is insecure.', 'SecurityError')
      },
    })
  })
  await page.goto('/workspace')
  await expect(page.getByRole('textbox').first()).toBeVisible()
  await page.getByRole('textbox').first().fill('存储不可用')
  await expect(page.getByRole('button', { name: '发送消息' })).toBeVisible()
  expect(errors).toEqual([])
})

test('#155 AC-07：发送因 400 失败后侧栏会话顺序不变', async ({ page }) => {
  const json = (data: unknown) => ({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, code: 0, message: 'ok', data }) })
  await installApiRoutes(page, () => [])
  await installBrowserStubs(page, { lines: [], holdBeforeIndex: -1 })
  await page.route('**/api/conversations?*', route => route.fulfill(json({
    items: [
      { id: 'conversation-newer', title: '较新的会话', createdAt: '2026-08-17T08:00:00.000Z', updatedAt: '2026-08-17T09:00:00.000Z' },
      { id: CONVERSATION_ID, title: '落地页 SEO 诊断', createdAt: '2026-08-16T08:00:00.000Z', updatedAt: '2026-08-16T09:00:00.000Z' },
    ],
    nextCursor: null,
  })))
  await page.route('**/api/conversations/conversation-newer/messages', route => route.fulfill(json([])))
  await page.addInitScript((body) => {
    const stubbedFetch = window.fetch
    window.fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (!url.includes('/api/chat/stream'))
        return stubbedFetch(input, init)
      return new Response(JSON.stringify(body), { status: 400, headers: { 'Content-Type': 'application/json' } })
    }
  }, modelUnavailableResponse)
  await page.goto('/workspace')

  const titles = page.getByText(/^(较新的会话|落地页 SEO 诊断)$/)
  await expect(titles).toHaveText(['较新的会话', '落地页 SEO 诊断'])
  await page.getByText('落地页 SEO 诊断').click()
  await page.getByRole('textbox').first().fill('这次会被拒绝')
  await page.getByRole('button', { name: '发送消息' }).click()
  await expect(page.getByRole('status').filter({ hasText: '请求的模型未对前台开放' })).toBeVisible()
  await expect(titles).toHaveText(['较新的会话', '落地页 SEO 诊断'])
})

async function failSendInOlderConversation(page: Page, userMessagePersisted: boolean) {
  const json = (data: unknown) => ({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, code: 0, message: 'ok', data }) })
  await installApiRoutes(page, () => [])
  await installBrowserStubs(page, {
    lines: [JSON.stringify({
      type: 'error',
      conversationId: CONVERSATION_ID,
      message: '上下文超出预算',
      ...(userMessagePersisted ? { userMessagePersisted: true } : {}),
    })],
    holdBeforeIndex: -1,
  })
  await page.route('**/api/conversations?*', route => route.fulfill(json({
    items: [
      { id: 'conversation-newer', title: '较新的会话', createdAt: '2026-08-17T08:00:00.000Z', updatedAt: '2026-08-17T09:00:00.000Z' },
      { id: CONVERSATION_ID, title: '落地页 SEO 诊断', createdAt: '2026-08-16T08:00:00.000Z', updatedAt: '2026-08-16T09:00:00.000Z' },
    ],
    nextCursor: null,
  })))
  await page.route('**/api/conversations/conversation-newer/messages', route => route.fulfill(json([])))
  await page.goto('/workspace')

  const titles = page.getByText(/^(较新的会话|落地页 SEO 诊断)$/)
  await expect(titles).toHaveText(['较新的会话', '落地页 SEO 诊断'])
  await page.getByText('落地页 SEO 诊断').click()
  await page.getByRole('textbox').first().fill('这次会失败')
  await page.getByRole('button', { name: '发送消息' }).click()
  await expect(page.getByRole('status').filter({ hasText: '上下文超出预算' })).toBeVisible()
  return titles
}

test('#169 AC-08：用户消息已落库后才失败的请求立即把会话移到侧栏顶部', async ({ page }) => {
  const titles = await failSendInOlderConversation(page, true)
  await expect(titles).toHaveText(['落地页 SEO 诊断', '较新的会话'])
})

test('#169 AC-08：用户消息落库前就失败（会话不存在等）不移动侧栏', async ({ page }) => {
  const titles = await failSendInOlderConversation(page, false)
  await expect(titles).toHaveText(['较新的会话', '落地页 SEO 诊断'])
})

test('#155：同一帧内到达的多个 delta 合并成一次消息写入，终态前全部写入', async ({ page }) => {
  const identity = { conversationId: CONVERSATION_ID, assistantMessageId: 'assistant-live' }
  const [start] = toNdjsonLines()
  const pieces = Array.from({ length: 30 }, (_, index) => `片段${index} `)
  const full = pieces.join('')
  await installApiRoutes(page, () => [])
  // 30 条 delta 拼进同一次推送：解析后在同一个任务里连续到达，中间不会有新的一帧。
  await installBrowserStubs(page, {
    lines: [
      start,
      pieces.map(contentDelta => JSON.stringify({ type: 'delta', ...identity, contentDelta })).join('\n'),
      JSON.stringify({ type: 'done', ...identity, content: full, generatedAt: '2026-09-23T00:00:00.000Z' }),
    ],
    holdBeforeIndex: 2,
  })
  await page.goto('/')
  await page.evaluate(async () => {
    const hookPath = '/src/hooks/useChatWorkspace.ts'
    const hookSource = await (await fetch(hookPath)).text()
    // 与 hook 用同一个 Vue 模块实例，watch 才能追踪到它的 ref。
    const vuePath = hookSource.match(/from "(\/node_modules\/\.vite\/deps\/vue\.js[^"]*)"/)![1]
    const i18nPath = '/src/i18n/index.ts'
    const { createApp, h, watch } = await import(vuePath)
    const { useChatWorkspace } = await import(hookPath)
    const { i18n } = await import(i18nPath)
    window.__assistantContents = []
    createApp({
      setup() {
        const workspace = useChatWorkspace()
        window.__workspace = workspace
        watch(workspace.messages, (messages: Array<{ id: string, content: string }>) => {
          const assistant = messages.find(item => item.id === 'assistant-live')
          if (assistant)
            window.__assistantContents.push(assistant.content)
        }, { flush: 'sync' })
        return () => h('div')
      },
    }).use(i18n).mount(document.createElement('div'))
  })
  await expect.poll(() => page.evaluate(() => window.__workspace.messages.value.length)).toBe(0)
  await page.evaluate(() => {
    window.__workspace.message.value = '合并测试'
    void window.__workspace.sendMessage('model-deepseek-v4-flash')
  })
  await expect.poll(() => page.evaluate(() => window.__workspace.messages.value.at(-1)?.content)).toBe(full)
  // 流式中间只写入了空占位与合并后的全文，没有逐个 delta 的中间态。
  expect(await page.evaluate(() => [...new Set(window.__assistantContents)])).toEqual(['', full])
  await page.evaluate(() => window.__releaseStream?.())
  await expect.poll(() => page.evaluate(() => window.__workspace.messages.value.map(item => `${item.role}:${item.status}`))).toEqual(['USER:COMPLETED', 'ASSISTANT:COMPLETED'])
})

test('#176 AC-01：回答里的列表显示圆点与序号，嵌套层级用浏览器默认标记', async ({ page }) => {
  await mountConversation(page, '- 甲\n  - 甲1\n- 乙\n\n1. 一\n2. 二', 'success')
  const content = page.locator('#chat-ui-test .agent-markdown-content').last()
  await expect(content.locator('ul').first()).toHaveCSS('list-style-type', 'disc')
  await expect(content.locator('ul ul')).toHaveCSS('list-style-type', 'circle')
  await expect(content.locator('ol')).toHaveCSS('list-style-type', 'decimal')
  await expect(content.locator('li').first()).toHaveCSS('display', 'list-item')
})
