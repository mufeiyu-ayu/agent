import type { AdminRunDetail } from '@agent/contracts'
import type { Page } from '@playwright/test'

import { expect, test } from '@playwright/test'

import {
  BACKGROUND_SUMMARY,
  createAnsweredDetail,
  createCompactionDetail,
  createModelVisibleContentDetail,
  HISTORY_SUMMARY,
  installRunDetail,
  RUN_ID,
  TURN_SUMMARY,
  UNTRUSTED_OBSERVATION,
} from './fixtures'

const INSPECTOR = '.run-trace-inspector'

async function openRunDetail(page: Page, detail: AdminRunDetail): Promise<void> {
  await installRunDetail(page, detail)
  await page.goto(`/runs/${RUN_ID}`)
  await expect(page.locator(INSPECTOR)).toBeVisible()
}

async function selectTimelineItem(page: Page, title: string): Promise<void> {
  await page.locator(`.trace-ledger strong:text-is("${title}")`).first().click()
}

/** Run Trace 不得把密钥、SQL 或服务端堆栈带进 DOM。 */
const FORBIDDEN_DOM_PATTERNS = [
  /select\s+\*\s+from/i,
  /authorization|api[_-]?key|bearer\s/i,
  /at\s+\w+\s+\(.*:\d+:\d+\)/,
] as const

async function expectNoForbiddenText(page: Page): Promise<void> {
  // 同时覆盖可见文本、title、data-* 与隐藏节点：整棵子树的 HTML 都要干净。
  const html = await page.locator('.run-trace-workspace').innerHTML()

  for (const pattern of FORBIDDEN_DOM_PATTERNS)
    expect(html).not.toMatch(pattern)
}

test.describe('Issue #152 Run Trace 展示模型可见内容', () => {
  test('AC-06：工具详情显示格式化参数与默认折叠的 observation，<script> 按原文显示且不执行', async ({ page }) => {
    await openRunDetail(page, createModelVisibleContentDetail())
    await selectTimelineItem(page, '工具执行')

    const inspector = page.locator(INSPECTOR)

    await expect(inspector.getByTestId('tool-arguments').locator('pre')).toHaveText(
      '{\n  "query": "SEO 指南",\n  "limit": 3\n}',
    )

    const observation = inspector.getByTestId('tool-observation')

    // 默认折叠：正文不可见，点开后逐字等于 observation 原文。
    await expect(observation.locator('pre')).toBeHidden()
    await observation.locator('summary').click()
    await expect(observation.locator('pre')).toBeVisible()
    expect(await observation.locator('pre').textContent()).toBe(UNTRUSTED_OBSERVATION)
    // 不可信内容没有变成 DOM 节点，脚本也没有执行。
    await expect(observation.locator('script, b')).toHaveCount(0)
    expect(await page.evaluate(() => (window as { __observationExecuted?: boolean }).__observationExecuted)).toBeUndefined()

    await page.screenshot({ path: 'e2e/.artifacts/issue-152-tool-observation.png', fullPage: true })

    // 切到同轮第二个工具：组件实例被复用，但 observation 仍按默认折叠。
    await page.locator('.trace-ledger strong:text-is("工具执行")').nth(1).click()
    await expect(observation.locator('summary')).toBeVisible()
    await expect(observation.locator('pre')).toBeHidden()
    await observation.locator('summary').click()
    await expect(observation.locator('pre')).toHaveText('第二个工具的结果')
  })

  test('AC-06：采样详情显示中间文本、本轮历史与默认折叠的 reasoning', async ({ page }) => {
    await openRunDetail(page, createModelVisibleContentDetail())
    await selectTimelineItem(page, '模型采样')

    const inspector = page.locator(INSPECTOR)

    await expect(inspector.getByTestId('sampling-intermediate-text')).toContainText('先查一下站内文章。')
    await expect(inspector.locator('dt:text-is("本轮历史") + dd')).toHaveText('选入 2 条 / 候选 3 条')

    const reasoning = inspector.getByTestId('sampling-reasoning')

    await expect(reasoning.locator('pre')).toBeHidden()
    await reasoning.locator('summary').click()
    await expect(reasoning.locator('pre')).toHaveText('用户在问 SEO 指南，应先检索。')

    await selectTimelineItem(page, '加载会话历史')
    await expect(inspector.locator('dt:text-is("读到的历史条数") + dd')).toHaveText('3')
  })

  test('AC-06：旧 Run 没有内容事实时显示「未记录」，页面不报错', async ({ page }) => {
    const errors: string[] = []

    page.on('pageerror', error => errors.push(error.message))
    await openRunDetail(page, createAnsweredDetail())
    await selectTimelineItem(page, '工具执行')

    const inspector = page.locator(INSPECTOR)

    await expect(inspector.getByTestId('tool-arguments').locator('pre')).toHaveText('未记录')
    await inspector.getByTestId('tool-observation').locator('summary').click()
    await expect(inspector.getByTestId('tool-observation').locator('pre')).toHaveText('未记录')

    await selectTimelineItem(page, '模型采样')
    await expect(inspector.getByTestId('sampling-intermediate-text')).toHaveCount(0)
    await expect(inspector.getByTestId('sampling-reasoning')).toHaveCount(0)
    await expect(inspector.locator('dt:text-is("本轮历史") + dd')).toHaveText('选入 未记录 / 候选 2 条')
    // #220 之前的 Run：没有基于任何压缩。
    await page.getByRole('tab', { name: '上下文' }).click()
    await expect(inspector.locator('dt:text-is("基于的历史摘要") + dd')).toHaveText('—')
    await expect(inspector.getByTestId('sampling-history-summary')).toHaveCount(0)
    expect(errors).toEqual([])
  })
})

