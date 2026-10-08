import type { AdminConversationDetail, AdminConversationMessage, AdminRunListItem } from '@agent/contracts'
import type { Page, Route } from '@playwright/test'
import { expect, test } from '@playwright/test'
import { createAnsweredDetail, E2E_ADMIN } from './fixtures'

const DATE = '2026-10-07T00:00:00.000Z'
const PATH = '/conversations/conv-reading'
const MARKDOWN = `# 阅读标题

**结论：**后文

- 第一项
- 第二项

1. 第一步
2. 第二步

> 引用内容

[安全链接](https://example.com)

行内代码：\`const value = 1\`

\`\`\`ts
const longLine = '${'code'.repeat(150)}'
\`\`\`

| 字段 | ${Array.from({ length: 20 }, (_, i) => `列${i}`).join(' | ')} |
| --- | ${Array.from({ length: 20 }).fill('---').join(' | ')} |
| 内容 | ${Array.from({ length: 20 }).fill('表格内容不可遗漏').join(' | ')} |
`

function messages(count: number, content = '短消息'): AdminConversationMessage[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `message-${index + 1}`,
    role: index % 2 === 0 ? 'USER' : 'ASSISTANT',
    content: `${content}\n\n消息末尾-${index + 1}`,
    status: index === count - 1 ? 'ABORTED' : 'COMPLETED',
    createdAt: DATE,
  }))
}

function fulfill(route: Route, data: unknown) {
  return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data }) })
}

async function install(page: Page, transcript: AdminConversationMessage[]) {
  const runPages: number[] = []
  // 全部 API 请求隔离，不让新增页面请求意外落到真实后端。
  await page.route('**/api/**', (route) => {
    const url = new URL(route.request().url())
    if (url.pathname === '/api/auth/me')
      return fulfill(route, E2E_ADMIN)
    if (url.pathname === '/api/admin/conversations/conv-reading') {
      return fulfill(route, {
        id: 'conv-reading',
        title: '阅读回归',
        user: null,
        runCount: 21,
        createdAt: DATE,
        updatedAt: DATE,
        messages: transcript,
      } satisfies AdminConversationDetail)
    }
    if (url.pathname === '/api/admin/runs') {
      const current = Number(url.searchParams.get('page') ?? 1)
      runPages.push(current)
      const items: AdminRunListItem[] = Array.from({ length: current === 1 ? 20 : 1 }, (_, index) => ({
        id: `run-${(current - 1) * 20 + index + 1}`,
        conversationId: 'conv-reading',
        status: 'COMPLETED',
        errorCode: null,
        failureMessage: null,
        model: null,
        questionPreview: `运行问题-${(current - 1) * 20 + index + 1}`,
        samplingCount: 1,
        toolCallCount: 0,
        usage: { inputTokens: 10, outputTokens: 10, totalTokens: 20, reasoningTokens: null, promptCacheHitTokens: null, promptCacheMissTokens: null },
        durationMs: 100,
        startedAt: DATE,
        endedAt: DATE,
        createdAt: DATE,
      }))
      return fulfill(route, { items, pagination: { page: current, pageSize: 20, totalItems: 21, totalPages: 2 } })
    }
    if (url.pathname === '/api/admin/runs/run-21')
      return fulfill(route, { ...createAnsweredDetail(), id: 'run-21' })
    return route.abort()
  })
  return runPages
}

async function wheelToEnd(page: Page, lastNumber: number) {
  const transcript = page.locator('.transcript')
  await transcript.hover()
  // 轮询中的滚轮同时覆盖真实滚动事件和 IntersectionObserver 后续块挂载。
  await expect(async () => {
    await page.mouse.wheel(0, 100000)
    const last = transcript.locator('.transcript-message').last()
    await expect(last).toContainText(`消息末尾-${lastNumber}`)
    await expect(last.locator('footer')).toBeInViewport({ ratio: 1 })
  }).toPass({ timeout: 15000 })
}

