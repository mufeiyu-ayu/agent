import type { ConversationMessage, SkillPreview, SkillSummary } from '@agent/contracts'
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
  const history: ConversationMessage[] = [
    { id: 'user-skill', conversationId: CONVERSATION_ID, role: 'USER', content: '创建文章检查技能', status: 'COMPLETED', createdAt: '2026-10-11T10:00:00.000Z', updatedAt: '2026-10-11T10:00:00.000Z' },
    { id: 'assistant-skill', conversationId: CONVERSATION_ID, role: 'ASSISTANT', content: '草稿已保存，请预览文件。', status: 'COMPLETED', createdAt: '2026-10-11T10:00:01.000Z', updatedAt: '2026-10-11T10:00:01.000Z', activity: { toolBeforeAnswer: true, items: [
      { kind: 'tool', callId: 'save-1', toolName: 'save_skill_draft', ok: true, skill: { id: draft.id, name: draft.name } },
      { kind: 'tool', callId: 'save-2', toolName: 'save_skill_draft', ok: true, skill: { id: draft.id, name: draft.name } },
    ] } },
    { id: 'user-next', conversationId: CONVERSATION_ID, role: 'USER', content: '你好', status: 'COMPLETED', createdAt: '2026-10-11T10:01:00.000Z', updatedAt: '2026-10-11T10:01:00.000Z' },
    { id: 'assistant-next', conversationId: CONVERSATION_ID, role: 'ASSISTANT', content: '你好，有什么可以帮你？', status: 'COMPLETED', createdAt: '2026-10-11T10:01:01.000Z', updatedAt: '2026-10-11T10:01:01.000Z' },
  ]
  await installApiRoutes(page, () => history)
  await installBrowserStubs(page, { lines: toNdjsonLines().map(line => line.replaceAll(CONVERSATION_ID, 'created-skill-chat')), holdBeforeIndex: -1 })
  let current = { ...structuredClone(draft), ...(published ? { published: true, hasDraft: false, draft: false } : {}) }
  let deleted = false
  const requests: unknown[] = []
  const json = (data: unknown) => ({ contentType: 'application/json', body: JSON.stringify({ success: true, code: 0, message: 'ok', data }) })
  await page.route('**/api/conversations', route => route.fulfill(json({ id: 'created-skill-chat', title: '技能新对话', createdAt: '2026-10-11T10:02:00.000Z', updatedAt: '2026-10-11T10:02:00.000Z' })))
  await page.route('**/api/skills', (route) => {
    const { id, name, description, builtin: isBuiltin, enabled, published, hasDraft, conversationId } = current
    return route.fulfill(json([builtin, ...deleted ? [] : [{ id, name, description, builtin: isBuiltin, enabled, published, hasDraft, conversationId }]]))
  })
  await page.route('**/api/skills?conversationId=*', route => route.fulfill(json(!deleted && current.hasDraft ? [current] : [])))
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
  await page.route('**/api/skills/skill-1/draft', async (route) => {
    const body = route.request().postDataJSON()
    if (body.expectedFingerprint !== current.fingerprint) {
      await route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ success: false, message: '技能已经修改，请重新读取最新草稿' }) })
      return
    }
    current.files = body.files
    current.fingerprint = `${current.fingerprint}-saved`
    current.draft = true
    current.hasDraft = true
    requests.push(body)
    await route.fulfill(json(current))
  })
  await page.goto('/workspace')
  await expect(page.getByRole('textbox').first()).toBeVisible()
  return { requests }
}

test('草稿预览安全显示、过期确认反馈、重新预览发布与刷新后的技能搜索', async ({ page }) => {
  const { requests } = await setup(page)
  await page.getByRole('button', { name: '预览技能文件 article-check' }).click()
  await expect(page.locator('[data-skill-preview-panel]')).toBeVisible()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.locator('pre')).toContainText('<script>')
  expect(await page.evaluate(() => 'badSkill' in window)).toBe(false)
  await page.getByRole('button', { name: '发布到我的技能' }).click()
  await expect(page.getByRole('alert').last()).toContainText('预览已过期')
  await expect(page.locator('[data-app-message]')).toHaveCount(0)
  await page.getByRole('button', { name: '重新预览' }).click()
  await page.getByRole('button', { name: '发布到我的技能' }).click()
  await expect(page.locator('[data-skill-preview-panel]').getByRole('status').filter({ hasText: /^已发布$/ })).toHaveText('已发布')
  await expect(page.locator('[data-app-message]')).toContainText('技能已发布')
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
  await page.getByRole('menuitem', { name: /对话创建/ }).click()
  await expect(page).toHaveURL(/\/workspace$/)
  const composer = page.getByRole('textbox').first()
  await expect(composer).toHaveValue('请帮我创建一个可复用技能：')
  await composer.press('Enter')
  await expect.poll(() => page.evaluate(() => window.__chatRequests?.length)).toBe(1)
  const sent = await page.evaluate(() => window.__chatRequests?.[0])
  expect(sent).toMatchObject({ skillIds: ['builtin:skill-creator'] })
  expect(requests).toHaveLength(0)
})

test('手机草稿预览可操作且无横向溢出', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await setup(page)
  await page.getByRole('button', { name: '预览技能文件 article-check' }).click()
  await page.locator('[data-skill-preview-panel]').getByRole('combobox').selectOption('references/check.md')
  await expect(page.locator('pre')).toHaveText('检查清单')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await expect(page.locator('[data-skill-preview-panel]')).not.toHaveClass(/duration-300/)
  const panel = await page.locator('[data-skill-preview-panel]').boundingBox()
  expect(panel!.x).toBeGreaterThanOrEqual(0)
  expect(panel!.x + panel!.width).toBeLessThanOrEqual(390)
  expect(await page.evaluate(() => window.scrollX)).toBe(0)
  await page.screenshot({ path: '/tmp/issue249-mobile.png' })
  await page.locator('[data-skill-preview-panel]').getByRole('button', { name: '关闭预览', exact: true }).click()
  await expect(page.getByRole('button', { name: '预览技能文件 article-check' })).toBeFocused()
})

test('草稿仅保留在来源对话，技能页和设置不展示草稿', async ({ page }) => {
  await setup(page)
  await page.getByRole('button', { name: '预览技能文件 article-check' }).click()
  await expect(page.getByRole('button', { name: '发布到我的技能' })).toBeVisible()
  await page.locator('[data-skill-preview-panel]').getByRole('button', { name: '关闭预览', exact: true }).click()
  await page.getByRole('button', { name: '技能', exact: true }).click()
  await expect(page.getByRole('button', { name: /^草稿/ })).toHaveCount(0)
  await expect(page.getByRole('heading', { name: draft.name })).toHaveCount(0)
  await page.getByRole('button', { name: '设置', exact: true }).click()
  const settings = page.getByRole('dialog')
  await settings.getByRole('button', { name: '技能', exact: true }).click()
  await expect(settings.getByRole('heading', { name: draft.name })).toHaveCount(0)
})

