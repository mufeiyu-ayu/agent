import type { ConversationMessage } from '@agent/contracts'
import type { Page } from '@playwright/test'

import { fileURLToPath, URL } from 'node:url'
import { expect, test } from '@playwright/test'

import {
  ANSWERED_GROUNDING,
  CONFLICTING_GROUNDING,
  createAssistantMessage,
  createCitation,
  createUserMessage,
  installApiRoutes,
  installBrowserStubs,
  toNdjsonLines,
  toTerminalNdjsonLines,
  UNAVAILABLE_GROUNDING,
} from './fixtures'

/** 截图落到本 Task 专属 docs asset 目录，作为可核验的浏览器证据。 */
const SCREENSHOT_DIR = fileURLToPath(
  new URL('../../../docs/tasks/phase-08-grounded-retrieval/assets/task-03b/', import.meta.url),
)

const GROUNDING = '[data-agent-grounding]'
const STATUS = '[data-agent-grounding-status]'
const NOTE = '[data-agent-grounding-note]'
const TOGGLE = '[data-agent-grounding-toggle]'
const SOURCES = '[data-agent-grounding-sources]'

async function openWorkspace(page: Page) {
  await page.goto('/workspace')
  await expect(page.getByRole('textbox').first()).toBeVisible()
}

async function sendMessage(page: Page, text = '帮我看看这个落地页的标题结构') {
  await page.getByRole('textbox').first().fill(text)
  await page.getByRole('button', { name: '发送消息' }).click()
}

test.describe('已完成回答的来源展示', () => {
  test('AC-01 / AC-02 / AC-09 / AC-10：streaming 不显示候选，完成后按 contract 顺序展示可访问的来源', async ({ page }) => {
    let messages: ConversationMessage[] = []

    await installApiRoutes(page, () => messages)
    await installBrowserStubs(page, {
      lines: toNdjsonLines(ANSWERED_GROUNDING),
      holdBeforeIndex: 3,
    })
    await openWorkspace(page)
    await sendMessage(page)

    // AC-02：delta 已经渲染，但 done 尚未到达，此时不得出现任何来源信息。
    await expect(page.getByText('再检查内链锚文本。')).toBeVisible()
    await expect(page.locator(GROUNDING)).toHaveCount(0)

    await page.evaluate(() => window.__releaseStream?.())

    // AC-01：终态出现来源状态说明，来源列表默认收起。
    await expect(page.locator(GROUNDING)).toHaveCount(1)
    await expect(page.locator(STATUS)).toHaveText('这条回答引用了检索到的资料。')
    await expect(page.locator(NOTE)).toHaveCount(0)
    await expect(page.locator(TOGGLE)).toHaveText(/引用来源（2）/)
    await expect(page.locator(SOURCES)).toBeHidden()

    // AC-10：disclosure 具备 aria 语义并且可以纯键盘操作。
    const toggle = page.locator(TOGGLE)

    await expect(toggle).toHaveAttribute('aria-expanded', 'false')

    const controlledId = await toggle.getAttribute('aria-controls')

    expect(controlledId).toBeTruthy()
    await expect(page.locator(`#${controlledId}`)).toHaveCount(1)

    await toggle.focus()
    await expect(toggle).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(toggle).toHaveAttribute('aria-expanded', 'true')
    await expect(page.locator(SOURCES)).toBeVisible()

    await page.keyboard.press('Space')
    await expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await expect(page.locator(SOURCES)).toBeHidden()

    await page.keyboard.press('Enter')
    await expect(page.locator(SOURCES)).toBeVisible()

    // AC-01：UI 编号与卡片顺序严格跟随 contract 数组顺序。
    const cards = page.locator(`${SOURCES} > li`)

    await expect(cards).toHaveCount(2)
    await expect(cards.nth(0)).toContainText('1')
    await expect(cards.nth(0)).toContainText('落地页 SEO 结构指南')
    await expect(cards.nth(0)).toContainText('文章片段')
    await expect(cards.nth(0)).toContainText('H1 应当唯一')
    await expect(cards.nth(1)).toContainText('2')
    await expect(cards.nth(1)).toContainText('Keyword Intent Mapping')
    await expect(cards.nth(1)).toContainText('整篇文章')

    // AC-01：不暴露 sourceId / chunkId / slug / rank / strategy。
    const sourcesText = await page.locator(SOURCES).textContent() ?? ''

    for (const leak of ['301', '302', 'article-301-chunk-0', 'landing-page-seo', 'hybrid_rrf']) {
      expect(sourcesText).not.toContain(leak)
    }

    // AC-09：v1 的 href 为 null，卡片必须是非交互元素。
    await expect(page.locator(`${SOURCES} a, ${SOURCES} button, ${SOURCES} [role="link"]`)).toHaveCount(0)

    await page.locator(GROUNDING).screenshot({
      path: `${SCREENSHOT_DIR}desktop-answered-sources.png`,
    })

    // AC-12：复制动作只写入回答正文，不混入任何来源元数据。
    await page.getByRole('button', { name: '复制' }).click()

    const copiedText = await page.evaluate(() => window.__copiedText)

    expect(copiedText).toBe('先确认 H1 与 title 是否表达同一个意图，再检查内链锚文本。')
    expect(copiedText).not.toContain('落地页 SEO 结构指南')

    messages = []
  })

  test('AC-03：页面重载后来源 UI 与实时 done 完全一致', async ({ page }) => {
    let messages: ConversationMessage[] = []

    await installApiRoutes(page, () => messages)
    await installBrowserStubs(page, {
      lines: toNdjsonLines(ANSWERED_GROUNDING),
      holdBeforeIndex: -1,
    })
    await openWorkspace(page)
    await sendMessage(page)

    await expect(page.locator(GROUNDING)).toHaveCount(1)
    await page.locator(TOGGLE).click()
    await expect(page.locator(SOURCES)).toBeVisible()

    const realtimeStatus = await page.locator(STATUS).textContent() ?? ''
    const realtimeSources = await page.locator(SOURCES).textContent() ?? ''

    // 重载走 Messages API：同一份 durable 事实，经 Web 边界重新校验。
    messages = [
      createUserMessage('user-live', '帮我看看这个落地页的标题结构', '2026-08-16T08:59:00.000Z'),
      createAssistantMessage(
        'assistant-live',
        '先确认 H1 与 title 是否表达同一个意图，再检查内链锚文本。',
        '2026-08-16T09:00:00.000Z',
        ANSWERED_GROUNDING,
      ),
    ]

    await page.reload()
    await expect(page.locator(GROUNDING)).toHaveCount(1)
    await expect(page.locator(STATUS)).toHaveText(realtimeStatus)

    await page.locator(TOGGLE).click()
    await expect(page.locator(SOURCES)).toBeVisible()
    await expect(page.locator(`${SOURCES} > li`)).toHaveCount(2)
    expect(await page.locator(SOURCES).textContent() ?? '').toBe(realtimeSources)
  })
})

