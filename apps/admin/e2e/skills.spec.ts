import type { AdminSkillDetail } from '@agent/contracts'
import { validateSkillPackage } from '@agent/skills'
import { expect, test } from '@playwright/test'
import { E2E_ADMIN } from './fixtures'

const creatorId = 'builtin:skill-creator'
function initial(id = 'system-one'): AdminSkillDetail {
  return {
    id,
    name: id === creatorId ? 'skill-creator' : 'shared-check',
    description: '检查共享技能',
    builtin: true,
    enabled: true,
    published: true,
    hasDraft: false,
    draft: false,
    conversationId: null,
    updatedAt: '2026-10-12T00:00:00Z',
    createdAt: '2026-10-10T00:00:00Z',
    usageCount: 0,
    examples: [],
    fingerprint: 'initial',
    files: [{ path: 'SKILL.md', encoding: 'utf8', content: `---\nname: ${id === creatorId ? 'skill-creator' : 'shared-check'}\ndescription: 检查共享技能\nlicense: MIT\n---\n\n主技能正文` }, { path: 'references/check.md', encoding: 'utf8', content: '只属于参考文件的内容<script>window.badSkill=true</script>' }, { path: 'assets/sample.woff', encoding: 'base64', content: 'AQID' }],
  }
}
const json = (data: unknown) => ({ json: { success: true, code: 0, data } })

async function setup(page: import('@playwright/test').Page) {
  let rows = [initial(creatorId), initial()]
  const writes: Array<{ method: string, body: unknown }> = []
  await page.route('**/api/auth/me', route => route.fulfill(json(E2E_ADMIN)))
  await page.route('**/api/admin/skills**', async (route) => {
    const request = route.request()
    const parts = new URL(request.url()).pathname.split('/').slice(4).map(decodeURIComponent)
    const id = parts[0]
    if (request.method() === 'GET') {
      await route.fulfill(json(id ? rows.find(row => row.id === id) : rows.map(({ files, fingerprint, draft, ...summary }) => summary)))
      return
    }
    const body = request.postData() ? request.postDataJSON() : undefined
    writes.push({ method: request.method(), body })
    if (request.method() === 'DELETE') {
      rows = rows.filter(row => row.id !== id)
      await route.fulfill(json({ id }))
      return
    }
    if (parts[1] === 'toggle') {
      rows = rows.map(row => row.id === id ? { ...row, enabled: body.enabled } : row)
      await route.fulfill(json({ id, enabled: body.enabled }))
      return
    }
    const pkg = validateSkillPackage(body.files)
    const saved = { ...initial(id || 'created-skill'), ...pkg }
    rows = id ? rows.map(row => row.id === id ? saved : row) : [...rows, saved]
    await route.fulfill(json(saved))
  })
  await page.goto('/skills')
  await expect(page.getByRole('cell', { name: 'shared-check', exact: true })).toBeVisible()
  return { writes }
}