test('设置技能模块真实管理共享状态，仅提供手动编辑、停用生效、删除反馈', async ({ page }) => {
  await setup(page, true)
  await page.getByRole('button', { name: '设置', exact: true }).click()
  const settings = page.getByRole('dialog')
  await settings.getByRole('button', { name: '技能', exact: true }).click()
  await expect(settings.getByRole('heading', { name: 'article-check' })).toBeVisible()
  await settings.getByRole('button', { name: '停用', exact: true }).click()
  await expect(page.locator('[data-app-message]')).toContainText('技能已停用')
  await expect(settings.getByText('个人 · 已停用', { exact: true })).toBeVisible()
  await page.screenshot({ path: '/tmp/issue249-desktop.png' })
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: '技能', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'article-check' })).toBeVisible()
  await page.getByRole('button', { name: /^我的技能/ }).click()
  await expect(page.getByRole('button', { name: /^我的技能/ })).toContainText('1')
  await expect(page.getByText('个人 · 已停用', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '对话使用', exact: true })).toHaveCount(0)
  await page.reload()
  await page.getByRole('button', { name: /^我的技能/ }).click()
  await expect(page.getByRole('heading', { name: 'article-check' })).toBeVisible()
  await page.getByRole('button', { name: '启用', exact: true }).click()
  await expect(page.locator('[data-app-message]')).toContainText('技能已启用')
  await expect(page.getByRole('button', { name: '对话使用', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '停用', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'article-check' })).toBeVisible()
  await page.getByRole('button', { name: '新建对话', exact: true }).click()
  await expect(page).toHaveURL(/\/workspace$/)
  await page.getByRole('button', { name: '设置', exact: true }).click()
  await settings.getByRole('button', { name: '技能', exact: true }).click()
  await expect(settings.getByRole('button', { name: '聊天编辑' })).toHaveCount(0)
  await expect(settings.getByRole('button', { name: '手动编辑' })).toBeVisible()
  await settings.getByRole('button', { name: '启用', exact: true }).click()
  await expect(settings.getByRole('button', { name: '停用', exact: true })).toBeVisible()
  await settings.getByRole('button', { name: '删除', exact: true }).click()
  await settings.getByRole('button', { name: '确认删除', exact: true }).click()
  await expect(page.locator('[data-app-message]')).toContainText('技能已删除')
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
  await page.getByRole('menuitem', { name: /对话创建/ }).click()
  await expect(page).toHaveURL(/\/workspace$/)
  await expect(page.getByRole('textbox').first()).toHaveValue('请帮我创建一个可复用技能：')
})

test('技能文件卡片留在保存回复末尾，重复保存不重复显示，刷新后仍可预览', async ({ page }) => {
  await setup(page)
  const savedReply = page.locator('[data-agent-assistant-turn-id="user-skill"]')
  await expect(savedReply.getByRole('button', { name: '预览技能文件 article-check' })).toHaveCount(1)
  await expect(page.locator('[data-agent-assistant-turn-id="user-next"] [data-skill-artifacts]')).toHaveCount(0)
  await expect(page.getByRole('button', { name: /技能草稿 ·/ })).toHaveCount(0)
  const text = await savedReply.getByText('草稿已保存，请预览文件。').boundingBox()
  const card = await savedReply.locator('[data-skill-artifacts]').boundingBox()
  expect(card!.y).toBeGreaterThanOrEqual(text!.y + text!.height)
  await page.screenshot({ path: '/tmp/skill-chat-card-desktop.png' })
  await page.reload()
  await savedReply.getByRole('button', { name: '预览技能文件 article-check' }).click()
  await expect(page.getByRole('button', { name: '发布到我的技能' })).toBeVisible()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.locator('.panel-transition')).toHaveCount(0)
  const preview = await page.locator('[data-skill-preview-panel]').boundingBox()
  const chat = await page.locator('[data-agent-conversation-viewport]').boundingBox()
  expect(preview!.x).toBeGreaterThanOrEqual(chat!.x + chat!.width - 1)
  await page.screenshot({ path: '/tmp/skill-chat-preview-desktop.png' })
})

test('切换会话取消技能预览请求，迟到结果不打开旧技能', async ({ page }) => {
  await setup(page)
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  let started = false
  let completed = false
  await page.route('**/api/skills/skill-1?*', async (route) => {
    started = true
    await gate
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ success: true, code: 0, message: 'ok', data: draft }) }).catch(() => {})
    completed = true
  })
  try {
    await page.getByRole('button', { name: '预览技能文件 article-check' }).click()
    await expect.poll(() => started).toBe(true)
    await page.getByRole('button', { name: '新建对话', exact: true }).click()
    release()
    await expect.poll(() => completed).toBe(true)
    await expect(page.locator('[data-skill-preview-panel]')).toHaveCount(0)
    await expect(page.getByRole('dialog')).toHaveCount(0)
  }
  finally { release() }
})

test('技能源文超过普通附件渲染上限时仍完整预览', async ({ page }) => {
  await setup(page)
  const large = { ...draft, files: [{ ...draft.files[0]!, content: `${draft.files[0]!.content}\n${'x'.repeat(205000)}\nSKILL_SOURCE_END` }] }
  await page.route('**/api/skills/skill-1?*', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ success: true, code: 0, message: 'ok', data: large }) }))
  await page.getByRole('button', { name: '预览技能文件 article-check' }).click()
  await expect(page.locator('[data-skill-preview-panel] pre')).toContainText('SKILL_SOURCE_END')
})

test('发布期间关闭右侧预览，迟到成功不重新打开面板', async ({ page }) => {
  await setup(page)
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  let started = false
  let finished = false
  await page.route('**/api/skills/skill-1/publish', async (route) => {
    started = true
    await gate
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ success: true, code: 0, message: 'ok', data: { ...draft, draft: false, published: true, hasDraft: false } }) })
    finished = true
  })
  try {
    await page.getByRole('button', { name: '预览技能文件 article-check' }).click()
    await page.getByRole('button', { name: '发布到我的技能' }).click()
    await expect.poll(() => started).toBe(true)
    await page.locator('[data-skill-preview-panel]').getByRole('button', { name: '关闭预览', exact: true }).click()
    release()
    await expect.poll(() => finished).toBe(true)
    await expect(page.getByRole('button', { name: '预览技能文件 article-check' })).toBeEnabled()
    await expect(page.locator('[data-skill-preview-panel]')).toHaveCount(0)
    await expect(page.getByRole('dialog')).toHaveCount(0)
  }
  finally { release() }
})

test('已发布技能编辑只提供保存修改，不再保存草稿', async ({ page }) => {
  const { requests } = await setup(page, true)
  await page.getByRole('button', { name: '技能', exact: true }).click()
  await page.getByRole('button', { name: '手动编辑' }).click()
  const editor = page.getByRole('dialog')
  await expect(editor.getByRole('button', { name: '保存草稿' })).toHaveCount(0)
  await expect(editor.getByRole('button', { name: '发布生效' })).toHaveCount(0)
  await editor.getByRole('textbox', { name: '技能标识', exact: true }).fill('invalid_name')
  await expect(editor.getByRole('button', { name: '保存修改' })).toBeDisabled()
  await editor.getByRole('textbox', { name: '技能标识', exact: true }).fill('article-check')
  await editor.getByRole('textbox', { name: '技能正文说明', exact: true }).fill('更新后的正文')
  await editor.getByRole('button', { name: '保存修改' }).click()
  await expect(editor).toHaveCount(0)
  await expect(page.locator('[data-app-message]')).toContainText('技能已更新')
  expect(requests).toContainEqual({ fingerprint: 'preview-1-saved' })
  await expect(page.getByRole('heading', { name: draft.name })).toBeVisible()
})

