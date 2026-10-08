import type { AdminLlmModel, AdminLlmProvider, AdminRuntimeConfig } from '@agent/contracts'
import type { Page, Route } from '@playwright/test'

import { expect, test } from '@playwright/test'

import { E2E_ADMIN } from './fixtures'

function fulfill(route: Route, status: number, data: unknown, message = 'ok') {
  return route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(status < 400
      ? { success: true, code: 0, message, data }
      : { success: false, code: status, message, error: { statusCode: status, error: 'Bad Request' } }),
  })
}

const CONFIG: AdminRuntimeConfig = {
  runDeadlineMs: 600_000,
  compactionKeepRecentTokens: 20_000,
  debugCaptureModelIo: false,
  serperApiKeyLast4: null,
  updatedAt: '2026-09-29T00:00:00.000Z',
}

async function installRuntimeConfig(page: Page) {
  let current = { ...CONFIG }
  const patches: unknown[] = []

  await page.route('**/api/auth/me', route => fulfill(route, 200, E2E_ADMIN))
  await page.route('**/api/admin/runtime-config', async (route) => {
    if (route.request().method() === 'GET')
      return fulfill(route, 200, current)

    const body = route.request().postDataJSON() as Record<string, unknown> & { serperApiKey?: string }
    const { serperApiKey, ...rest } = body

    patches.push(body)
    // 保存中的 loading 要看得见：稍等再回。
    await new Promise(resolve => setTimeout(resolve, 300))
    current = { ...current, ...rest, ...(serperApiKey ? { serperApiKeyLast4: serperApiKey.slice(-4) } : {}) }
    return fulfill(route, 200, current)
  })

  return patches
}

test('运行配置：三组分区、四项配置，没改动时保存不可点，改完保存带 loading，成功后回到不可点并显示 Key 尾号', async ({ page }) => {
  const patches = await installRuntimeConfig(page)

  await page.goto('/runtime-config')
  await expect(page.getByRole('link', { name: '运行配置' })).toHaveAttribute('aria-current', 'page')
  for (const group of ['运行限制', '联网搜索', '调试'])
    await expect(page.getByRole('heading', { name: group })).toBeVisible()
  // #218 删掉了模型轮数、工具次数与历史条数三项上限；#220 加了压缩保留最近 Tokens。
  await expect(page.locator('.settings-row__label')).toHaveText(['单次最长时间', '压缩保留最近 Tokens', 'Serper API Key', '抓取模型原始请求'])

  const save = page.getByRole('button', { name: /保\s*存/ })
  await expect(save).toBeDisabled()
  await expect(page.getByLabel('单次最长时间')).toHaveValue('600')
  await expect(page.getByLabel('压缩保留最近 Tokens')).toHaveValue('20,000')
  await expect(page.getByLabel('Serper API Key')).toHaveAttribute('placeholder', '粘贴 Serper API Key')
  await expect(page.getByText('未配置')).toBeVisible()

  await page.getByLabel('单次最长时间').fill('120')
  await page.getByLabel('压缩保留最近 Tokens').fill('15000')
  await page.getByLabel('Serper API Key').fill('  sk-serper-9f3a  ')
  await page.getByLabel('抓取模型原始请求').click()
  await expect(save).toBeEnabled()

  // 同一事件循环内重复点击，覆盖 validate 尚未完成时的提交窗口。
  await save.evaluate((button) => {
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
  await expect(save).toHaveClass(/ant-btn-loading/)
  await expect(page.getByText('运行配置已保存，下一次问答生效')).toBeVisible()
  await expect(save).toBeDisabled()
  await expect(page.getByLabel('Serper API Key')).toHaveValue('')
  await expect(page.getByLabel('Serper API Key')).toHaveAttribute('placeholder', '尾号 9f3a，留空不改')
  await expect(page.getByText('已配置')).toBeVisible()
  await expect(page.getByLabel('压缩保留最近 Tokens')).toHaveValue('15,000')
  expect(patches).toEqual([{
    runDeadlineMs: 120_000,
    compactionKeepRecentTokens: 15_000,
    debugCaptureModelIo: true,
    serperApiKey: 'sk-serper-9f3a',
  }])
})

test('运行配置：超出范围时就地提示、不发请求；服务端拒绝时提示原因', async ({ page }) => {
  const patches = await installRuntimeConfig(page)

  await page.goto('/runtime-config')
  await page.getByLabel('单次最长时间').fill('0')
  await page.getByRole('button', { name: /保\s*存/ }).click()
  await expect(page.getByText('须为 1 到 2,147,483 之间的整数')).toBeVisible()
  await page.getByLabel('单次最长时间').fill('600')
  await page.getByLabel('压缩保留最近 Tokens').fill('999')
  await page.getByRole('button', { name: /保\s*存/ }).click()
  await expect(page.getByText('须为 1,000 到 200,000 之间的整数')).toBeVisible()
  expect(patches).toEqual([])
  await page.getByLabel('压缩保留最近 Tokens').fill('20000')

  // 与全局校验管道的真实响应同形：message 是通用文案，字段原因在 error.details。
  await page.unroute('**/api/admin/runtime-config')
  await page.route('**/api/admin/runtime-config', route => route.request().method() === 'GET'
    ? fulfill(route, 200, CONFIG)
    : route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({
          success: false,
          code: 400,
          message: '请求参数校验失败',
          error: { statusCode: 400, error: 'Bad Request', details: ['runDeadlineMs must not be less than 1'] },
        }),
      }))
  await page.getByLabel('单次最长时间').fill('500')
  await page.getByRole('button', { name: /保\s*存/ }).click()
  await expect(page.getByText('请求参数校验失败')).toBeVisible()
  await expect(page.getByRole('button', { name: /保\s*存/ })).toBeEnabled()
})

