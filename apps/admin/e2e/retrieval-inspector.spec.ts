import type { AdminRunDetail } from '@agent/contracts'
import type { Page } from '@playwright/test'

import { fileURLToPath, URL } from 'node:url'
import { expect, test } from '@playwright/test'

import {
  createAnsweredDetail,
  createFailedDetail,
  createLongIdentifierDetail,
  createMalformedDetail,
  createOrdinaryDetail,
  createRunningDetail,
  FORBIDDEN_DOM_PATTERNS,
  installRunDetail,
  RUN_ID,
} from './fixtures'

/** 截图落到本 Task 专属 docs asset 目录，作为可核验的浏览器证据。 */
const SCREENSHOT_DIR = fileURLToPath(
  new URL('../../../docs/tasks/phase-08-grounded-retrieval/assets/task-03c/', import.meta.url),
)

const SWITCH = '[data-testid="inspector-view-switch"]'
const RETRIEVAL = '[data-testid="retrieval-inspector"]'
const AVAILABILITY = '[data-testid="retrieval-availability"]'
const CALLS = '[data-testid="retrieval-calls"]'
const CITATIONS = '[data-testid="retrieval-citations"]'

async function openRunDetail(page: Page, detail: AdminRunDetail): Promise<void> {
  await installRunDetail(page, detail)
  await page.goto(`/runs/${RUN_ID}`)
  await expect(page.locator(SWITCH)).toBeVisible()
}

async function switchToRetrieval(page: Page): Promise<void> {
  await page.locator(SWITCH).getByText('检索', { exact: true }).click()
  await expect(page.locator(RETRIEVAL)).toBeVisible()
}

async function switchToEvent(page: Page): Promise<void> {
  await page.locator(SWITCH).getByText('事件', { exact: true }).click()
  await expect(page.locator(RETRIEVAL)).toHaveCount(0)
}

async function expectNoForbiddenText(page: Page): Promise<void> {
  // 同时覆盖可见文本、title、data-* 与隐藏节点：整棵子树的 HTML 都要干净。
  const html = await page.locator('.run-trace-workspace').innerHTML()

  for (const pattern of FORBIDDEN_DOM_PATTERNS)
    expect(html).not.toMatch(pattern)
}

/**
 * Retrieval 视图不得溢出自己所在的列。
 *
 * Admin 控制台自身有全局 `min-width: 1024px`（既有设计，不属于本 Task 范围），
 * 因此这里检查的是「内容有没有冲出 Inspector 容器」，而不是文档级滚动条。
 */
async function expectNoInspectorOverflow(page: Page): Promise<void> {
  const result = await page.evaluate(() => {
    const root = document.querySelector('[data-testid="retrieval-inspector"]')

    if (!root)
      return { rootOverflow: -1, offenders: ['missing-root'] }

    const rootRight = root.getBoundingClientRect().right
    const offenders: string[] = []

    for (const element of root.querySelectorAll('*')) {
      const rect = element.getBoundingClientRect()

      if (rect.width > 0 && rect.right > rootRight + 1)
        offenders.push(`${element.tagName}.${String(element.className).slice(0, 40)}`)
    }

    return {
      rootOverflow: root.scrollWidth - root.clientWidth,
      offenders: offenders.slice(0, 5),
    }
  })

  expect(result.offenders).toEqual([])
  expect(result.rootOverflow).toBeLessThanOrEqual(1)
}