test('对话预览进入手动编辑，发布失败重试携带最新草稿指纹', async ({ page }) => {
  const { requests } = await setup(page)
  const publications: string[] = []
  await page.route('**/api/skills/skill-1/publish', async (route) => {
    publications.push(route.request().postDataJSON().fingerprint)
    if (publications.length === 1) {
      await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ success: false, message: '暂时无法发布，请重试' }) })
      return
    }
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ success: true, code: 0, message: 'ok', data: { ...draft, draft: false, published: true, hasDraft: false, fingerprint: publications.at(-1) } }) })
  })
  await page.getByRole('button', { name: '预览技能文件 article-check' }).click()
  await expect(page.getByRole('button', { name: '继续聊天修改' })).toHaveCount(0)
  await page.locator('[data-skill-preview-panel]').getByRole('button', { name: '手动编辑' }).click()
  const editor = page.getByRole('dialog')
  await editor.getByRole('textbox', { name: '技能正文说明', exact: true }).fill('手动更新正文')
  await editor.getByRole('button', { name: '发布生效' }).click()
  await expect(editor.getByText('暂时无法发布，请重试')).toBeVisible()
  await editor.getByRole('button', { name: '发布生效' }).click()
  await expect(editor).toHaveCount(0)
  await expect(page.locator('[data-skill-preview-panel]').getByRole('status').filter({ hasText: /^已发布$/ })).toHaveText('已发布')
  expect(requests.map(request => (request as { expectedFingerprint: string }).expectedFingerprint)).toEqual(['preview-1', 'preview-1-saved'])
  expect(publications).toEqual(['preview-1-saved', 'preview-1-saved-saved'])
})

test('侧栏按当前页面高亮，技能页与会话不会同时选中', async ({ page }) => {
  await setup(page)
  const selected = page.locator('[aria-current="page"]:visible')
  const chat = page.getByRole('button', { name: '落地页 SEO 诊断', exact: true })
  await expect(selected).toHaveCount(1)
  await expect(chat).toHaveAttribute('aria-current', 'page')
  await expect(page.getByRole('button', { name: '知识库问答', exact: true })).not.toHaveClass(/(?:^|\s)bg-agent-surface-sunken/)
  await page.getByRole('button', { name: '技能', exact: true }).click()
  await expect(selected).toHaveCount(1)
  await expect(page.getByRole('button', { name: '技能', exact: true })).toHaveAttribute('aria-current', 'page')
  await expect(chat).not.toHaveAttribute('aria-current')
  await chat.click()
  await expect(page).toHaveURL(/\/workspace$/)
  await expect(selected).toHaveCount(1)
  await expect(chat).toHaveAttribute('aria-current', 'page')
  await page.getByRole('button', { name: '新建对话', exact: true }).click()
  await expect(selected).toHaveCount(0)
})

test('技能卡片点击预览打开预览弹窗，弹窗内加载后直接展示源码样式', async ({ page }) => {
  await setup(page, true)
  await page.getByRole('button', { name: '技能', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'article-check' })).toBeVisible()

  // 点击 article-check 卡片的“预览”按钮
  const card = page.getByRole('listitem').filter({ has: page.getByRole('heading', { name: 'article-check' }) })
  await card.getByRole('button', { name: '预览', exact: true }).click()
  const modal = page.getByRole('dialog')
  await expect(modal).toBeVisible()
  await expect(modal.getByRole('heading', { name: 'article-check' })).toBeVisible()

  // 直接展示源码，不含 tab 切换按钮或技能说明卡片
  await expect(modal.getByRole('button', { name: '源码' })).toHaveCount(0)
  await expect(modal.getByText('技能说明')).toHaveCount(0)
  await expect(modal.locator('pre')).toContainText('name: article-check')

  // 关闭预览弹窗
  await modal.getByRole('button', { name: '关闭技能预览' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
})

test('步骤展示使用的技能名称，刷新保留且不生成草稿文件卡片', async ({ page }) => {
  await setup(page, true)
  const history: ConversationMessage[] = [
    { id: 'user-read', conversationId: CONVERSATION_ID, role: 'USER', content: '检查文章', status: 'COMPLETED', createdAt: '2026-10-11T10:00:00.000Z', updatedAt: '2026-10-11T10:00:00.000Z' },
    { id: 'assistant-read', conversationId: CONVERSATION_ID, role: 'ASSISTANT', content: '已按技能检查。', status: 'COMPLETED', createdAt: '2026-10-11T10:00:01.000Z', updatedAt: '2026-10-11T10:00:01.000Z', activity: { toolBeforeAnswer: true, items: [
      { kind: 'tool', callId: 'read-1', toolName: 'read_skill', ok: true, skill: { id: draft.id, name: draft.name } },
    ] } },
  ]
  await installApiRoutes(page, () => history)
  for (let index = 0; index < 2; index++) {
    await page.reload()
    await page.locator('[data-run-row]').click()
    await expect(page.locator('[data-run-timeline]')).toContainText('使用技能')
    await expect(page.locator('[data-run-timeline]')).toContainText('article-check')
    await expect(page.locator('[data-run-timeline]')).not.toContainText('read_skill')
    await expect(page.locator('[data-skill-artifacts]')).toHaveCount(0)
  }
})

test('对话使用技能创建空白会话，输入框展示可移除标签并随首条消息发送', async ({ page }) => {
  await setup(page, true)
  await expect(page.getByText('草稿已保存，请预览文件。', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '技能', exact: true }).click()
  const card = page.getByRole('listitem').filter({ has: page.getByRole('heading', { name: draft.name }) })
  await card.getByRole('button', { name: '对话使用', exact: true }).click()
  await expect(page).toHaveURL(/\/workspace$/)
  await expect(page.getByText('草稿已保存，请预览文件。', { exact: true })).toHaveCount(0)
  await expect(page.locator('[data-composer-skills]')).toHaveText(/article-check/)
  const composer = page.locator('textarea')
  await expect(composer).toHaveValue('')
  await expect(composer).toBeFocused()
  await expect(composer).toHaveAttribute('placeholder', '')
  await page.screenshot({ path: '/tmp/skill-composer-desktop.png' })
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(page.locator('[data-composer-skills]')).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: '/tmp/skill-composer-mobile.png' })
  await composer.press('Backspace')
  await expect(page.locator('[data-composer-skills]')).toHaveCount(0)
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.getByRole('button', { name: '技能', exact: true }).click()
  await card.getByRole('button', { name: '对话使用', exact: true }).click()
  await expect(page.locator('[data-composer-skills]')).toHaveText(/article-check/)
  await composer.fill('检查这篇文章')
  await composer.press('Enter')
  await expect(page.locator('[data-composer-skills]')).toHaveCount(0)
  await expect.poll(() => page.evaluate(() => window.__chatRequests?.length)).toBe(1)
  expect(await page.evaluate(() => window.__chatRequests?.[0])).toMatchObject({ conversationId: 'created-skill-chat', message: '检查这篇文章', skillIds: ['skill-1'] })
  await expect(page.locator('[data-message-skills]')).toHaveText('article-check')
  await expect(page.locator('[data-agent-user-turn-id]')).toContainText('检查这篇文章')
  await page.screenshot({ path: '/tmp/skill-sent-message.png' })
})

