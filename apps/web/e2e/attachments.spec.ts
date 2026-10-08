import type { Page } from '@playwright/test'
import { Buffer } from 'node:buffer'
import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'

import { CONVERSATION_ID, installApiRoutes, installBrowserStubs, toNdjsonLines } from './fixtures'

/** 桩住上传与移除接口：每次上传返回一个递增的附件 id，记录被移除的 id。 */
async function installAttachmentRoutes(page: Page) {
  const removed: string[] = []
  const idsByName = new Map<string, string>()
  let next = 0

  await page.route('**/api/attachments', async (route) => {
    // id 按请求到达的顺序分配；回得慢一点，「上传中」的状态才看得到。
    const id = `att-${++next}`
    const name = /name="name"\r?\n\r?\n([^\r\n]+)/.exec(route.request().postDataBuffer()!.toString())?.[1]
    if (name)
      idsByName.set(name, id)
    await new Promise(resolve => setTimeout(resolve, 300))
    await route.fulfill({ json: { success: true, code: 0, message: 'ok', data: { id, kind: 'file', name: 'uploaded', bytes: 1 } } })
  })
  await page.route('**/api/attachments/*', async (route) => {
    removed.push(new URL(route.request().url()).pathname.split('/').at(-1)!)
    await route.fulfill({ status: 204 })
  })
  return { removed, idsByName }
}

/** 在页面里画一张指定尺寸的 PNG：尺寸可控，用来核对消息里的占位大小。 */
async function pngOf(page: Page, width: number, height: number): Promise<Buffer> {
  const dataUrl = await page.evaluate(([w, h]) => {
    const canvas = Object.assign(document.createElement('canvas'), { width: w, height: h })
    const context = canvas.getContext('2d')!
    context.fillStyle = '#c9b79c'
    context.fillRect(0, 0, w!, h!)
    return canvas.toDataURL('image/png')
  }, [width, height])
  return Buffer.from(dataUrl.split(',')[1]!, 'base64')
}

test('附件：添加、校验、移除、发送后在消息里展示并可预览', async ({ page }) => {
  await installApiRoutes(page, () => [])
  const { removed, idsByName } = await installAttachmentRoutes(page)
  await installBrowserStubs(page, { lines: toNdjsonLines(), holdBeforeIndex: -1 })
  await page.goto('/workspace')
  await expect(page.getByRole('textbox').first()).toBeVisible()

  // 加号先开菜单，「添加图片或文件」才打开系统文件选择。
  await page.getByRole('button', { name: '添加内容' }).click()
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('menuitem', { name: '添加图片或文件' }).click()
  await chooser
  await expect(page.getByRole('menu')).toHaveCount(0)

  const picker = page.locator('input[type=file]')
  const pending = page.getByRole('list', { name: '待发送的附件' })
  const send = page.getByRole('button', { name: /发送|附件/ }).and(page.locator('[data-composer-primary]'))

  await picker.setInputFiles([
    { name: '首页截图.png', mimeType: 'image/png', buffer: await pngOf(page, 1600, 900) },
    { name: '9月流量报表.xlsx', mimeType: 'application/octet-stream', buffer: Buffer.from('xlsx') },
    { name: '需求说明.md', mimeType: 'text/markdown', buffer: Buffer.from('# 需求说明\n\n首页改版的三个目标。') },
    { name: '合同.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4') },
  ])
  await expect(pending.getByRole('listitem')).toHaveCount(4)
  // 还在上传：发送按钮出现但点了不发。
  await expect(send).toHaveAttribute('aria-disabled', 'true')
  await expect(send).not.toHaveAttribute('aria-disabled', 'true')

  await picker.setInputFiles({ name: '照片.heic', mimeType: 'image/heic', buffer: Buffer.from('heic') })
  await expect(page.getByText('暂不支持这种文件：照片.heic')).toBeVisible()
  // 同名同大小的不重复收。
  await picker.setInputFiles({ name: '合同.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4') })
  await expect(page.getByText('合同.pdf 已经添加过了')).toBeVisible()
  await expect(pending.getByRole('listitem')).toHaveCount(4)
  await pending.getByRole('button', { name: '移除 合同.pdf' }).click()
  await expect(pending.getByRole('listitem')).toHaveCount(3)

  await page.getByRole('textbox').first().fill('帮我看看这些')
  await send.click()

  const turn = page.locator('[data-agent-user-turn-id="user-live"]')
  const image = turn.getByRole('button', { name: '预览 首页截图.png' })
  await expect(image).toBeVisible()
  await expect(turn.getByText('帮我看看这些')).toBeVisible()
  // 每个文件都能下载：没有预览的整行是下载链接，能预览的末尾另有一个。
  await expect(turn.getByRole('link', { name: '下载 9月流量报表.xlsx' })).toHaveAttribute('download', '9月流量报表.xlsx')
  await expect(turn.getByRole('link', { name: '下载 需求说明.md' })).toHaveAttribute('download', '需求说明.md')
  // 发出后输入框里的附件清空。
  await expect(pending).toHaveCount(0)
  // ID 分配按上传到达顺序，不能假定读图片尺寸最快；发送仍按用户看到的顺序。
  expect(await page.evaluate(() => window.__chatRequests)).toEqual([expect.objectContaining({ message: '帮我看看这些', attachmentIds: ['首页截图.png', '9月流量报表.xlsx', '需求说明.md'].map(name => idsByName.get(name)) })])
  expect(removed).toEqual([idsByName.get('合同.pdf')])

  // 单张图片按原比例缩进 320 以内并占位。
  const box = await image.boundingBox()
  expect([Math.round(box!.width), Math.round(box!.height)]).toEqual([320, 180])

  // 图片全屏看。
  await image.click()
  await expect(page.getByRole('dialog', { name: '首页截图.png' }).getByRole('img', { name: '首页截图.png' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)

  // 文档在右侧面板里渲染，关闭后焦点回到那一行。
  const openMarkdown = turn.getByRole('button', { name: '预览 需求说明.md' })
  await openMarkdown.click()
  const panel = page.locator('[data-attachment-preview-panel]')
  await expect(panel.getByRole('heading', { name: '需求说明', exact: true, level: 1 })).toBeVisible()
  await panel.getByRole('button', { name: '关闭预览' }).click()
  await expect(panel).toHaveCount(0)
  await expect(openMarkdown).toBeFocused()
})