test('系统技能真实页面经 HTTP 创建、编辑、预览资源、删除，保护只作用于 creator', async ({ page }) => {
  const { writes } = await setup(page)
  await expect(page.getByText('前端 UI 演示环境', { exact: false })).toHaveCount(0)
  const creator = page.getByRole('row').filter({ has: page.getByRole('cell', { name: /skill-creator/ }) })
  await expect(creator.getByRole('button', { name: /^删\s*除$/ })).toBeDisabled()
  await page.getByRole('button', { name: /新建技能/ }).click()
  const modal = page.getByRole('dialog')
  await modal.locator('#editor-skill-name').fill('new-public-skill')
  await modal.locator('#editor-skill-desc').fill('用途: 标题检查 # 保留原值')
  await modal.locator('textarea').last().fill('检查标题')
  await modal.getByRole('button', { name: '保存修改' }).dblclick()
  await expect(modal).toHaveCount(0)
  expect(writes.filter(row => row.method === 'POST')).toHaveLength(1)
  const custom = page.getByRole('row').filter({ has: page.getByRole('cell', { name: 'shared-check', exact: true }) })
  await custom.getByRole('button', { name: /^查\s*看$/ }).click()
  await page.getByText('references/check.md', { exact: true }).click()
  await expect(page.getByText('只属于参考文件的内容<script>window.badSkill=true</script>', { exact: false })).toBeVisible()
  expect(await page.evaluate(() => 'badSkill' in window)).toBe(false)
  await page.getByText('assets/sample.woff', { exact: true }).click()
  await expect(page.getByText('这是一个二进制资源文件，可通过上方按钮下载查看。')).toBeVisible()
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: /下载文件/ }).first().click()
  expect((await downloadPromise).suggestedFilename()).toBe('sample.woff')
  await page.getByRole('button', { name: 'Close', exact: true }).click()
  await custom.getByRole('button', { name: /^编\s*辑$/ }).click()
  await modal.locator('#editor-skill-desc').fill('更新后的描述')
  await modal.getByRole('button', { name: '保存修改' }).click()
  await expect(modal).toHaveCount(0)
  const update = writes.find(row => row.method === 'PATCH')!.body as { files: Array<{ content: string, path: string }>, expectedFingerprint: string }
  expect(update.expectedFingerprint).toBe('initial')
  expect(update.files.find(file => file.path === 'SKILL.md')?.content).toContain('license: MIT')
  expect(update.files.some(file => file.path === 'references/check.md')).toBe(true)
  await page.reload()
  await expect(page.getByText('更新后的描述', { exact: true })).toBeVisible()
  await custom.getByRole('button', { name: /^删\s*除$/ }).click()
  await page.getByRole('button', { name: '确认删除', exact: true }).click()
  await expect(custom).toHaveCount(0)
})

test('慢启停互斥编辑创建，慢保存禁用字段和关闭，双击只请求一次', async ({ page }) => {
  await setup(page)
  let releaseToggle!: () => void
  const toggleGate = new Promise<void>((resolve) => {
    releaseToggle = resolve
  })
  await page.route('**/api/admin/skills/system-one/toggle', async (route) => {
    await toggleGate
    await route.fulfill(json({ id: 'system-one', enabled: false }))
  })
  const custom = page.getByRole('row').filter({ has: page.getByRole('cell', { name: 'shared-check', exact: true }) })
  await custom.getByRole('switch').click()
  try {
    await expect(custom.getByRole('button', { name: /^编\s*辑$/ })).toBeDisabled()
    await expect(page.getByRole('button', { name: /新建技能/ })).toBeDisabled()
  }
  finally { releaseToggle() }
  await custom.getByRole('button', { name: /^编\s*辑$/ }).click()
  let releaseSave!: () => void
  const saveGate = new Promise<void>((resolve) => {
    releaseSave = resolve
  })
  let saves = 0
  await page.route('**/api/admin/skills/system-one', async (route) => {
    saves++
    await saveGate
    await route.fulfill(json(initial()))
  })
  const modal = page.getByRole('dialog')
  await modal.getByRole('button', { name: '保存修改' }).dblclick()
  try {
    await expect.poll(() => saves).toBe(1)
    await expect(modal.locator('#editor-skill-desc')).toBeDisabled()
    await expect(modal.getByRole('button', { name: /^取\s*消$/ })).toBeDisabled()
  }
  finally { releaseSave() }
  await expect(modal).toHaveCount(0)
})

test('提交未知不关闭表单、不重复新建；可显式关闭并刷新核对', async ({ page }) => {
  await setup(page)
  let calls = 0
  await page.route('**/api/admin/skills', async (route) => {
    if (route.request().method() !== 'POST') {
      await route.fallback()
      return
    }
    calls++
    await route.fulfill({ status: 500, json: { success: false, message: '写入结果未知，请刷新核对后再操作；不要直接重复创建', error: { error: 'DatabaseCommitOutcomeUnknown' } } })
  })
  await page.getByRole('button', { name: /新建技能/ }).click()
  const modal = page.getByRole('dialog')
  await modal.locator('#editor-skill-name').fill('unknown-check')
  await modal.locator('#editor-skill-desc').fill('检查未知提交')
  await modal.locator('textarea').last().fill('正文')
  await modal.getByRole('button', { name: '保存修改' }).click()
  await expect(modal.getByText(/写入结果未知/)).toBeVisible()
  await expect(modal.getByRole('button', { name: '保存修改' })).toBeDisabled()
  expect(calls).toBe(1)
  await modal.getByRole('button', { name: '关闭并刷新核对' }).click()
  await expect(modal).toHaveCount(0)
})