test('刷新后用户消息仍显示当时显式选择的技能', async ({ page }) => {
  await setup(page)
  const history: ConversationMessage[] = [
    { id: 'selected-user', conversationId: CONVERSATION_ID, role: 'USER', content: '这个是干嘛的', skills: [{ id: builtin.id, name: builtin.name }], status: 'COMPLETED', createdAt: '2026-10-11T10:00:00.000Z', updatedAt: '2026-10-11T10:00:00.000Z' },
  ]
  await installApiRoutes(page, () => history)
  await page.reload()
  await expect(page.locator('[data-message-skills]')).toHaveText('skill-creator')
  await expect(page.locator('[data-agent-user-turn-id]')).toContainText('这个是干嘛的')
  await page.reload()
  await expect(page.locator('[data-message-skills]')).toHaveText('skill-creator')
})

test('新建对话中输入斜杠在下方弹出技能盒子，已有对话在上方弹出，支持快捷选择', async ({ page }) => {
  await setup(page, true)
  // 1. 新建对话状态（点击新建对话进入 hero 空白态）
  await page.getByRole('button', { name: '新建对话', exact: true }).click()
  const heroComposer = page.getByRole('textbox').first()
  await heroComposer.fill('/')
  const slashMenu = page.getByRole('listbox', { name: '快捷技能指令' })
  await expect(slashMenu).toBeVisible()
  await expect(slashMenu.getByText('skill-creator')).toBeVisible()

  // 验证在下方展开（menuBox.y > composerBox.y）
  const composerBox = await heroComposer.boundingBox()
  const menuBox = await slashMenu.boundingBox()
  expect(menuBox!.y).toBeGreaterThan(composerBox!.y)

  // 支持回车选中当前高亮项
  await heroComposer.press('Enter')
  await expect(slashMenu).toHaveCount(0)
  await expect(heroComposer).toHaveValue('')
  await expect(page.locator('[data-composer-skills]')).toBeVisible()

  // 2. 已有对话状态（回到现有已有消息的会话）
  await page.getByRole('button', { name: '落地页 SEO 诊断', exact: true }).click()
  const bottomComposer = page.getByRole('textbox').first()
  await bottomComposer.fill('/')
  await expect(slashMenu).toBeVisible()

  // 验证在上方展开（topMenuBox.y < bottomBox.y）
  const bottomBox = await bottomComposer.boundingBox()
  const topMenuBox = await slashMenu.boundingBox()
  expect(topMenuBox!.y + topMenuBox!.height).toBeLessThanOrEqual(bottomBox!.y + 15)

  // 点击选择技能
  await slashMenu.getByText('skill-creator').click()
  await expect(slashMenu).toHaveCount(0)
  await expect(bottomComposer).toHaveValue('')
  await expect(page.locator('[data-composer-skills]')).toContainText('skill-creator')
})

test('手动创建直接发布，取消不创建记录且无游离草稿', async ({ page }) => {
  await setup(page)
  let created = 0
  let updated = 0
  let published = 0
  let current: SkillPreview | undefined
  const json = (data: unknown) => ({ contentType: 'application/json', body: JSON.stringify({ success: true, code: 0, message: 'ok', data }) })
  await page.route('**/api/skills', async (route) => {
    if (route.request().method() === 'POST') {
      created++
      current = { ...draft, id: 'manual-skill', name: 'manual-check', conversationId: null, published: true, hasDraft: false, draft: false, fingerprint: 'manual-1', files: route.request().postDataJSON().files }
      await route.fulfill(json(current))
    }
    else { await route.fulfill(json([builtin, ...(current ? [current] : [])])) }
  })
  await page.route('**/api/skills/manual-skill/draft', async (route) => {
    const body = route.request().postDataJSON()
    expect(body.expectedFingerprint).toBe(current!.fingerprint)
    updated++
    current = { ...current!, files: body.files, fingerprint: `manual-${updated + 1}` }
    await route.fulfill(json(current))
  })
  await page.route('**/api/skills/manual-skill/publish', async (route) => {
    expect(route.request().postDataJSON().fingerprint).toBe(current!.fingerprint)
    published++
    current = { ...current!, draft: false, hasDraft: false, published: true }
    await route.fulfill(json(current))
  })
  await page.getByRole('button', { name: '技能', exact: true }).click()
  await page.getByRole('button', { name: '创建技能', exact: true }).click()
  await page.getByRole('menuitem', { name: '手动创建' }).click()
  const editor = page.getByRole('dialog')
  await expect(editor.getByRole('heading', { name: '创建技能' })).toBeVisible()
  await expect(editor.getByRole('button', { name: '保存草稿' })).toHaveCount(0)
  await editor.getByRole('button', { name: '取消', exact: true }).click()
  expect(created).toBe(0)
  await page.getByRole('button', { name: '创建技能', exact: true }).click()
  await page.getByRole('menuitem', { name: '手动创建' }).click()
  await editor.getByRole('textbox', { name: '技能标识', exact: true }).fill('manual-check')
  await editor.getByRole('textbox', { name: '触发场景描述', exact: true }).fill('手动创建的文章检查技能')
  await editor.getByRole('textbox', { name: '技能正文说明', exact: true }).fill('检查标题和摘要。')
  await editor.getByRole('button', { name: '发布生效' }).click()
  await expect(editor).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'manual-check', exact: true })).toBeVisible()
  expect(created).toBe(1)
  expect(updated).toBe(0)
  expect(published).toBe(0)
  await expect(page.locator('[data-app-message]')).toContainText('技能已发布')
  await expect(page).toHaveURL(/\/skills$/)
  expect(await page.evaluate(() => window.__chatRequests?.length)).toBe(0)
})

for (const method of ['button', 'enter'] as const) {
  test(`只选择技能可以通过 ${method} 发送，移除后空消息不能发送`, async ({ page }) => {
    await setup(page, true)
    await page.getByRole('button', { name: '技能', exact: true }).click()
    const card = page.getByRole('listitem').filter({ has: page.getByRole('heading', { name: draft.name }) })
    await card.getByRole('button', { name: '对话使用', exact: true }).click()
    await expect(page.getByRole('button', { name: '发送消息', exact: true })).toBeVisible()
    await page.locator('textarea').press('Backspace')
    await expect(page.locator('[data-composer-primary]')).toHaveCount(0)
    await page.locator('textarea').press('Enter')
    expect(await page.evaluate(() => window.__chatRequests?.length)).toBe(0)
    await page.getByRole('button', { name: '技能', exact: true }).click()
    await card.getByRole('button', { name: '对话使用', exact: true }).click()
    await expect(page.locator('textarea')).toHaveValue('')
    if (method === 'button')
      await page.getByRole('button', { name: '发送消息', exact: true }).click()
    else
      await page.locator('textarea').press('Enter')
    await expect.poll(() => page.evaluate(() => window.__chatRequests?.length)).toBe(1)
    expect(await page.evaluate(() => window.__chatRequests?.[0])).toMatchObject({ message: '', skillIds: ['skill-1'] })
    await expect(page.locator('[data-message-skills]')).toHaveText('article-check')
    await expect(page.locator('[data-agent-user-turn-id]')).toHaveCount(1)
  })
}