test('xlsx 与 docx 在右侧面板渲染：多工作表与日期可读，文档里的危险链接和内嵌脚本不生效', async ({ page }) => {
  await installApiRoutes(page, () => [])
  await installAttachmentRoutes(page)
  await installBrowserStubs(page, { lines: toNdjsonLines(), holdBeforeIndex: -1 })
  await page.goto('/workspace')
  await expect(page.getByRole('textbox').first()).toBeVisible()

  await page.locator('input[type=file]').setInputFiles(['sheets.xlsx', 'unsafe.docx'].map(name => ({
    name,
    mimeType: 'application/octet-stream',
    buffer: readFileSync(new URL(`./files/${name}`, import.meta.url)),
  })))
  const send = page.locator('[data-composer-primary]')
  await expect(send).not.toHaveAttribute('aria-disabled', 'true')
  await send.click()

  const turn = page.locator('[data-agent-user-turn-id="user-live"]')
  const panel = page.locator('[data-attachment-preview-panel]')

  await turn.getByRole('button', { name: '预览 sheets.xlsx' }).click()
  await expect(panel.getByRole('columnheader', { name: '日期' })).toBeVisible()
  // 日期单元格按本地日期显示，不是序列号；数字去掉浮点尾巴。
  await expect(panel.getByRole('cell', { name: '2026/9/1', exact: true })).toBeVisible()
  await expect(panel.getByRole('cell', { name: '0.3', exact: true })).toBeVisible()
  await panel.getByRole('tab', { name: '渠道' }).click()
  await expect(panel.getByRole('cell', { name: '搜索', exact: true })).toBeVisible()

  await turn.getByRole('button', { name: '预览 unsafe.docx' }).click()
  const document = panel.frameLocator('[data-docx-preview]')
  await expect(document.getByText('会议纪要正文')).toBeVisible()
  await expect(document.getByRole('link', { name: '安全链接' })).toHaveAttribute('target', '_blank')
  await expect(document.getByRole('link', { name: '安全链接' })).toHaveAttribute('rel', 'noopener noreferrer')
  // javascript: 链接被去掉 href（不再是链接），内嵌 HTML 片段不渲染。
  await expect(document.getByRole('link', { name: '危险链接' })).toHaveCount(0)
  await document.getByText('危险链接').click()
  await expect(document.locator('iframe')).toHaveCount(0)
  expect(await page.evaluate(() => '__docxPwned' in window)).toBe(false)
})

test('刷新后附件从接口还原：图片用缩略图地址并按尺寸占位，文档从后端读内容预览；只有附件的消息没有文字气泡', async ({ page }) => {
  await installApiRoutes(page, () => [{
    id: 'user-1',
    conversationId: CONVERSATION_ID,
    role: 'USER',
    content: '',
    status: 'COMPLETED',
    createdAt: '2026-10-08T08:00:00.000Z',
    updatedAt: '2026-10-08T08:00:00.000Z',
    attachments: [
      { id: 'att-image', kind: 'image', name: '首页.png', bytes: 2048, width: 1600, height: 900 },
      { id: 'att-doc', kind: 'file', name: '需求.md', bytes: 20 },
    ],
  }])
  await installBrowserStubs(page, { lines: [], holdBeforeIndex: -1 })
  const png = await pngOf(await page.context().newPage(), 16, 9)
  await page.route('**/api/attachments/att-image/content**', route => route.fulfill({ contentType: 'image/png', body: png }))
  await page.route('**/api/attachments/att-doc/content', route => route.fulfill({ contentType: 'text/plain; charset=utf-8', body: '# 来自后端的需求' }))
  await page.goto('/workspace')

  const turn = page.locator('[data-agent-user-turn-id="user-1"]')
  const image = turn.getByRole('button', { name: '预览 首页.png' })
  await expect(image.getByRole('img')).toHaveAttribute('src', '/api/attachments/att-image/content?variant=thumb')
  // 尺寸来自记录：图片还没加载完也是 320×180。
  const box = await image.boundingBox()
  expect([Math.round(box!.width), Math.round(box!.height)]).toEqual([320, 180])
  await expect(turn.getByRole('link', { name: '下载 需求.md' })).toHaveAttribute('href', '/api/attachments/att-doc/content')
  await expect(turn.locator('.bg-agent-user-bubble')).toHaveCount(0)

  await turn.getByRole('button', { name: '预览 需求.md' }).click()
  await expect(page.locator('[data-attachment-preview-panel]').getByRole('heading', { name: '来自后端的需求' })).toBeVisible()
})