async function assertSingleScroll(page: Page) {
  const metrics = await page.locator('.transcript').evaluate((element) => {
    const nestedScrollers: string[] = []
    let ancestor = element.parentElement
    while (ancestor) {
      const style = getComputedStyle(ancestor)
      if (/auto|scroll/.test(style.overflowY) && ancestor.scrollHeight > ancestor.clientHeight + 1)
        nestedScrollers.push(ancestor.className)
      ancestor = ancestor.parentElement
    }
    const articles = [...element.querySelectorAll('article')].map(item => item.getBoundingClientRect())
    return {
      height: element.clientHeight,
      scrollHeight: element.scrollHeight,
      top: element.scrollTop,
      nestedScrollers,
      // 壳层已有 8px 外边距折叠（空会话也存在），本任务不改全局布局。
      documentOverflow: document.documentElement.scrollHeight - innerHeight,
      shellGap: Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--admin-shell-gap')),
      mainOverflow: document.querySelector('.admin-main')!.scrollHeight - document.querySelector('.admin-main')!.clientHeight,
      horizontalOverflow: document.documentElement.scrollWidth - innerWidth,
      overlap: articles.some((rect, index) => index > 0 && rect.top < articles[index - 1].bottom),
      bottom: element.getBoundingClientRect().bottom,
    }
  })
  expect(metrics.scrollHeight).toBeGreaterThan(metrics.height)
  expect(metrics.top).toBeGreaterThan(0)
  expect(metrics.nestedScrollers).toEqual([])
  expect(metrics.mainOverflow).toBeLessThanOrEqual(1)
  expect(metrics.documentOverflow).toBeLessThanOrEqual(metrics.shellGap)
  expect(metrics.horizontalOverflow).toBeLessThanOrEqual(1)
  expect(metrics.overlap).toBe(false)
  expect(metrics.bottom).toBeLessThanOrEqual(page.viewportSize()!.height)
}

for (const viewport of [{ width: 1440, height: 900 }, { width: 1280, height: 720 }]) {
  test(`#245 AC-01 ${viewport.width}×${viewport.height} 长消息可通过滚轮到达末尾和状态，无重叠或双滚动`, async ({ page }) => {
    await page.setViewportSize(viewport)
    await install(page, messages(10, Array.from({ length: 60 }, (_, i) => `第${i + 1}行：这是超过五百字和一屏的长消息内容。`).join('\n')))
    await page.goto(PATH)
    await expect(page.locator('.transcript-message')).toHaveCount(10)
    await expect(page.locator('.transcript')).toHaveJSProperty('scrollTop', 0)
    await wheelToEnd(page, 10)
    await assertSingleScroll(page)
    await expect(page.locator('.transcript-message').last().locator('footer .run-status')).toHaveText('已中止')
  })
}

test('#245 AC-02 超过两块消息按序完整挂载，切换运行记录再返回仍可滚动', async ({ page }) => {
  await install(page, messages(65, '分块测试\n'.repeat(6)))
  await page.goto(PATH)
  await expect(page.locator('.transcript-message')).toHaveCount(30)
  await wheelToEnd(page, 65)
  await expect(page.locator('.transcript-message')).toHaveCount(65)
  const ends = await page.locator('.transcript-message__bubble').allTextContents()
  expect(ends.map(text => text.match(/消息末尾-\d+/)?.[0])).toEqual(Array.from({ length: 65 }, (_, i) => `消息末尾-${i + 1}`))
  await page.getByRole('tab', { name: '运行记录' }).click()
  await expect(page.locator('.ant-table-row')).toHaveCount(20)
  await page.getByRole('tab', { name: '对话内容' }).click()
  await page.locator('.transcript').evaluate(element => element.scrollTop = 0)
  await wheelToEnd(page, 65)
  await assertSingleScroll(page)
})

for (const theme of ['light', 'dark'] as const) {
  test(`#245 AC-03 ${theme} 助手语义 Markdown、用户原文、宽代码与表格局部滚动`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: theme })
    await install(page, messages(2, MARKDOWN))
    await page.goto(PATH)
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
    const assistant = page.locator('.is-assistant .conversation-markdown')
    for (const selector of ['h1', 'strong', 'ul > li', 'ol > li', 'blockquote', 'a', 'p > code', 'pre > code', 'table th', 'table td'])
      await expect(assistant.locator(selector).first()).toBeAttached()
    await expect(assistant.locator('strong')).toHaveText('结论：')
    expect(await assistant.locator('ul').evaluate(el => getComputedStyle(el).listStyleType)).toBe('disc')
    expect(await assistant.locator('ol').evaluate(el => getComputedStyle(el).listStyleType)).toBe('decimal')
    const user = page.locator('.is-user .transcript-message__bubble > p')
    expect(await user.textContent()).toBe(`${MARKDOWN}\n\n消息末尾-1`)
    await expect(user.locator('h1, strong, table, pre')).toHaveCount(0)
    expect(await user.evaluate(el => getComputedStyle(el).whiteSpace)).toBe('pre-wrap')
    for (const selector of ['pre', 'table']) {
      const overflow = await assistant.locator(selector).evaluate((el) => {
        el.scrollLeft = el.scrollWidth
        return { width: el.clientWidth, content: el.scrollWidth, left: el.scrollLeft, color: getComputedStyle(el).color }
      })
      expect(overflow.content).toBeGreaterThan(overflow.width)
      expect(overflow.left).toBeGreaterThan(0)
      expect(overflow.color).toBe(theme === 'light' ? 'rgb(29, 29, 31)' : 'rgb(245, 245, 247)')
    }
    await wheelToEnd(page, 2)
    await assertSingleScroll(page)
  })
}