test('技能页单个删除已发布技能，确认可取消且失败可重试', async ({ page }) => {
  await setup(page, true)
  let deletions = 0
  await page.route('**/api/skills/skill-1', async (route) => {
    if (route.request().method() === 'DELETE' && ++deletions === 1) {
      await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ success: false, message: '删除失败，请重试' }) })
      return
    }
    await route.fallback()
  })
  await page.getByRole('button', { name: '技能', exact: true }).click()
  const builtinCard = page.getByRole('listitem').filter({ has: page.getByRole('heading', { name: builtin.name }) })
  await expect(builtinCard.getByRole('button', { name: '删除', exact: true })).toHaveCount(0)
  const card = page.getByRole('listitem').filter({ has: page.getByRole('heading', { name: draft.name }) })
  await card.getByRole('button', { name: '删除', exact: true }).click()
  expect(deletions).toBe(0)
  await card.getByRole('button', { name: '取消', exact: true }).click()
  await expect(card).toBeVisible()
  await card.getByRole('button', { name: '删除', exact: true }).click()
  await card.getByRole('button', { name: '确认删除', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('删除失败，请重试')
  await expect(card).toBeVisible()
  await card.getByRole('button', { name: '确认删除', exact: true }).click()
  await expect(card).toHaveCount(0)
  expect(deletions).toBe(2)
  await expect(page.getByRole('textbox', { name: '搜索技能' })).toBeFocused()
  await page.reload()
  await expect(page.getByRole('heading', { name: draft.name })).toHaveCount(0)
  await expect(page.getByRole('heading', { name: builtin.name })).toBeVisible()
})

test('英文设置覆盖技能页、编辑弹窗、创建菜单和快捷技能菜单', async ({ page }) => {
  await setup(page, true)
  await page.addInitScript(() => localStorage.setItem('agent-web-locale', 'en-US'))
  await page.reload()
  await page.getByRole('button', { name: 'Skills', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Skills', exact: true })).toBeVisible()
  await expect(page.getByRole('textbox', { name: 'Search skills' })).toBeVisible()
  await page.getByRole('button', { name: 'Edit manually' }).click()
  const editor = page.getByRole('dialog')
  await expect(editor.getByRole('heading', { name: 'Edit skill' })).toBeVisible()
  await expect(editor.getByRole('textbox', { name: 'Skill identifier', exact: true })).toBeVisible()
  await expect(editor.getByRole('textbox', { name: 'When to use this skill', exact: true })).toBeVisible()
  await expect(editor.getByRole('button', { name: 'Save changes' })).toBeVisible()
  await expect(editor.getByRole('button', { name: 'Save draft' })).toHaveCount(0)
  await editor.getByRole('button', { name: 'Close skill editor' }).click()
  await page.getByRole('button', { name: 'Create skill', exact: true }).click()
  await expect(page.getByRole('menuitem', { name: 'Create in chat' })).toBeVisible()
  await page.getByRole('menuitem', { name: 'Create manually' }).click()
  await expect(page.getByRole('dialog').getByRole('heading', { name: 'Create skill' })).toBeVisible()
  await page.getByRole('button', { name: 'Close skill editor' }).click()
  await page.getByRole('button', { name: 'New chat', exact: true }).click()
  await page.locator('textarea').fill('/')
  await expect(page.getByRole('listbox', { name: 'Skill shortcuts' })).toBeVisible()
})

test('技能选择在请求被接受后清除，发送前失败保留以便重试', async ({ page }) => {
  await setup(page, true)
  await page.getByRole('button', { name: '技能', exact: true }).click()
  await page.getByRole('listitem').filter({ has: page.getByRole('heading', { name: draft.name }) }).getByRole('button', { name: '对话使用' }).click()
  await page.evaluate(() => {
    const original = window.fetch.bind(window)
    let failed = false
    window.fetch = async (input, init) => {
      if (!failed && String(input).includes('/api/chat/stream')) {
        failed = true
        return new Response(JSON.stringify({ success: false, code: 400, message: '输入预算不足' }), { status: 400, headers: { 'content-type': 'application/json' } })
      }
      return original(input, init)
    }
  })
  await page.locator('textarea').fill('检查标题')
  await page.locator('textarea').press('Enter')
  await expect(page.locator('[data-app-message]')).toContainText('输入预算不足')
  await expect(page.locator('[data-composer-skills]')).toContainText('article-check')
  await expect(async () => {
    await page.locator('textarea').press('Enter')
    expect(await page.evaluate(() => window.__chatRequests?.length)).toBe(1)
  }).toPass()
  await expect(page.locator('[data-composer-skills]')).toHaveCount(0)
  await page.locator('textarea').fill('另一个问题')
  await expect(async () => {
    await page.locator('textarea').press('Enter')
    expect(await page.evaluate(() => window.__chatRequests?.length)).toBe(2)
  }).toPass()
  const requests = await page.evaluate(() => window.__chatRequests as Array<{ skillIds?: string[] }>)
  expect(requests[0]?.skillIds).toEqual(['skill-1'])
  expect(requests[1]?.skillIds).toBeUndefined()
})

test('关闭编辑器会取消读取，旧技能迟到响应不覆盖手动创建内容', async ({ page }) => {
  await setup(page, true)
  await page.route('**/api/skills', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ success: true, code: 0, message: 'ok', data: [builtin, { id: draft.id, name: draft.name, description: draft.description, builtin: false, enabled: true, published: true, hasDraft: false, conversationId: CONVERSATION_ID }] }) }))
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  await page.route('**/api/skills/skill-1?*', async (route) => {
    await gate
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ success: true, code: 0, message: 'ok', data: draft }) }).catch(() => {})
  })
  await page.reload()
  try {
    await page.getByRole('button', { name: '技能', exact: true }).click()
    await page.getByRole('button', { name: '手动编辑' }).click()
    await expect(page.getByRole('status', { name: '正在加载技能定义' })).toBeVisible()
    await page.getByRole('button', { name: '关闭技能编辑器' }).click()
    await page.getByRole('button', { name: '创建技能' }).click()
    await page.getByRole('menuitem', { name: '手动创建' }).click()
    await page.getByRole('textbox', { name: '技能标识', exact: true }).fill('new-skill')
    release()
    await expect(page.getByRole('textbox', { name: '技能标识', exact: true })).toHaveValue('new-skill')
    await expect(page.getByRole('dialog').getByRole('heading', { name: '创建技能' })).toBeVisible()
  }
  finally { release() }
})

