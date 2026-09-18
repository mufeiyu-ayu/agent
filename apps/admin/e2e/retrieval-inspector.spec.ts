import type { AdminRunDetail } from '@agent/contracts'
import type { Page } from '@playwright/test'

import { fileURLToPath, URL } from 'node:url'
import { expect, test } from '@playwright/test'

import {
  createAnsweredDetail,
  createFailedDetail,
  createLongIdentifierDetail,
  createOrdinaryDetail,
  createRunningDetail,
  createUnknownResultDetail,
  createZeroHitDetail,
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
const CALLS = '[data-testid="retrieval-calls"]'
const CALL_STATUS = '[data-testid^="retrieval-call-status-"]'
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

/** 读取 Retrieval Overview 中某个字段的值单元格。 */
function readOverviewField(page: Page, label: string) {
  return page
    .locator(RETRIEVAL)
    .locator('dl')
    .first()
    .locator(`dt:text-is("${label}") + dd`)
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
  test('Issue #94：Header、Sampling 与 Finalization 展示 reasoning / cache Usage', async ({ page }) => {
    await openRunDetail(page, createAnsweredDetail())

    await page.locator('.trace-header').getByRole('button', { name: '详情' }).click()
    const details = page.locator('.trace-header__details')

    await expect(details).toContainText('推理 Token')
    await expect(details).toContainText('缓存命中 Token')
    await expect(details).toContainText('缓存未命中 Token')

    await page.getByText('模型采样').first().click()
    await page.getByRole('tab', { name: '用量' }).click()
    await expect(page.locator('.run-trace-inspector')).toContainText('推理 Token')
    await expect(page.locator('.run-trace-inspector')).toContainText('缓存命中 Token')
    await expect(page.locator('.run-trace-inspector')).toContainText('缓存未命中 Token')

    await page.getByText('校验回答引用').first().click()
    await page.getByRole('tab', { name: '用量' }).click()
    await expect(page.locator('.run-trace-inspector')).toContainText('推理 Token')
    await expectNoForbiddenText(page)
  })

  test('AC-01 / AC-02 / AC-10：COMPLETED answered 可切换并读到分层的检索事实', async ({ page }) => {
    await openRunDetail(page, createAnsweredDetail())

    // Event 是默认视图，既有 Inspector 行为不变。
    await expect(page.locator(RETRIEVAL)).toHaveCount(0)
    await expect(page.getByText('请求检查器')).toBeVisible()

    await switchToRetrieval(page)

    // candidate / evidence / cited 三层必须分别可读。
    const overview = page.locator(RETRIEVAL).locator('dl').first()

    await expect(overview).toContainText('候选数量')
    await expect(overview).toContainText('证据引用身份数')
    await expect(overview).toContainText('被引用来源数')
    await expect(overview).toContainText('可关联引用')
    await expect(readOverviewField(page, '可关联引用')).toHaveText('2 / 2')
    // summary 完整时引用身份数是精确去重计数，引用列表照常渲染。
    await expect(readOverviewField(page, '证据引用身份数')).toHaveText('3')
    await expect(page.locator(CALLS).locator('.retrieval-inspector__refs > li')).toHaveCount(3)

    // 工具身份按 stepId 从 timeline 的 tool step 取。
    await expect(page.locator(CALLS).locator('li').first()).toContainText(
      'retrieve_article_context',
    )
    await expect(page.locator(CITATIONS).locator('> li')).toHaveCount(2)
    await expect(page.locator(CITATIONS)).toContainText('整篇文章')

    await expectNoForbiddenText(page)
    await page.screenshot({
      path: `${SCREENSHOT_DIR}completed-answered-retrieval.png`,
      fullPage: true,
    })

    // 切回 Event 保持既有行为与选中态。
    await switchToEvent(page)
    await expect(page.getByText('请求检查器')).toBeVisible()
  })

  test('AC-05 / AC-12：切换不破坏既有 Timeline、搜索与折叠', async ({ page }) => {
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

    // grounded_finalization 是 typed Step，不落 Generic。
    await page.getByText('校验回答引用').first().click()
    await expect(page.getByText('引用校验检查器')).toBeVisible()
    await expect(page.getByText('通用', { exact: true })).toHaveCount(0)
  })
})

