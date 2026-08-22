import type { ConversationMessage } from '@agent/contracts'
import { expect, test } from '@playwright/test'

import {
  installApiRoutes,
  installBrowserStubs,
  toNdjsonLines,
} from './fixtures'

test('AC-01 / AC-11：默认 High，三档可选且 320px 下随本次请求发送', async ({ page }) => {
  await installApiRoutes(page, () => [] as ConversationMessage[])
  await installBrowserStubs(page, {
    lines: toNdjsonLines(),
    holdBeforeIndex: -1,
  })
  await page.goto('/workspace')

  const modelMenuTrigger = page.getByRole('button', { name: '选择模型与思考强度' })

  await expect(modelMenuTrigger).toHaveText(/High/)
  await page.setViewportSize({ width: 320, height: 720 })
  await modelMenuTrigger.click()
  await page.getByRole('menuitem', { name: /思考强度/ }).click()
  await expect(page.getByRole('menuitem', { name: 'Low' })).toBeVisible()
  await expect(page.getByRole('menuitem', { name: 'High' })).toBeVisible()
  await expect(page.getByRole('menuitem', { name: 'Max' })).toBeVisible()
  await page.getByRole('menuitem', { name: 'Max' }).click()

  await page.getByRole('textbox').first().fill('测试思考强度')
  await page.getByRole('button', { name: '发送消息' }).click()
  await expect.poll(async () => await page.evaluate(() => window.__seoRequests?.length)).toBe(1)

  expect(await page.evaluate(() => window.__seoRequests?.[0])).toMatchObject({
    reasoningEffort: 'max',
  })

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)
  expect(overflow).toBe(false)
})
