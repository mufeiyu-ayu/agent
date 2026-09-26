import { expect, test } from '@playwright/test'

import { installApiRoutes } from './fixtures'

declare global {
  interface Window {
    __sameDocument?: boolean
  }
}

/** Issue #193：首页只守路由与交互这类不随文案变化的行为；视觉还原在验收时对原稿做像素比对，不留常驻测试。 */

test('首页 Start asking 经路由进入 /workspace，不整页刷新', async ({ page }) => {
  await installApiRoutes(page, () => [])
  await page.goto('/')
  await page.evaluate(() => {
    window.__sameDocument = true
  })

  await page.locator('.hero').getByRole('link', { name: 'Start asking' }).click()

  await expect(page).toHaveURL(/\/workspace$/)
  await expect(page.getByRole('textbox').first()).toBeVisible()
  expect(await page.evaluate(() => window.__sameDocument)).toBe(true)
})

test('点击审计日志的一行，详情条切换到该行内容', async ({ page }) => {
  await page.goto('/')
  const detail = page.locator('#wfDetail')
  await expect(detail).toContainText('search-console · url_inspection')

  await page.locator('.wf-row', { hasText: 'Mask fields' }).click()

  await expect(detail).toContainText('Mask fields')
  await expect(detail).toContainText('Author emails removed before the model saw the data')
  await expect(page.locator('.wf-row.is-active')).toHaveCount(1)
  await expect(page.locator('.wf-row.is-active')).toContainText('Mask fields')
})

test('首页停留几秒再进入 /workspace，全程没有 console error', async ({ page }) => {
  const errors: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error')
      errors.push(message.text())
  })
  page.on('pageerror', error => errors.push(error.message))
  // 外网字体加载失败会打出资源类 console error，与首页代码无关：用空样式表桩掉
  await page.route(/fonts\.(googleapis|gstatic)\.com/, route => route.fulfill({ status: 200, contentType: 'text/css', body: '' }))
  await installApiRoutes(page, () => [])

  await page.goto('/')
  await expect(page.locator('#product')).toBeAttached()
  // 滚过各场景，让入场、打字、回放和演示窗口都跑起来
  for (const id of ['product', 'share', 'security', 'know', 'start']) {
    await page.evaluate(id => document.getElementById(id)!.scrollIntoView({ behavior: 'instant' }), id)
    await page.waitForTimeout(600)
  }
  await page.locator('#start').getByRole('link', { name: 'Start asking' }).click()
  await expect(page).toHaveURL(/\/workspace$/)
  await expect(page.getByRole('textbox').first()).toBeVisible()
  // 首页卸载后，残留的定时器或 rAF 若还在跑，会在这段时间里报错
  await page.waitForTimeout(2000)

  expect(errors).toEqual([])
})