test.describe('非成功状态与布局', () => {
  test('AC-05：检索不可用时使用独立文案，且没有来源列表', async ({ page }) => {
    const messages = [
      createUserMessage('user-1', '这个页面的核心关键词是什么？', '2026-08-16T08:00:00.000Z'),
      createAssistantMessage(
        'assistant-1',
        '暂时无法给出结论。',
        '2026-08-16T08:00:01.000Z',
        UNAVAILABLE_GROUNDING,
      ),
    ]

    await installApiRoutes(page, () => messages)
    await installBrowserStubs(page, { lines: [], holdBeforeIndex: -1 })
    await openWorkspace(page)

    await expect(page.locator(STATUS)).toHaveText('本次检索能力暂时不可用，没有取到任何资料。')
    await expect(page.locator(TOGGLE)).toHaveCount(0)
    await expect(page.locator(SOURCES)).toHaveCount(0)

    await page.locator(GROUNDING).screenshot({
      path: `${SCREENSHOT_DIR}desktop-insufficient-unavailable.png`,
    })
  })

  test('AC-05 / AC-11：冲突 + 部分证据链不可用在窄屏可读且不横向溢出', async ({ page }) => {
    const messages = [
      createUserMessage('user-1', '多语言落地页应该共用模板吗？', '2026-08-16T08:00:00.000Z'),
      createAssistantMessage(
        'assistant-1',
        '现有资料对这个问题给出了相反建议。',
        '2026-08-16T08:00:01.000Z',
        CONFLICTING_GROUNDING,
      ),
    ]

    await page.setViewportSize({ width: 320, height: 720 })
    await installApiRoutes(page, () => messages)
    await installBrowserStubs(page, { lines: [], holdBeforeIndex: -1 })
    await openWorkspace(page)

    await expect(page.locator(STATUS)).toHaveText('检索到的资料之间存在冲突，请自行核对下面的内容。')
    await expect(page.locator(NOTE)).toBeVisible()
    await expect(page.locator(TOGGLE)).toHaveText(/存在冲突的资料（2）/)

    await page.locator(TOGGLE).click()
    await expect(page.locator(`${SOURCES} > li`)).toHaveCount(2)

    const hasHorizontalOverflow = await page.evaluate(() => {
      const root = document.documentElement

      return root.scrollWidth > root.clientWidth
    })

    expect(hasHorizontalOverflow).toBe(false)

    const groundingOverflow = await page.locator(GROUNDING).evaluate((element) => {
      return element.scrollWidth > element.clientWidth
    })

    expect(groundingOverflow).toBe(false)

    await page.screenshot({
      path: `${SCREENSHOT_DIR}narrow-conflicting-partial.png`,
      fullPage: true,
    })
  })
})