test('慢保存期间全部编辑字段禁用，响应不会覆盖用户后续输入', async ({ page }) => {
  await setup(page)
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  let started = false
  await page.route('**/api/skills/skill-1/draft', async (route) => {
    const body = route.request().postDataJSON()
    started = true
    await gate
    await route.fulfill({ json: { success: true, code: 0, data: { ...draft, files: body.files, fingerprint: 'saved-a' } } })
  })
  await page.getByRole('button', { name: '预览技能文件 article-check' }).click()
  await page.locator('[data-skill-preview-panel]').getByRole('button', { name: '手动编辑' }).click()
  const editor = page.getByRole('dialog')
  const body = editor.getByRole('textbox', { name: '技能正文说明', exact: true })
  await body.fill('保存 A')
  await editor.getByRole('button', { name: '保存草稿', exact: true }).click()
  try {
    await expect.poll(() => started).toBe(true)
    for (const field of await editor.locator('input, textarea, select').all())
      await expect(field).toBeDisabled()
    await expect(body).toHaveValue('保存 A')
  }
  finally { release() }
  await expect(body).toBeEnabled()
  await expect(body).toHaveValue('保存 A')
})

test('已发布预览有待发布修改时，编辑读取当前草稿指纹', async ({ page }) => {
  await setup(page, true)
  const published = { ...draft, published: true, draft: false, hasDraft: true, fingerprint: 'published-old' }
  const pending = { ...published, draft: true, fingerprint: 'draft-current', files: [{ ...draft.files[0]!, content: draft.files[0]!.content.replace('检查标题。', '当前草稿正文。') }] }
  await page.route('**/api/skills/skill-1?*', route => route.fulfill({ json: { success: true, code: 0, data: new URL(route.request().url()).searchParams.get('draft') === 'true' ? pending : published } }))
  let savedFingerprint = ''
  await page.route('**/api/skills/skill-1/draft', async (route) => {
    const request = route.request().postDataJSON()
    savedFingerprint = request.expectedFingerprint
    await route.fulfill({ json: { success: true, code: 0, data: { ...pending, files: request.files, fingerprint: 'draft-saved' } } })
  })
  await page.route('**/api/skills/skill-1/publish', route => route.fulfill({ json: { success: true, code: 0, data: { ...pending, draft: false, hasDraft: false } } }))
  await page.getByRole('button', { name: '技能', exact: true }).click()
  await page.getByRole('listitem').filter({ has: page.getByRole('heading', { name: draft.name }) }).getByRole('button', { name: '预览', exact: true }).click()
  const preview = page.getByRole('dialog')
  await preview.getByRole('button', { name: '手动编辑' }).click()
  const editor = page.getByRole('dialog')
  await expect(editor.getByRole('textbox', { name: '技能正文说明', exact: true })).toHaveValue(/当前草稿正文/)
  await editor.getByRole('button', { name: '保存修改', exact: true }).click()
  await expect(editor).toHaveCount(0)
  expect(savedFingerprint).toBe('draft-current')
})

test('名称前后空格与提交规则一致，合法 PNG 及未知二进制有可见预览和下载', async ({ page }) => {
  await setup(page)
  const resources = { ...draft, files: [...draft.files, { path: 'assets/pixel.png', encoding: 'base64', content: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jQxQAAAAASUVORK5CYII=' }, { path: 'assets/font.woff2', encoding: 'base64', content: 'd09GMg==' }] }
  await page.route('**/api/skills/skill-1?*', route => route.fulfill({ json: { success: true, code: 0, data: resources } }))
  await page.getByRole('button', { name: '预览技能文件 article-check' }).click()
  const panel = page.locator('[data-skill-preview-panel]')
  await panel.getByRole('combobox').selectOption('assets/pixel.png')
  await expect(panel.getByRole('img', { name: 'assets/pixel.png' })).toBeVisible()
  await expect.poll(() => panel.getByRole('img').evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(1)
  await expect(panel.getByRole('link', { name: /下载/ })).toBeVisible()
  await panel.getByRole('combobox').selectOption('assets/font.woff2')
  await expect(panel).toContainText('二进制')
  await expect(panel.getByRole('link', { name: /下载/ })).toBeVisible()
  await panel.getByRole('button', { name: '手动编辑' }).click()
  const editor = page.getByRole('dialog')
  await editor.getByRole('textbox', { name: '技能标识', exact: true }).fill(' article-check ')
  await expect(editor.getByRole('button', { name: '发布生效', exact: true })).toBeDisabled()
})

test('IME 组词及 keyCode 229 不删除技能；非组词空输入仍可退格删除', async ({ page }) => {
  await setup(page, true)
  await page.getByRole('button', { name: '技能', exact: true }).click()
  await page.getByRole('listitem').filter({ has: page.getByRole('heading', { name: draft.name }) }).getByRole('button', { name: '对话使用' }).click()
  const textarea = page.locator('textarea')
  await textarea.dispatchEvent('compositionstart')
  expect(await textarea.evaluate(element => element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true, isComposing: true })))).toBe(true)
  await expect(page.locator('[data-composer-skills]')).toContainText(draft.name)
  await textarea.dispatchEvent('compositionend')
  await textarea.fill('/')
  const menu = page.getByRole('listbox', { name: '快捷技能指令' })
  await expect(menu).toBeVisible()
  const beforeArrow = await menu.getByRole('option', { selected: true }).textContent()
  await textarea.dispatchEvent('compositionstart')
  expect(await textarea.evaluate(element => element.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true, isComposing: true })))).toBe(true)
  expect(await menu.getByRole('option', { selected: true }).textContent()).toBe(beforeArrow)
  await textarea.dispatchEvent('compositionend')
  await textarea.fill('')
  expect(await textarea.evaluate(element => element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', keyCode: 229, bubbles: true, cancelable: true })))).toBe(true)
  await expect(page.locator('[data-composer-skills]')).toContainText(draft.name)
  await textarea.press('Backspace')
  await expect(page.locator('[data-composer-skills]')).toHaveCount(0)
})

test('首采样前已提交错误清理本次技能选择，来源会话可找回无成功卡片的草稿', async ({ page }) => {
  await setup(page, true)
  await page.getByRole('button', { name: '技能', exact: true }).click()
  await page.getByRole('listitem').filter({ has: page.getByRole('heading', { name: draft.name }) }).getByRole('button', { name: '对话使用' }).click()
  await page.evaluate(() => {
    const original = window.fetch.bind(window)
    window.fetch = async (input, init) => String(input).includes('/api/chat/stream')
      ? new Response(`${JSON.stringify({ type: 'error', conversationId: 'created-skill-chat', message: '首采样前失败', userMessagePersisted: true })}\n`, { headers: { 'content-type': 'application/x-ndjson' } })
      : original(input, init)
  })
  await page.locator('textarea').press('Enter')
  await expect(page.locator('[data-app-message]')).toContainText('首采样前失败')
  await expect(page.locator('[data-composer-skills]')).toHaveCount(0)

  await page.route('**/api/conversations/*/messages', route => route.fulfill({ json: { success: true, code: 0, data: [{ id: 'unknown-user', conversationId: CONVERSATION_ID, role: 'USER', content: '创建技能', status: 'COMPLETED', createdAt: '2026-10-11T10:00:00Z', updatedAt: '2026-10-11T10:00:00Z' }, { id: 'unknown-answer', conversationId: CONVERSATION_ID, role: 'ASSISTANT', content: '提交结果未知，请核对', status: 'FAILED', createdAt: '2026-10-11T10:00:01Z', updatedAt: '2026-10-11T10:00:01Z' }] } }))
  await page.route('**/api/skills?conversationId=*', route => route.fulfill({ json: { success: true, code: 0, data: [draft] } }))
  await page.reload()
  await expect(page.locator('[data-skill-artifacts]')).toHaveCount(0)
  await page.locator('[data-conversation-skill-drafts]').getByRole('button', { name: /article-check/ }).click()
  await expect(page.locator('[data-skill-preview-panel]')).toBeVisible()
})

