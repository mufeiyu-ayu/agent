import type { SkillPreview, SkillSummary } from '@agent/contracts'
import { expect, test } from '@playwright/test'
import { CONVERSATION_ID, installApiRoutes, installBrowserStubs, toNdjsonLines } from './fixtures'

const draft: SkillPreview = {
  id: 'skill-1',
  name: 'article-check',
  description: '检查文章标题和摘要',
  builtin: false,
  enabled: true,
  published: false,
  hasDraft: true,
  conversationId: CONVERSATION_ID,
  draft: true,
  fingerprint: 'preview-1',
  files: [{ path: 'SKILL.md', encoding: 'utf8', content: '---\nname: article-check\ndescription: 检查文章标题和摘要\n---\n检查标题。<script>window.badSkill=true</script>' }, { path: 'references/check.md', encoding: 'utf8', content: '检查清单' }],
}
const builtin: SkillSummary = { id: 'builtin:skill-creator', name: 'skill-creator', description: '创建自己的技能', builtin: true, enabled: true, published: true, hasDraft: false, conversationId: null }

async function setup(page: import('@playwright/test').Page, published = false) {
  await installApiRoutes(page, () => [])
  await installBrowserStubs(page, { lines: toNdjsonLines(), holdBeforeIndex: -1 })
  let current = { ...structuredClone(draft), ...(published ? { published: true, hasDraft: false, draft: false } : {}) }
  let deleted = false
  const requests: unknown[] = []
  const json = (data: unknown) => ({ contentType: 'application/json', body: JSON.stringify({ success: true, code: 0, message: 'ok', data }) })
  await page.route('**/api/skills', route => route.fulfill(json([builtin, ...deleted ? [] : [current]])))
  await page.route('**/api/skills/skill-1?*', route => route.fulfill(json(current)))
  await page.route('**/api/skills/skill-1', async (route) => {
    if (route.request().method() === 'PATCH')
      current.enabled = route.request().postDataJSON().enabled
    if (route.request().method() === 'DELETE')
      deleted = true
    await route.fulfill(json(current))
  })
  await page.route('**/api/skills/skill-1/publish', async (route) => {
    requests.push(route.request().postDataJSON())
    if (requests.length === 1) {
      current.fingerprint = 'preview-2'
      await route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ success: false, message: '预览已过期，请重新预览后发布' }) })
      return
    }
    current = { ...current, published: true, hasDraft: false, draft: false }
    await route.fulfill(json(current))
  })
  await page.goto('/workspace')
  await expect(page.getByRole('textbox').first()).toBeVisible()
  return { requests }
}

test('草稿预览安全显示、过期确认反馈、重新预览发布与刷新后的技能搜索', async ({ page }) => {
  const { requests } = await setup(page)
  await page.getByRole('button', { name: '技能草稿 · 1' }).click()
  await page.getByRole('button', { name: '预览草稿' }).click()
  await expect(page.locator('pre')).toContainText('<script>')
  expect(await page.evaluate(() => 'badSkill' in window)).toBe(false)
  await page.getByRole('button', { name: '发布到我的技能' }).click()
  await expect(page.getByRole('alert').last()).toContainText('预览已过期')
  await page.getByRole('button', { name: '重新预览' }).click()
  await page.getByRole('button', { name: '发布到我的技能' }).click()
  await expect(page.getByRole('status').last()).toHaveText('已发布')
  expect(requests).toEqual([{ fingerprint: 'preview-1' }, { fingerprint: 'preview-2' }])
  await page.reload()
  await page.getByRole('button', { name: '技能', exact: true }).click()
  await page.getByRole('textbox', { name: '搜索技能' }).fill('摘要')
  await expect(page.getByRole('heading', { name: 'article-check' })).toBeVisible()
  await expect(page).toHaveURL(/\/skills$/)
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.reload()
  await expect(page.getByRole('heading', { name: 'article-check' })).toBeVisible()
  await page.goBack()
  await expect(page).toHaveURL(/\/workspace$/)
  await page.goForward()
  await expect(page).toHaveURL(/\/skills$/)
})

test('创建入口进入聊天并携带明确技能 ID，模型返回后不自动发布', async ({ page }) => {
  const { requests } = await setup(page)
  await page.getByRole('button', { name: '技能', exact: true }).click()
  await page.getByRole('button', { name: '创建技能' }).click()
  await expect(page).toHaveURL(/\/workspace$/)
  const composer = page.getByRole('textbox').first()
  await expect(composer).toHaveValue('请帮我创建一个可复用技能。')
  await composer.press('Enter')
  await expect.poll(() => page.evaluate(() => window.__chatRequests?.length)).toBe(1)
  const sent = await page.evaluate(() => window.__chatRequests?.[0])
  expect(sent).toMatchObject({ skillIds: ['builtin:skill-creator'] })
  expect(requests).toHaveLength(0)
})

test('手机草稿预览可操作且无横向溢出', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await setup(page)
  await page.getByRole('button', { name: '技能草稿 · 1' }).click()
  await page.getByRole('button', { name: '预览草稿' }).click()
  await page.getByLabel('技能文件').selectOption('references/check.md')
  await expect(page.locator('pre')).toHaveText('检查清单')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: '/tmp/issue249-mobile.png' })
  await page.getByRole('button', { name: '关闭技能预览' }).click()
})

test('设置技能模块真实管理共享状态，编辑回聊天、停用生效、删除反馈', async ({ page }) => {
  await setup(page, true)
  await page.getByRole('button', { name: '设置', exact: true }).click()
  const settings = page.getByRole('dialog')
  await settings.getByRole('button', { name: '技能', exact: true }).click()
  await expect(settings.getByRole('heading', { name: 'article-check' })).toBeVisible()
  await settings.getByRole('button', { name: '停用', exact: true }).click()
  await expect(settings.getByText('个人 · 已停用', { exact: true })).toBeVisible()
  await page.screenshot({ path: '/tmp/issue249-desktop.png' })
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: '技能', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'article-check' })).toHaveCount(0)
  await page.getByRole('button', { name: '新建对话', exact: true }).click()
  await expect(page).toHaveURL(/\/workspace$/)
  await page.getByRole('button', { name: '设置', exact: true }).click()
  await settings.getByRole('button', { name: '聊天编辑' }).click()
  await expect(settings).toHaveCount(0)
  await expect(page.getByRole('textbox').first()).toHaveValue(/请修改我的技能 article-check/)
  await page.getByRole('button', { name: '设置', exact: true }).click()
  await settings.getByRole('button', { name: '启用', exact: true }).click()
  await expect(settings.getByRole('button', { name: '停用', exact: true })).toBeVisible()
  await settings.getByRole('button', { name: '删除', exact: true }).click()
  await expect(settings.getByRole('heading', { name: 'article-check' })).toHaveCount(0)
})

test('技能独立路由可直接访问，手机布局与返回聊天入口可用', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await setup(page, true)
  await page.goto('/skills')
  await expect(page.getByRole('heading', { name: '技能', exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'article-check' })).toBeVisible()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  const heading = await page.getByRole('heading', { name: '技能', exact: true }).boundingBox()
  const navigation = await page.getByRole('button', { name: '打开导航', exact: true }).boundingBox()
  expect(heading!.y).toBeGreaterThan(navigation!.y + navigation!.height)
  await page.screenshot({ path: '/tmp/issue249-skills-page-mobile.png' })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.getByRole('button', { name: '创建技能' }).click()
  await expect(page).toHaveURL(/\/workspace$/)
  await expect(page.getByRole('textbox').first()).toHaveValue('请帮我创建一个可复用技能。')
})
