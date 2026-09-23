import type { AdminRunDetail } from '@agent/contracts'
import type { Page } from '@playwright/test'

import { expect, test } from '@playwright/test'

import {
  createAnsweredDetail,
  createModelVisibleContentDetail,
  installRunDetail,
  RUN_ID,
  UNTRUSTED_OBSERVATION,
} from './fixtures'

const INSPECTOR = '.run-trace-inspector'

async function openRunDetail(page: Page, detail: AdminRunDetail): Promise<void> {
  await installRunDetail(page, detail)
  await page.goto(`/runs/${RUN_ID}`)
  await expect(page.locator('[data-testid="inspector-view-switch"]')).toBeVisible()
}

async function selectTimelineItem(page: Page, title: string): Promise<void> {
  await page.locator(`.trace-ledger strong:text-is("${title}")`).first().click()
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

  test('AC-06：采样详情显示中间文本、本轮历史与默认折叠的 reasoning，finalization 显示三个标量，Retrieval 显示 query', async ({ page }) => {
    await openRunDetail(page, createModelVisibleContentDetail())
    await selectTimelineItem(page, '模型采样')

    const inspector = page.locator(INSPECTOR)

    await expect(inspector.getByTestId('sampling-intermediate-text')).toContainText('先查一下站内文章。')
    await expect(inspector.locator('dt:text-is("本轮历史") + dd')).toHaveText('选入 2 条 / 候选 3 条')

    const reasoning = inspector.getByTestId('sampling-reasoning')

    await expect(reasoning.locator('pre')).toBeHidden()
    await reasoning.locator('summary').click()
    await expect(reasoning.locator('pre')).toHaveText('用户在问 SEO 指南，应先检索。')

    await selectTimelineItem(page, '校验回答引用')
    await inspector.getByRole('tab', { name: '安全 I/O' }).click()
    await expect(inspector.locator('dt:text-is("Registry 已截断") + dd')).toHaveText('否')
    await expect(inspector.locator('dt:text-is("证据类工具调用") + dd')).toHaveText('1')
    await expect(inspector.locator('dt:text-is("证据类工具失败") + dd')).toHaveText('0')

    await page.locator('[data-testid="inspector-view-switch"]').getByText('检索', { exact: true }).click()
    await expect(page.locator('[data-testid="retrieval-calls"]')).toContainText('SEO 指南')

    await page.locator('[data-testid="inspector-view-switch"]').getByText('事件', { exact: true }).click()
    await selectTimelineItem(page, '加载会话历史')
    await expect(inspector.locator('dt:text-is("候选历史条数") + dd')).toHaveText('3')
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
    expect(errors).toEqual([])
  })
})