test.describe('fail closed 与回归边界', () => {
  test('AC-04 / AC-07 / AC-08 / AC-09：legacy、malformed 与正文引用记号都不产生来源', async ({ page }) => {
    const messages = [
      createUserMessage('user-1', '普通问题', '2026-08-16T08:00:00.000Z'),
      // legacy：完全没有 Grounding 字段。
      {
        id: 'assistant-legacy',
        conversationId: 'conversation-1',
        role: 'ASSISTANT',
        content: '这是一条普通回答。',
        status: 'COMPLETED',
        createdAt: '2026-08-16T08:00:01.000Z',
        updatedAt: '2026-08-16T08:00:01.000Z',
      } as ConversationMessage,
      createUserMessage('user-2', '带引用记号的问题', '2026-08-16T08:00:02.000Z'),
      // 正文里有 [1]、Markdown 链接和 slug，但没有结构化 Grounding。
      createAssistantMessage(
        'assistant-inline',
        '参考 [1] 与 [2]，另见 [外部资料](https://evil.example/a) 和 landing-page-seo。',
        '2026-08-16T08:00:03.000Z',
      ),
      createUserMessage('user-3', '带损坏 Grounding 的问题', '2026-08-16T08:00:04.000Z'),
      // malformed：危险协议 href 让整份 Grounding 在公共 parser 阶段作废。
      createAssistantMessage(
        'assistant-malformed',
        '这条回答的来源数据已损坏，但正文仍然可读。',
        '2026-08-16T08:00:05.000Z',
        {
          ...ANSWERED_GROUNDING,
          citations: [createCitation({ href: 'javascript:alert(1)' })],
        },
      ),
    ]

    await installApiRoutes(page, () => messages)
    await installBrowserStubs(page, { lines: [], holdBeforeIndex: -1 })
    await openWorkspace(page)

    await expect(page.getByText('这是一条普通回答。')).toBeVisible()
    await expect(page.getByText('这条回答的来源数据已损坏，但正文仍然可读。')).toBeVisible()
    await expect(page.locator(GROUNDING)).toHaveCount(0)

    // AC-12：Markdown 链接仍然保留既有的安全属性。
    const externalLink = page.getByRole('link', { name: '外部资料' })

    await expect(externalLink).toHaveAttribute('rel', 'noreferrer noopener')
    await expect(externalLink).toHaveAttribute('target', '_blank')
  })

  test('AC-06：error 与 server aborted 都不展示 completed 来源', async ({ page }) => {
    for (const terminal of ['error', 'aborted'] as const) {
      const context = await page.context().browser()!.newContext()
      const terminalPage = await context.newPage()

      await installApiRoutes(terminalPage, () => [])
      await installBrowserStubs(terminalPage, {
        lines: toTerminalNdjsonLines(terminal),
        holdBeforeIndex: -1,
      })
      await openWorkspace(terminalPage)
      await sendMessage(terminalPage)

      // 错误文案同时出现在全局提示和会话内，这里只需确认终态已渲染。
      await expect(
        terminalPage.getByText(terminal === 'error' ? '模型服务暂时不可用' : '已停止生成').first(),
      ).toBeVisible()
      await expect(terminalPage.locator(GROUNDING)).toHaveCount(0)

      await context.close()
    }
  })

  test('AC-06：本地停止生成不会留下 completed 来源', async ({ page }) => {
    await installApiRoutes(page, () => [])
    await installBrowserStubs(page, {
      lines: toNdjsonLines(ANSWERED_GROUNDING),
      holdBeforeIndex: 3,
    })
    await openWorkspace(page)
    await sendMessage(page)

    await expect(page.getByText('再检查内链锚文本。')).toBeVisible()
    await page.getByRole('button', { name: '停止生成' }).click()

    await expect(page.getByText('已停止生成')).toBeVisible()
    await expect(page.locator(GROUNDING)).toHaveCount(0)
  })

  test('AC-12：en-US 下来源 UI 使用英文文案且不缺 key', async ({ page }) => {
    const messages = [
      createUserMessage('user-1', 'How should I structure this landing page?', '2026-08-16T08:00:00.000Z'),
      createAssistantMessage(
        'assistant-1',
        'Keep one H1 aligned with the page title.',
        '2026-08-16T08:00:01.000Z',
        ANSWERED_GROUNDING,
      ),
    ]

    await installApiRoutes(page, () => messages)
    await installBrowserStubs(page, { lines: [], holdBeforeIndex: -1 }, 'en-US')
    await openWorkspace(page)

    await expect(page.locator(STATUS)).toHaveText('This reply cites material found by retrieval.')
    await expect(page.locator(TOGGLE)).toHaveText(/Cited sources \(2\)/)

    await page.locator(TOGGLE).click()
    await expect(page.locator(SOURCES)).toContainText('Article section')
    await expect(page.locator(SOURCES)).toContainText('Full article')
  })
})