test('手动创建 COMMIT unknown 保留刷新核对语义并禁止盲目重复创建', async ({ page }) => {
  await setup(page)
  let writes = 0
  await page.route('**/api/skills', async (route) => {
    if (route.request().method() !== 'POST') {
      await route.fulfill({ json: { success: true, code: 0, data: [builtin] } })
      return
    }
    writes++
    await route.fulfill({ status: 500, json: { success: false, message: '写入结果未知，请刷新核对', error: { error: 'DatabaseCommitOutcomeUnknown' } } })
  })
  await page.getByRole('button', { name: '技能', exact: true }).click()
  await page.getByRole('button', { name: '创建技能', exact: true }).click()
  await page.getByRole('menuitem', { name: '手动创建' }).click()
  const editor = page.getByRole('dialog')
  await editor.getByRole('textbox', { name: '技能标识', exact: true }).fill('manual-check')
  await editor.getByRole('textbox', { name: '触发场景描述', exact: true }).fill('检查文章')
  await editor.getByRole('textbox', { name: '技能正文说明', exact: true }).fill('检查正文')
  await editor.getByRole('button', { name: '发布生效', exact: true }).click()
  await expect(editor).toContainText('结果未知')
  await expect(editor.getByRole('button', { name: '发布生效', exact: true })).toBeDisabled()
  expect(writes).toBe(1)
  await editor.getByRole('button', { name: '重新加载', exact: true }).click()
  await expect(editor).toHaveCount(0)
})

test('start 后重新选择同一技能，已提交 error 保留下一条文字和技能', async ({ page }) => {
  await setup(page, true)
  await page.getByRole('button', { name: '技能', exact: true }).click()
  await page.getByRole('listitem').filter({ has: page.getByRole('heading', { name: draft.name }) }).getByRole('button', { name: '对话使用' }).click()
  await page.evaluate(() => {
    const original = window.fetch.bind(window)
    const encoder = new TextEncoder()
    let release!: () => void
    const ending = new Promise<void>((resolve) => {
      release = resolve
    })
    window.__releaseStream = release
    window.fetch = async (input, init) => {
      if (!String(input).includes('/api/chat/stream'))
        return original(input, init)
      const { conversationId } = JSON.parse(String(init?.body))
      return new Response(new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode(`${JSON.stringify({ type: 'start', conversationId, userMessageId: 'accepted-user', assistantMessageId: 'accepted-answer' })}\n`))
          void ending.then(() => {
            controller.enqueue(encoder.encode(`${JSON.stringify({ type: 'error', conversationId, assistantMessageId: 'accepted-answer', message: '本次生成失败', userMessagePersisted: true })}\n`))
            controller.close()
          })
        },
      }), { headers: { 'content-type': 'application/x-ndjson' } })
    }
  })
  const textarea = page.locator('textarea')
  await textarea.fill('检查标题')
  await textarea.press('Enter')
  await expect(page.locator('[data-composer-skills]')).toHaveCount(0)
  await expect(textarea).toHaveValue('')
  await textarea.fill('/article')
  await expect(page.getByRole('option', { name: /article-check/ })).toBeVisible()
  await textarea.press('Enter')
  await textarea.fill('检查标题')
  await expect(page.locator('[data-composer-skills]')).toContainText(draft.name)
  await page.evaluate(() => window.__releaseStream?.())
  await expect(page.locator('[data-app-message]')).toContainText('本次生成失败')
  await expect(textarea).toHaveValue('检查标题')
  await expect(page.locator('[data-composer-skills]')).toContainText(draft.name)
})

for (const action of ['toggle', 'delete'] as const) {
  test(`${action} 连点只发一次，明确失败后允许重试`, async ({ page }) => {
    await setup(page, true)
    let calls = 0
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    await page.route('**/api/skills/skill-1', async (route) => {
      calls++
      if (calls === 1) {
        await gate
        await route.fulfill({ status: 500, json: { success: false, message: '本次明确失败' } })
        return
      }
      await route.fulfill({ json: { success: true, code: 0, data: {} } })
    })
    await page.getByRole('button', { name: '技能', exact: true }).click()
    const card = page.getByRole('listitem').filter({ has: page.getByRole('heading', { name: draft.name }) })
    if (action === 'delete')
      await card.getByRole('button', { name: '删除', exact: true }).click()
    const button = card.getByRole('button', { name: action === 'delete' ? '确认删除' : '停用', exact: true })
    await button.dblclick()
    try {
      await expect.poll(() => calls).toBe(1)
    }
    finally { release() }
    await expect(page.getByRole('alert').last()).toContainText('本次明确失败')
    await button.click()
    await expect.poll(() => calls).toBe(2)
  })
}

test('发布连点只发送一次', async ({ page }) => {
  await setup(page)
  let calls = 0
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  await page.route('**/api/skills/skill-1/publish', async (route) => {
    calls++
    await gate
    await route.fulfill({ json: { success: true, code: 0, data: { ...draft, published: true, draft: false, hasDraft: false } } })
  })
  await page.getByRole('button', { name: '预览技能文件 article-check' }).click()
  await page.getByRole('button', { name: '发布到我的技能' }).dblclick()
  try {
    await expect.poll(() => calls).toBe(1)
  }
  finally { release() }
  await expect(page.locator('[data-skill-preview-panel]').getByRole('status').filter({ hasText: /^已发布$/ })).toHaveText('已发布')
})

test('保存草稿连点只发送一次', async ({ page }) => {
  await setup(page)
  let calls = 0
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  await page.route('**/api/skills/skill-1/draft', async (route) => {
    calls++
    await gate
    await route.fulfill({ json: { success: true, code: 0, data: { ...draft, files: route.request().postDataJSON().files, fingerprint: 'saved' } } })
  })
  await page.getByRole('button', { name: '预览技能文件 article-check' }).click()
  await page.locator('[data-skill-preview-panel]').getByRole('button', { name: '手动编辑' }).click()
  const editor = page.getByRole('dialog')
  await editor.getByRole('button', { name: '保存草稿', exact: true }).dblclick()
  try {
    await expect.poll(() => calls).toBe(1)
    await expect(editor.locator('#skill-body')).toBeDisabled()
  }
  finally { release() }
  await expect(editor.locator('#skill-body')).toBeEnabled()
})