test('模型弹窗：三组分割线、单次输入上限带说明、token 千分位；超出窗口容量时显示服务端原因且弹窗不关', async ({ page }) => {
  const provider: AdminLlmProvider = {
    id: 'provider-1',
    family: 'deepseek',
    note: '官方',
    baseUrl: 'https://api.deepseek.com',
    apiKeyLast4: 'abcd',
    enabled: true,
    useProxy: false,
    modelCount: 1,
    createdAt: '2026-09-29T00:00:00.000Z',
    updatedAt: '2026-09-29T00:00:00.000Z',
  }
  const model: AdminLlmModel = {
    id: 'model-1',
    providerId: provider.id,
    wireName: 'deepseek-flash',
    displayName: 'DeepSeek Flash',
    contextWindowTokens: 1_000_000,
    maxInputTokens: 262_144,
    maxOutputTokens: 384_000,
    reasoningEffort: 'high',
    supportsImageInput: false,
    visible: true,
    isDefault: true,
    sortOrder: 0,
    lastProbeOk: true,
    lastProbeError: null,
    lastProbedAt: '2026-09-29T00:00:00.000Z',
    createdAt: '2026-09-29T00:00:00.000Z',
    updatedAt: '2026-09-29T00:00:00.000Z',
  }
  const patches: unknown[] = []
  let current = model

  await page.route('**/api/auth/me', route => fulfill(route, 200, E2E_ADMIN))
  await page.route('**/api/admin/llm/proxy', route => fulfill(route, 200, { configured: false, address: null }))
  await page.route('**/api/admin/llm/providers', route => fulfill(route, 200, [provider]))
  await page.route('**/api/admin/llm/models', route => fulfill(route, 200, [current]))
  await page.route('**/api/admin/llm/models/model-1', (route) => {
    const body = route.request().postDataJSON() as { maxInputTokens: number }
    patches.push(body)
    return body.maxInputTokens > 599_616
      ? fulfill(route, 400, null, '单次输入上限不能超过 上下文窗口 − 最大输出 − 安全余量 16,384 = 599,616，当前为 600,000')
      : fulfill(route, 200, current = { ...current, ...body })
  })

  await page.goto('/llm-models')
  const row = page.getByRole('row', { name: /DeepSeek Flash/ })
  await expect(row).toContainText('1,000,000/262,144/384,000')

  await row.getByRole('button', { name: 'edit' }).click()
  const dialog = page.getByRole('dialog')
  for (const group of ['基本信息', '上下文与输出', '前台展示'])
    await expect(dialog.getByRole('separator').filter({ hasText: group })).toBeVisible()
  await expect(dialog.getByLabel('上下文窗口 Tokens')).toHaveValue('1,000,000')
  await expect(dialog.getByLabel('单次输入上限 Tokens')).toHaveValue('262,144')
  await expect(dialog.getByLabel('最大输出 Tokens')).toHaveValue('384,000')

  await dialog.locator('.label-tip').hover()
  await expect(page.getByRole('tooltip')).toHaveText('每次请求最多发给模型的内容；超出时自动把较早的对话整理成摘要')

  await dialog.getByLabel('单次输入上限 Tokens').fill('600000')
  await dialog.getByRole('button', { name: /确/ }).evaluate((button) => {
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
  await expect(page.getByText('单次输入上限不能超过 上下文窗口 − 最大输出 − 安全余量 16,384 = 599,616，当前为 600,000')).toBeVisible()
  await expect(dialog).toBeVisible()

  await dialog.getByLabel('单次输入上限 Tokens').fill('500000')
  await dialog.getByRole('button', { name: /确/ }).click()
  await expect(dialog).toBeHidden()
  await expect(row).toContainText('1,000,000/500,000/384,000')
  expect(patches.map(patch => (patch as { maxInputTokens: number }).maxInputTokens)).toEqual([600_000, 500_000])
})