test.describe('Event / Retrieval 切换', () => {
  test('AC-01 / AC-02 / AC-10：COMPLETED answered 可切换并读到分层的检索审计', async ({ page }) => {
    await openRunDetail(page, createAnsweredDetail())

    // Event 是默认视图，既有 Inspector 行为不变。
    await expect(page.locator(RETRIEVAL)).toHaveCount(0)
    await expect(page.getByText('请求检查器')).toBeVisible()

    await switchToRetrieval(page)

    await expect(page.locator(AVAILABILITY)).toHaveText('审计完整')
    // candidate / evidence / cited 三层必须分别可读。
    const overview = page.locator(RETRIEVAL).locator('dl').first()

    await expect(overview).toContainText('候选数量')
    await expect(overview).toContainText('证据引用身份数')
    await expect(overview).toContainText('被引用来源数')
    await expect(overview).toContainText('可关联引用')

    await expect(page.locator(CALLS).locator('li').first()).toContainText(
      'retrieve_article_context@1',
    )
    await expect(page.locator(CITATIONS).locator('> li')).toHaveCount(2)
    await expect(page.locator(CITATIONS)).toContainText('可关联')
    await expect(page.locator(CITATIONS)).toContainText('文章片段')
    await expect(page.locator(CITATIONS)).toContainText('整篇文章')
    await expect(page.locator(RETRIEVAL)).toContainText('引用身份已校验')
    await expect(page.locator(RETRIEVAL)).toContainText('未做逐断言核验')

    await expectNoForbiddenText(page)
    await page.screenshot({
      path: `${SCREENSHOT_DIR}completed-answered-retrieval.png`,
      fullPage: true,
    })

    // 切回 Event 保持既有行为与选中态。
    await switchToEvent(page)
    await expect(page.getByText('请求检查器')).toBeVisible()
  })

  test('AC-05 / AC-12：切换不破坏既有 Timeline、搜索、折叠与 Safe Raw Data', async ({ page }) => {
    await openRunDetail(page, createAnsweredDetail())

    const ledger = page.locator('.run-trace-ledger, [aria-label="事件与内容台账"]').first()

    await expect(ledger).toBeVisible()
    await switchToRetrieval(page)
    // Retrieval 只替换右栏，左侧 Ledger 与工具栏保持可用。
    await expect(ledger).toBeVisible()
    await expect(page.getByRole('button', { name: '全部展开' })).toBeVisible()

    await switchToEvent(page)
    await page.getByRole('button', { name: '折叠请求', exact: true }).click()
    await expect(ledger).toBeVisible()

    // grounded_finalization 现在是 typed Step，不再落 Generic。
    await page.getByText('校验回答引用').first().click()
    await expect(page.getByText('引用校验检查器')).toBeVisible()
    await expect(page.getByText('通用', { exact: true })).toHaveCount(0)
  })
})