test.describe('Issue #220 上下文压缩', () => {
  test('AC-12：轨迹里能看到上下文压缩与摘要全文，失败的写明原因；请求详情显示基于的压缩；运行详情列出后台压缩', async ({ page }) => {
    const errors: string[] = []

    page.on('pageerror', error => errors.push(error.message))
    await openRunDetail(page, createCompactionDetail())

    const inspector = page.locator(INSPECTOR)
    const compactions = page.locator('.trace-ledger strong:text-is("上下文压缩")')

    await expect(compactions).toHaveCount(3)

    // 历史压缩：摘要全文在压缩记录里，默认折叠。
    await compactions.nth(0).click()
    await expect(inspector.locator('dt:text-is("压缩层") + dd')).toHaveText('历史')
    await expect(inspector.locator('dt:text-is("压缩记录 ID") + dd')).toHaveText('compaction-1')
    const historySummary = inspector.getByTestId('compaction-summary')

    await expect(historySummary.locator('pre')).toBeHidden()
    await historySummary.locator('summary').click()
    expect(await historySummary.locator('pre').textContent()).toBe(HISTORY_SUMMARY)
    await page.screenshot({ path: 'e2e/.artifacts/issue-220-compaction-step.png', fullPage: true })

    // 本轮压缩失败：写明原因，没有摘要。
    await compactions.nth(1).click()
    await expect(inspector.locator('dt:text-is("压缩层") + dd')).toHaveText('本轮')
    await expect(inspector.locator('dt:text-is("失败原因") + dd')).toHaveText('写摘要失败：模型输出达到长度限制')
    await expect(inspector.getByTestId('compaction-summary')).toHaveCount(0)

    // 本轮压缩成功：前缀摘要在 Step 上。
    await compactions.nth(2).click()
    await expect(inspector.locator('dt:text-is("保留起点") + dd')).toHaveText('run-e2e-1:sampling-1')
    await inspector.getByTestId('compaction-summary').locator('summary').click()
    expect(await inspector.getByTestId('compaction-summary').locator('pre').textContent()).toBe(TURN_SUMMARY)

    // 第 2 次调模型：基于的历史摘要与本轮摘要。
    await page.locator('.trace-ledger strong:text-is("模型采样")').nth(1).click()
    await expect(inspector.locator('dt:text-is("本轮历史") + dd')).toHaveText('未被覆盖部分 2 条')
    await page.getByRole('tab', { name: '上下文' }).click()
    await expect(inspector.locator('dt:text-is("基于的历史摘要") + dd')).toHaveText(/^调模型前超线 · 覆盖 3 组 · /)
    await expect(inspector.locator('dt:text-is("基于的本轮摘要") + dd')).toHaveText('#6')
    await inspector.getByTestId('sampling-turn-summary').locator('summary').click()
    expect(await inspector.getByTestId('sampling-turn-summary').locator('pre').textContent()).toBe(TURN_SUMMARY)

    // 后台压缩不是 Step：单独一个页签，只列问答结束后预压的那条。
    await page.getByRole('tab', { name: '后台压缩（1）' }).click()
    const background = page.locator('.compaction-list .message-card')

    await expect(background).toHaveCount(1)
    await expect(background).toContainText('问答结束后预压 · 覆盖 5 组 · 压缩前 220K Token')
    await background.locator('summary').click()
    expect(await background.locator('pre').textContent()).toBe(BACKGROUND_SUMMARY)
    await page.screenshot({ path: 'e2e/.artifacts/issue-220-background-compaction.png', fullPage: true })
    expect(errors).toEqual([])
  })

  test('AC-12：没有后台压缩的 Run 不显示后台压缩页签', async ({ page }) => {
    await openRunDetail(page, createAnsweredDetail())
    await expect(page.getByRole('tab', { name: /后台压缩/ })).toHaveCount(0)
  })
})

test('Issue #94：Header 与 Sampling 展示 reasoning / cache Usage', async ({ page }) => {
  await openRunDetail(page, createAnsweredDetail())

  const detailsButton = page.locator('.trace-header').getByRole('button', { name: '详情' })
  const details = page.locator('.trace-header__details')

  await detailsButton.click()
  await expect(details).toContainText('推理 Token')
  await expect(details).toContainText('缓存命中 Token')
  await expect(details).toContainText('缓存未命中 Token')
  // 不先关弹层，接着点时间线和检查器标签：弹层向左展开、两列排布，淡出途中也不压在标签栏上。
  // 改回原来的 bottomRight 单列时，这里点「用量」会落在弹层上，下面的断言失败。
  await selectTimelineItem(page, '模型采样')
  await page.getByRole('tab', { name: '用量' }).click()
  await expect(page.locator(INSPECTOR)).toContainText('推理 Token')
  await expect(page.locator(INSPECTOR)).toContainText('缓存命中 Token')
  await expect(page.locator(INSPECTOR)).toContainText('缓存未命中 Token')
  await expectNoForbiddenText(page)
})
