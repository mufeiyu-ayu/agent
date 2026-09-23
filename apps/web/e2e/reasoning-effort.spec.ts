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
  await expect(page.getByRole('menuitem', { name: '默认（High）' })).toBeVisible()
  await expect(page.getByRole('menuitem', { name: 'Low' })).toBeVisible()
  await expect(page.getByRole('menuitem', { name: 'High', exact: true })).toBeVisible()
  await expect(page.getByRole('menuitem', { name: 'Max' })).toBeVisible()
  await page.getByRole('menuitem', { name: 'Max' }).click()

  await page.getByRole('textbox').first().fill('测试思考强度')
  await page.getByRole('button', { name: '发送消息' }).click()
  await expect.poll(async () => await page.evaluate(() => window.__chatRequests?.length)).toBe(1)

  expect(await page.evaluate(() => window.__chatRequests?.[0])).toMatchObject({
    reasoningEffort: 'max',
  })

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)
  expect(overflow).toBe(false)
})

test('#155 AC-03：模型被拒后重新拉取并换到可用模型，下次发送带新模型；打开下拉也会刷新；首次发送不带强度', async ({ page }) => {
  await installApiRoutes(page, () => [] as ConversationMessage[])
  await installBrowserStubs(page, { lines: toNdjsonLines(), holdBeforeIndex: -1 })

  const hidden = { id: 'model-hidden', displayName: 'Hidden Model', reasoningEffort: 'high', reasoningEffortOptions: ['low', 'high', 'max'], isDefault: true }
  const fallback = { id: 'model-fallback', displayName: 'Fallback Model', reasoningEffort: null, reasoningEffortOptions: [], isDefault: false }
  let modelRequests = 0
  await page.route('**/api/llm/models', (route) => {
    modelRequests++
    // 首次加载时两条都可见；之后管理台把默认模型隐藏了。
    const data = modelRequests === 1 ? [hidden, fallback] : [{ ...fallback, isDefault: true }]
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, code: 0, message: 'ok', data }) })
  })
  // 第一次发送按后端真实形状返回 400（BadRequestException 不带 details），之后交给默认桩正常出流。
  await page.addInitScript(() => {
    const stubbedFetch = window.fetch
    let rejected = false
    window.fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (!url.includes('/api/chat/stream') || rejected)
        return stubbedFetch(input, init)
      rejected = true
      window.__chatRequests?.push(JSON.parse(String(init?.body)))
      return new Response(JSON.stringify({
        success: false,
        code: 400,
        message: '请求的模型未对前台开放',
        error: { statusCode: 400, error: 'Bad Request', details: [] },
      }), { status: 400, headers: { 'Content-Type': 'application/json' } })
    }
  })
  await page.goto('/workspace')

  const trigger = page.getByRole('button', { name: '选择模型与思考强度' })
  await expect(trigger).toHaveText(/Hidden Model\s*High/)
  await page.getByRole('textbox').first().fill('第一次发送')
  await page.getByRole('button', { name: '发送消息' }).click()

  await expect(page.getByRole('status').filter({ hasText: '所选模型已不可用，已切换为 Fallback Model' })).toBeVisible()
  await expect(trigger).toHaveText(/Fallback Model/)
  expect(modelRequests).toBe(2)
  // 首次发送只带模型，不把模型行的默认强度当显式值发送。
  const [firstRequest] = await page.evaluate(() => window.__chatRequests ?? [])
  expect(firstRequest).toMatchObject({ model: 'model-hidden' })
  expect(firstRequest).not.toHaveProperty('reasoningEffort')

  await page.getByRole('textbox').first().fill('第二次发送')
  // 前台对连续发送有 800ms 节流。
  await page.waitForTimeout(850)
  await page.getByRole('button', { name: '发送消息' }).click()
  await expect.poll(() => page.evaluate(() => window.__chatRequests?.length)).toBe(2)
  expect(await page.evaluate(() => window.__chatRequests?.[1])).toMatchObject({ model: 'model-fallback' })
  await expect(page.getByRole('status').filter({ hasText: '所选模型已不可用' })).toHaveCount(0)

  await trigger.click()
  await expect.poll(() => modelRequests).toBe(3)
})

test('#155：模型列表读取失败时在选择器旁给出提示', async ({ page }) => {
  await installApiRoutes(page, () => [] as ConversationMessage[])
  await installBrowserStubs(page, { lines: toNdjsonLines(), holdBeforeIndex: -1 })
  await page.route('**/api/llm/models', route => route.fulfill({ status: 500, contentType: 'application/json', body: '{}' }))
  await page.goto('/workspace')

  await expect(page.getByRole('status').filter({ hasText: '模型列表读取失败，请检查后台模型配置' })).toBeVisible()
})