test.describe('状态矩阵', () => {
  test('AC-08 / AC-11：RUNNING 展示已发生调用且 citations 缺失', async ({ page }) => {
    await openRunDetail(page, createRunningDetail())
    await switchToRetrieval(page)

    await expect(page.locator(CALLS).locator('> li')).toHaveCount(1)
    await expect(page.locator('[data-testid="retrieval-no-citations"]')).toBeVisible()
    await expect(readOverviewField(page, '可关联引用')).toHaveText('未记录')

    await expectNoForbiddenText(page)
    await page.screenshot({
      path: `${SCREENSHOT_DIR}running-partial-retrieval.png`,
      fullPage: true,
    })
  })

  test('AC-06 / AC-07 / AC-08：FAILED 展示安全失败类别，不展示 stack 或原始 payload', async ({ page }) => {
    await openRunDetail(page, createFailedDetail())
    await switchToRetrieval(page)

    await expect(page.locator(RETRIEVAL)).toContainText('timeout')
    // 候选数量未记录：必须显示「未记录」，不能显示 0。
    await expect(readOverviewField(page, '候选数量')).toHaveText('未记录')
    // 明确失败的调用不向 Registry 提交引用：引用身份数是可确认的 0，与候选数量分开读。
    await expect(readOverviewField(page, '证据引用身份数')).toHaveText('0')
    await expect(page.locator(CALL_STATUS)).toHaveAttribute('data-tone', 'error')

    // finalization 的失败类别在 Event 视图的引用校验检查器里读。
    await switchToEvent(page)
    await page.getByText('校验回答引用').first().click()
    await expect(page.locator('.run-trace-inspector')).toContainText('sampling_incomplete')
    await expect(page.locator('.run-trace-inspector')).toContainText('stream_failed')
    await expect(page.locator('.run-trace-inspector')).toContainText('证据通道不可用')

    await expectNoForbiddenText(page)
    await page.screenshot({
      path: `${SCREENSHOT_DIR}failed-partial-retrieval.png`,
      fullPage: true,
    })
  })

  test('AC-08：zero-hit 显示确定的候选数量 0，与 Tool 不可用的未记录区分开', async ({ page }) => {
    await openRunDetail(page, createZeroHitDetail())
    await switchToRetrieval(page)

    // zero-hit 是「确定没有候选」，与「候选数量未记录」必须显示不同。
    await expect(readOverviewField(page, '候选数量')).toHaveText('0')
    await expect(readOverviewField(page, '证据引用身份数')).toHaveText('0')
    await expect(page.locator(RETRIEVAL)).toContainText('本次回答没有引用任何来源')
    await expect(page.locator(CALL_STATUS)).toHaveAttribute('data-tone', 'success')

    await switchToEvent(page)
    await page.getByText('校验回答引用').first().click()
    await expect(page.locator('.run-trace-inspector')).toContainText('没有命中证据')
    await expect(page.locator('.run-trace-inspector')).toContainText('证据不足')

    await expectNoForbiddenText(page)
    await page.screenshot({
      path: `${SCREENSHOT_DIR}zero-hit-retrieval.png`,
      fullPage: true,
    })
  })

  test('AC-08：Tool 结果未记录时状态标签为中性而不是成功色', async ({ page }) => {
    await openRunDetail(page, createUnknownResultDetail())
    await switchToRetrieval(page)

    const status = page.locator(CALL_STATUS)

    await expect(status).toHaveText('结果未记录')
    await expect(status).toHaveAttribute('data-tone', 'neutral')
    // 不得沿用成功色：既不是 ant-design 的 green Tag，也不显示成功文案。
    await expect(status).not.toHaveClass(/ant-tag-green/)
    await expect(status).not.toHaveText('成功')
    await expect(readOverviewField(page, '候选数量')).toHaveText('未记录')
    // 没有 summary 时引用数量同样未知：不能显示成确定的 0。
    await expect(readOverviewField(page, '证据引用身份数')).toHaveText('未记录')

    await expectNoForbiddenText(page)
    await page.screenshot({
      path: `${SCREENSHOT_DIR}unknown-call-result.png`,
      fullPage: true,
    })
  })

  test('AC-05：普通未检索 Run 显示中性的未进入检索链路文案', async ({ page }) => {
    await openRunDetail(page, createOrdinaryDetail())
    await switchToRetrieval(page)

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

    await expect(page.locator(CALLS)).toBeVisible()
    await expect(page.locator(CITATIONS)).toBeVisible()
    await expectNoInspectorOverflow(page)

    await expectNoForbiddenText(page)
    await page.screenshot({
      path: `${SCREENSHOT_DIR}narrow-320-retrieval.png`,
      fullPage: true,
    })
  })

  test('AC-11：单列断点下 Overview 与 Citation Ledger 无横向溢出', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 900 })
    await openRunDetail(page, createLongIdentifierDetail())
    await switchToRetrieval(page)

    // 容器查询在 ≤900px 时切成单列；Inspector 占满整行，长字段最容易溢出。
    const singleColumn = await page.evaluate(() => {
      const body = document.querySelector('.run-trace-workspace__body')
      return body ? getComputedStyle(body).gridTemplateColumns.split(' ').length : 0
    })

    expect(singleColumn).toBe(1)
    await expect(page.locator(CALLS)).toBeVisible()
    await expectNoInspectorOverflow(page)

    await page.screenshot({
      path: `${SCREENSHOT_DIR}single-column-retrieval.png`,
      fullPage: true,
    })
  })
})