test.describe('状态矩阵', () => {
  test('AC-08 / AC-11：RUNNING 展示已发生调用且 finalization 缺失', async ({ page }) => {
    await openRunDetail(page, createRunningDetail())
    await switchToRetrieval(page)

    await expect(page.locator(AVAILABILITY)).toHaveText('审计不完整')
    await expect(page.locator(CALLS).locator('> li')).toHaveCount(1)
    await expect(page.locator('[data-testid="retrieval-no-finalization"]')).toBeVisible()
    await expect(page.locator('[data-testid="retrieval-no-citations"]')).toBeVisible()

    await expectNoForbiddenText(page)
    await page.screenshot({
      path: `${SCREENSHOT_DIR}running-partial-retrieval.png`,
      fullPage: true,
    })
  })

  test('AC-06 / AC-07 / AC-08：FAILED 展示安全失败类别，不展示 stack 或原始 payload', async ({ page }) => {
    await openRunDetail(page, createFailedDetail())
    await switchToRetrieval(page)

    await expect(page.locator(AVAILABILITY)).toHaveText('审计不完整')
    await expect(page.locator(RETRIEVAL)).toContainText('timeout')
    await expect(page.locator(RETRIEVAL)).toContainText('sampling_incomplete')
    await expect(page.locator(RETRIEVAL)).toContainText('stream_failed')
    await expect(page.locator(RETRIEVAL)).toContainText('证据通道不可用')

    await expectNoForbiddenText(page)
    await page.screenshot({
      path: `${SCREENSHOT_DIR}failed-partial-retrieval.png`,
      fullPage: true,
    })
  })

  test('AC-05：普通未检索 Run 显示中性 not_applicable 文案', async ({ page }) => {
    await openRunDetail(page, createOrdinaryDetail())
    await switchToRetrieval(page)

    await expect(page.locator(AVAILABILITY)).toHaveText('未进入检索链路')
    await expect(page.locator(RETRIEVAL)).toContainText(
      '本 Run 未进入 Grounding / Retrieval 链路',
    )
    // 不显示空骨架或技术错误。
    await expect(page.locator(CALLS)).toHaveCount(0)
    await expect(page.locator(RETRIEVAL)).not.toContainText('Error')

    await switchToEvent(page)
    await expect(page.getByText('请求检查器')).toBeVisible()

    await page.screenshot({
      path: `${SCREENSHOT_DIR}ordinary-not-applicable.png`,
      fullPage: true,
    })
  })

  test('AC-06：malformed 数据 fail closed，不显示原始 JSON', async ({ page }) => {
    await openRunDetail(page, createMalformedDetail())
    await switchToRetrieval(page)

    await expect(page.locator(AVAILABILITY)).toHaveText('审计不完整')
    await expect(page.locator(CALLS)).toContainText('元数据不可信')
    await expect(page.locator(RETRIEVAL)).toContainText('不可用')
    await expect(page.locator('[data-testid="retrieval-no-citations"]')).toBeVisible()
    // 不出现原始 JSON 结构。
    await expect(page.locator(RETRIEVAL)).not.toContainText('{"')

    await switchToEvent(page)
    await page.getByText('校验回答引用').first().click()
    await expect(page.getByText('通用检查器')).toBeVisible()

    await expectNoForbiddenText(page)
    await page.screenshot({
      path: `${SCREENSHOT_DIR}malformed-fail-closed.png`,
      fullPage: true,
    })
  })
})

test.describe('窄屏布局', () => {
  test('AC-11：320px 视口下超长 ID / 标题不冲出 Inspector 列', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 900 })
    await openRunDetail(page, createLongIdentifierDetail())
    await switchToRetrieval(page)

    // Admin 控制台既有的全局 min-width 是 1024px：文档级横向滚动是本 Task 之前
    // 就存在的设计约束，这里如实记录，不假装它不存在。
    const shell = await page.evaluate(() => ({
      viewportWidth: window.innerWidth,
      documentScrollWidth: document.documentElement.scrollWidth,
      bodyMinWidth: getComputedStyle(document.body).minWidth,
    }))

    expect(shell.viewportWidth).toBe(320)
    expect(shell.bodyMinWidth).toBe('1024px')
    expect(shell.documentScrollWidth).toBe(1024)

    await expect(page.locator(AVAILABILITY)).toBeVisible()
    await expect(page.locator(CALLS)).toBeVisible()
    await expect(page.locator(CITATIONS)).toBeVisible()
    await expectNoInspectorOverflow(page)

    await expectNoForbiddenText(page)
    await page.screenshot({
      path: `${SCREENSHOT_DIR}narrow-320-retrieval.png`,
      fullPage: true,
    })
  })

  test('AC-11：单列断点下 Overview、Finalization 与 Citation Ledger 无横向溢出', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 900 })
    await openRunDetail(page, createLongIdentifierDetail())
    await switchToRetrieval(page)

    // 容器查询在 ≤900px 时切成单列；Inspector 占满整行，长字段最容易溢出。
    const singleColumn = await page.evaluate(() => {
      const body = document.querySelector('.run-trace-workspace__body')
      return body ? getComputedStyle(body).gridTemplateColumns.split(' ').length : 0
    })

    expect(singleColumn).toBe(1)
    await expect(page.locator(AVAILABILITY)).toBeVisible()
    await expectNoInspectorOverflow(page)

    await page.screenshot({
      path: `${SCREENSHOT_DIR}single-column-retrieval.png`,
      fullPage: true,
    })
  })
})