test('手动创建连点只创建一次', async ({ page }) => {
  await setup(page, true)
  let calls = 0
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  await page.route('**/api/skills', async (route) => {
    if (route.request().method() !== 'POST') {
      await route.fallback()
      return
    }
    calls++
    await gate
    await route.fulfill({ json: { success: true, code: 0, data: { ...draft, published: true, draft: false } } })
  })
  await page.getByRole('button', { name: '技能', exact: true }).click()
  await page.getByRole('button', { name: '创建技能', exact: true }).click()
  await page.getByRole('menuitem', { name: /手动创建/ }).click()
  const editor = page.getByRole('dialog')
  await editor.locator('#skill-name').fill('click-check')
  await editor.locator('#skill-desc').fill('检查连点')
  await editor.locator('#skill-body').fill('检查一次')
  await editor.getByRole('button', { name: '发布生效', exact: true }).dblclick()
  try {
    await expect.poll(() => calls).toBe(1)
    await expect(editor.locator('#skill-body')).toBeDisabled()
  }
  finally { release() }
  await expect(editor).toHaveCount(0)
})

test('启停在途禁止进入编辑或创建，随后保存期间保持锁定', async ({ page }) => {
  await setup(page, true)
  let releaseToggle!: () => void, releaseSave!: () => void
  const toggleGate = new Promise<void>((resolve) => {
    releaseToggle = resolve
  })
  const saveGate = new Promise<void>((resolve) => {
    releaseSave = resolve
  })
  let toggleStarted = false
  let saveStarted = false
  await page.route('**/api/skills/skill-1', async (route) => {
    toggleStarted = true
    await toggleGate
    await route.fulfill({ json: { success: true, code: 0, data: {} } })
  })
  await page.route('**/api/skills/skill-1/draft', async (route) => {
    saveStarted = true
    await saveGate
    await route.fulfill({ json: { success: true, code: 0, data: { ...draft, published: true, files: route.request().postDataJSON().files, fingerprint: 'saved' } } })
  })
  await page.route('**/api/skills/skill-1/publish', route => route.fulfill({ json: { success: true, code: 0, data: { ...draft, published: true, draft: false } } }))
  await page.getByRole('button', { name: '技能', exact: true }).click()
  const card = page.getByRole('listitem').filter({ has: page.getByRole('heading', { name: draft.name }) })
  await card.getByRole('button', { name: '停用', exact: true }).click()
  await expect.poll(() => toggleStarted).toBe(true)
  try {
    await expect(card.getByRole('button', { name: '手动编辑', exact: true })).toBeDisabled()
    await expect(page.getByRole('button', { name: '创建技能', exact: true })).toBeDisabled()
    releaseToggle()
    await card.getByRole('button', { name: '手动编辑', exact: true }).click()
    const editor = page.getByRole('dialog')
    const body = editor.locator('#skill-body')
    await expect(body).toBeEnabled()
    await body.fill('保存 A')
    await editor.getByRole('button', { name: '保存修改', exact: true }).click()
    await expect.poll(() => saveStarted).toBe(true)
    await expect(body).toBeDisabled()
    await expect(editor.getByRole('button', { name: '取消', exact: true })).toBeDisabled()
    await expect(body).toHaveValue('保存 A')
    releaseSave()
    await expect(editor).toHaveCount(0)
  }
  finally {
    releaseToggle()
    releaseSave()
  }
})

test('保存修改连点只有一次保存和一次发布', async ({ page }) => {
  await setup(page, true)
  let saves = 0
  let publishes = 0
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  await page.route('**/api/skills/skill-1/draft', async (route) => {
    saves++
    await gate
    await route.fulfill({ json: { success: true, code: 0, data: { ...draft, published: true, files: route.request().postDataJSON().files, fingerprint: 'saved' } } })
  })
  await page.route('**/api/skills/skill-1/publish', async (route) => {
    publishes++
    await route.fulfill({ json: { success: true, code: 0, data: { ...draft, published: true, draft: false } } })
  })
  await page.getByRole('button', { name: '技能', exact: true }).click()
  await page.getByRole('button', { name: '手动编辑', exact: true }).click()
  const editor = page.getByRole('dialog')
  await editor.getByRole('button', { name: '保存修改', exact: true }).dblclick()
  try {
    await expect.poll(() => saves).toBe(1)
    await expect(editor.locator('#skill-body')).toBeDisabled()
    expect(publishes).toBe(0)
  }
  finally { release() }
  await expect(editor).toHaveCount(0)
  expect(saves).toBe(1)
  expect(publishes).toBe(1)
})

for (const switchBeforeResponse of [false, true]) {
  test(`删除会话响应${switchBeforeResponse ? '迟到时保留其他会话选择' : '切换当前会话时清理技能选择'}`, async ({ page }) => {
    await setup(page, true)
    const json = (data: unknown) => ({ json: { success: true, code: 0, data } })
    await page.route('**/api/conversations?*', route => route.fulfill(json({ items: [
      { id: CONVERSATION_ID, title: '会话 A', createdAt: '2026-10-12T00:00:00Z', updatedAt: '2026-10-12T00:00:00Z' },
      { id: 'conversation-b', title: '会话 B', createdAt: '2026-10-12T00:00:00Z', updatedAt: '2026-10-12T00:00:00Z' },
    ], nextCursor: null })))
    await page.route('**/api/conversations/conversation-b/messages', route => route.fulfill(json([])))
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    await page.route(`**/api/conversations/${CONVERSATION_ID}`, async (route) => {
      await gate
      await route.fulfill(json({ deleted: true }))
    })
    await page.reload()
    const input = page.getByRole('textbox').first()
    await input.fill('/article')
    await input.press('Enter')
    await expect(page.locator('[data-composer-skills]')).toContainText(draft.name)
    const row = page.getByRole('button', { name: '会话 A', exact: true }).locator('..')
    await row.getByRole('button', { name: '对话选项', exact: true }).click()
    await row.getByRole('button', { name: '删除对话', exact: true }).click()
    try {
      if (switchBeforeResponse) {
        await page.getByRole('button', { name: '会话 B', exact: true }).click()
        await expect(input).toBeEnabled()
        await input.fill('/article')
        await input.press('Enter')
        await input.fill('B 的下一条消息')
      }
    }
    finally { release() }
    await expect(page.getByRole('button', { name: '会话 A', exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: '会话 B', exact: true })).toHaveAttribute('aria-current', 'page')
    if (switchBeforeResponse) {
      await expect(page.locator('[data-composer-skills]')).toContainText(draft.name)
      await expect(input).toHaveValue('B 的下一条消息')
    }
    else {
      await expect(page.locator('[data-composer-skills]')).toHaveCount(0)
      await expect(input).toHaveValue('')
    }
  })
}

test('系统创建技能停用后聊天创建明确提示不可用，手动创建仍可打开', async ({ page }) => {
  await setup(page, true)
  await page.getByRole('button', { name: '技能', exact: true }).click()
  await page.route('**/api/skills', route => route.fulfill({ json: { success: true, code: 0, data: [] } }))
  await page.getByRole('button', { name: '创建技能', exact: true }).click()
  await page.getByRole('menuitem', { name: '对话创建', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('该技能已停用或不可用')
  await expect(page).toHaveURL(/\/skills$/)
  await page.getByRole('button', { name: '创建技能', exact: true }).click()
  await page.getByRole('menuitem', { name: '手动创建', exact: true }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
})