test('#245 AC-04 不可信 HTML、危险链接与图片不执行或自动请求，空回复及中止状态可见', async ({ page }) => {
  const outbound: string[] = []
  const pageErrors: string[] = []
  page.on('pageerror', error => pageErrors.push(error.message))
  await page.route('https://leak.invalid/**', (route) => {
    outbound.push(route.request().url())
    return route.abort()
  })
  const content = '<script>window.__unsafe = true</script>\n<img src="https://leak.invalid/html" onerror="window.__unsafe = true">\n\n[危险](javascript:alert(1))\n\n[数据](data:text/html,test)\n\n![图片](https://leak.invalid/image)\n\n[安全](https://example.com)'
  await install(page, [
    { id: 'unsafe', role: 'ASSISTANT', status: 'COMPLETED', content, createdAt: DATE },
    { id: 'empty', role: 'ASSISTANT', status: 'ABORTED', content: '', createdAt: DATE },
  ])
  await page.goto(PATH)
  await expect(page.locator('.conversation-markdown')).toHaveCount(2)
  await expect(page.locator('.conversation-markdown script, .conversation-markdown img')).toHaveCount(0)
  // 原始 HTML 被转义后，其中的 https 地址也会按普通文本自动链接。
  await expect(page.locator('.conversation-markdown a')).toHaveCount(3)
  for (const link of await page.locator('.conversation-markdown a').all()) {
    await expect(link).toHaveAttribute('target', '_blank')
    await expect(link).toHaveAttribute('rel', /noopener/)
    await expect(link).toHaveAttribute('rel', /noreferrer/)
    await expect(link).toHaveAttribute('href', /^https:\/\//)
  }
  await expect(page.locator('.transcript-message').last().locator('.run-status')).toHaveText('已中止')
  expect(await page.evaluate(() => Object.hasOwn(window, '__unsafe'))).toBe(false)
  expect(outbound).toEqual([])
  expect(pageErrors).toEqual([])
})

test('#245 AC-05 空会话正常展示，运行分页可达且详情跳转不变', async ({ page }) => {
  const runPages = await install(page, [])
  await page.goto(PATH)
  await expect(page.locator('.transcript-empty')).toBeVisible()
  await page.getByRole('tab', { name: '运行记录' }).click()
  await expect(page.locator('.ant-table-row')).toHaveCount(20)
  const nextPage = page.locator('.ant-pagination-item-2')
  await nextPage.scrollIntoViewIfNeeded()
  await expect(nextPage).toBeInViewport({ ratio: 1 })
  await nextPage.click()
  await expect(page.locator('.ant-table-row')).toHaveCount(1)
  await expect(page.locator('.ant-table-row')).toContainText('运行问题-21')
  expect(runPages).toEqual([1, 2])
  await page.locator('.ant-table-row').click()
  await expect(page).toHaveURL(/\/runs\/run-21$/)
})

for (const status of [404, 500]) {
  test(`#245 AC-05 ${status} 加载失败可以重试恢复`, async ({ page }) => {
    await install(page, [])
    let failed = true
    await page.route('**/api/admin/conversations/conv-reading', (route) => {
      if (!failed)
        return route.fallback()
      return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify({ success: false, message: '读取失败' }) })
    })
    await page.goto(PATH)
    await expect(page.locator('.ant-result')).toBeVisible()
    await expect(page.locator('.ant-result-title')).toHaveText(status === 404 ? '未找到会话' : '无法加载会话')
    failed = false
    await page.getByRole('button', { name: /重\s*试/ }).click()
    await expect(page.locator('.transcript-empty')).toBeVisible()
  })
}