test('发送确认前锁住附件，确认后消息仍能用原地址预览', async ({ page }) => {
  await installApiRoutes(page, () => [])
  const { removed } = await installAttachmentRoutes(page)
  await installBrowserStubs(page, { lines: toNdjsonLines(), holdBeforeIndex: 0 })
  await page.goto('/workspace')
  await expect(page.getByRole('textbox').first()).toBeVisible()
  await page.locator('input[type=file]').setInputFiles({ name: '保留.md', mimeType: 'text/markdown', buffer: Buffer.from('# 正文保留') })
  await expect(page.locator('[data-composer-primary]')).not.toHaveAttribute('aria-disabled', 'true')
  await page.locator('[data-composer-primary]').click()
  await expect(page.getByRole('button', { name: '移除 保留.md' })).toBeDisabled()
  await page.evaluate(() => window.__releaseStream?.())
  const preview = page.getByRole('button', { name: '预览 保留.md' })
  await expect(preview).toBeVisible()
  await expect(page.getByRole('list', { name: '待发送的附件' })).toHaveCount(0)
  expect(removed).toEqual([])
  await preview.click()
  await expect(page.locator('[data-attachment-preview-panel]').getByRole('heading', { name: '正文保留' })).toBeVisible()
})

test('DOCX 的样式只能影响文档，不得隐藏工作区页面', async ({ page }) => {
  await installApiRoutes(page, () => [])
  await installAttachmentRoutes(page)
  await installBrowserStubs(page, { lines: toNdjsonLines(), holdBeforeIndex: -1 })
  await page.goto('/workspace')
  await expect(page.getByRole('textbox').first()).toBeVisible()
  await page.locator('input[type=file]').setInputFiles({
    name: 'css-escape.docx',
    mimeType: 'application/octet-stream',
    buffer: readFileSync(new URL('./files/css-escape.docx', import.meta.url)),
  })
  const send = page.locator('[data-composer-primary]')
  await expect(send).not.toHaveAttribute('aria-disabled', 'true')
  await send.click()
  await page.getByRole('button', { name: '预览 css-escape.docx' }).click()
  const panel = page.locator('[data-attachment-preview-panel]')
  await expect(panel).toHaveAttribute('aria-busy', 'false')
  await expect(page.locator('body')).toBeVisible()
  await expect(panel.getByRole('button', { name: '关闭预览' })).toBeVisible()
  await expect(panel.locator('[data-docx-preview]')).toHaveAttribute('sandbox', 'allow-popups allow-popups-to-escape-sandbox')
})

test('选中的模型不能看图片时带图不让发送，移除图片后恢复', async ({ page }) => {
  await installApiRoutes(page, () => [])
  await installBrowserStubs(page, { lines: toNdjsonLines(), holdBeforeIndex: -1 })
  await installAttachmentRoutes(page)
  await page.route('**/api/llm/models', route => route.fulfill({
    json: { success: true, code: 0, message: 'ok', data: [{ id: 'text-only', displayName: '纯文字模型', reasoningEffort: null, reasoningEffortOptions: [], isDefault: true, supportsImageInput: false }] },
  }))
  await page.goto('/workspace')
  await expect(page.getByRole('textbox').first()).toBeVisible()

  await page.locator('input[type=file]').setInputFiles([
    { name: 'a.png', mimeType: 'image/png', buffer: await pngOf(page, 40, 40) },
    { name: 'b.md', mimeType: 'text/markdown', buffer: Buffer.from('文字') },
  ])
  const send = page.locator('[data-composer-primary]')
  await expect(send).toHaveAccessibleName('当前模型不能看图片，换一个模型或移除图片后再发送')
  await expect(send).toHaveAttribute('aria-disabled', 'true')
  // Playwright 不点 aria-disabled 的元素：强制点一下，确认真的没有发出请求。
  await send.click({ force: true })
  expect(await page.evaluate(() => window.__chatRequests)).toEqual([])

  await page.getByRole('button', { name: '移除 a.png' }).click()
  await expect(send).toHaveAccessibleName('发送消息')
  await expect(send).not.toHaveAttribute('aria-disabled', 'true')
})
