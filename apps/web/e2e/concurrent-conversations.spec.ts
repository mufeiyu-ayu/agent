import type { ConversationMessage } from '@agent/contracts'
import type { Page, Route } from '@playwright/test'

import assert from 'node:assert/strict'
import { test } from '@playwright/test'

import { CONVERSATION_ID, installApiRoutes } from './fixtures'

interface ControlledFlow {
  conversationId: string
  aborted: boolean
  message: string
  events: Record<string, unknown>[]
  closed: boolean
  controller: ReadableStreamDefaultController<Uint8Array>
  headers: () => void
}

declare global {
  interface Window {
    __concurrentFlows: ControlledFlow[]
    __pushConcurrent: (index: number, event: Record<string, unknown>) => void
    __endConcurrent: (index: number, fail?: boolean) => void
  }
}

const json = (data: unknown) => ({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, code: 0, message: 'ok', data }) })
const conversation = (id: string, title: string) => ({ id, title, createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z' })

/** 每条流分别推事件、响应头、EOF和取消；不连接模型、不共用全局release。 */
async function setup(page: Page, options: { holdHeaders?: boolean, ignoreAbort?: boolean } = {}) {
  await installApiRoutes(page, () => [])
  await page.route('**/api/conversations?*', route => route.fulfill(json({ items: [conversation(CONVERSATION_ID, '会话 A'), conversation('conversation-b', '会话 B')], nextCursor: null })))
  await page.route('**/api/conversations/*/messages', async (route) => {
    const id = new URL(route.request().url()).pathname.split('/').at(-2)!
    const messages = await page.evaluate((id) => {
      const flow = window.__concurrentFlows.find(flow => flow.conversationId === id)
      const start = flow?.events.find(event => event.type === 'start')
      if (!flow || !start)
        return []
      const index = window.__concurrentFlows.indexOf(flow)
      const done = flow.events.find(event => event.type === 'done')
      const failure = flow.events.find(event => event.type === 'error')
      const time = '2026-10-01T00:01:00Z'
      return [
        { id: start.userMessageId, conversationId: id, role: 'USER', content: flow.message, status: 'COMPLETED', createdAt: time, updatedAt: time },
        { id: `assistant-${index}`, conversationId: id, role: 'ASSISTANT', content: done?.content ?? failure?.message ?? flow.events.filter(event => event.type === 'delta').map(event => event.contentDelta).join(''), status: done ? 'COMPLETED' : failure ? 'FAILED' : 'STREAMING', createdAt: time, updatedAt: time },
      ]
    }, id)
    await route.fulfill(json(messages))
  })
  let created = 0
  await page.route('**/api/conversations', route => route.fulfill(json(conversation(`created-${++created}`, route.request().postDataJSON().title))))
  await page.addInitScript(({ holdHeaders, ignoreAbort }) => {
    localStorage.setItem('agent-web-locale', 'zh-CN')
    const originalFetch = window.fetch.bind(window)
    window.__concurrentFlows = []
    const encoder = new TextEncoder()
    window.__pushConcurrent = (index, event) => {
      const flow = window.__concurrentFlows[index]!
      if (!flow.closed) {
        flow.events.push(event)
        flow.controller.enqueue(encoder.encode(`${JSON.stringify({ conversationId: flow.conversationId, assistantMessageId: `assistant-${index}`, ...event })}\n`))
      }
    }
    window.__endConcurrent = (index, fail = false) => {
      const flow = window.__concurrentFlows[index]!
      if (flow.closed)
        return
      flow.closed = true
      if (fail)
        flow.controller.error(new Error('受控网络异常'))
      else
        flow.controller.close()
    }
    window.fetch = async (input, init) => {
      if (String(input) !== '/api/chat/stream')
        return originalFetch(input, init)
      const index = window.__concurrentFlows.length
      let rejectHeaders: (error: unknown) => void
      let releaseHeaders: () => void
      const headers = new Promise<void>((resolve, reject) => {
        releaseHeaders = resolve
        rejectHeaders = reject
      })
      const payload = JSON.parse(String(init?.body))
      const flow = { conversationId: payload.conversationId, message: payload.message, events: [], aborted: false, closed: false } as unknown as ControlledFlow
      const body = new ReadableStream<Uint8Array>({
        start(controller) { flow.controller = controller },
        cancel() { flow.closed = true },
      })
      flow.headers = releaseHeaders!
      window.__concurrentFlows.push(flow)
      init?.signal?.addEventListener('abort', () => {
        flow.aborted = true
        // 专门的错代次用例故意模拟不服从取消的旧上游，其余桩都响应signal。
        if (ignoreAbort && index === 0)
          return
        rejectHeaders!(new DOMException('stopped', 'AbortError'))
        if (!flow.closed) {
          flow.closed = true
          flow.controller.error(new DOMException('stopped', 'AbortError'))
        }
      }, { once: true })
      if (!holdHeaders)
        releaseHeaders!()
      await headers
      return new Response(body, { headers: { 'Content-Type': 'application/x-ndjson' } })
    }
  }, options)
  await page.goto('/workspace')
  await page.getByRole('button', { name: '会话 A', exact: true }).waitFor()
}

async function send(page: Page, text: string, count: number) {
  await page.getByRole('textbox').first().fill(text)
  await page.getByRole('button', { name: '发送消息', exact: true }).click()
  await poll(page, 'length', count)
}

async function poll(page: Page, field: 'length' | 'aborted' | 'conversationId', expected: number | boolean[] | string[]) {
  const result = await page.waitForFunction(({ field, expected }) => {
    const flows = window.__concurrentFlows
    const actual = field === 'length' ? flows.length : flows.map(flow => flow[field])
    return JSON.stringify(actual) === JSON.stringify(expected)
  }, { field, expected })
  assert.equal(await result.jsonValue(), true)
}

async function push(page: Page, index: number, event: Record<string, unknown>) {
  await page.evaluate(({ index, event }) => window.__pushConcurrent(index, event), { index, event })
}

async function start(page: Page, index: number) {
  await push(page, index, { type: 'start', userMessageId: `user-${index}` })
}

async function done(page: Page, index: number, content: string) {
  await push(page, index, { type: 'done', content, generatedAt: '2026-10-01T01:00:00Z' })
}

async function visible(page: Page, text: string) {
  await page.getByText(text, { exact: true }).filter({ visible: true }).first().waitFor()
  assert.equal(await page.getByText(text, { exact: true }).filter({ visible: true }).first().isVisible(), true)
}

async function select(page: Page, title: string) {
  await page.getByRole('button', { name: title, exact: true }).click()
}

test('AC-01/02/04：等待响应头时新建和切换不取消，同会话防重复、跨会话无节流，停止只取消当前请求', async ({ page }) => {
  await setup(page, { holdHeaders: true })
  await send(page, 'A 请求', 1)
  await page.getByRole('textbox').first().press('Enter')
  assert.equal(await page.getByRole('button', { name: '停止生成', exact: true }).isVisible(), true)
  await page.getByRole('button', { name: '新建对话', exact: true }).click()
  assert.equal(await page.getByRole('button', { name: '停止生成', exact: true }).count(), 0)
  await select(page, '会话 B')
  await send(page, 'B 请求', 2)
  await page.getByRole('textbox').first().press('Enter')
  assert.deepEqual(await page.evaluate(() => window.__concurrentFlows.map(flow => flow.aborted)), [false, false])
  await select(page, '会话 A')
  await page.getByRole('button', { name: '停止生成', exact: true }).click()
  await visible(page, '已停止生成')
  assert.deepEqual(await page.evaluate(() => window.__concurrentFlows.map(flow => flow.aborted)), [true, false])
  await select(page, '会话 B')
  await page.evaluate(() => window.__concurrentFlows[1]!.headers())
  await start(page, 1)
  await done(page, 1, 'B 正常完成')
  await visible(page, 'B 正常完成')
  assert.equal(await page.getByRole('button', { name: '停止生成', exact: true }).count(), 0)
  assert.equal(await page.evaluate(() => window.__concurrentFlows.length), 2)
})

test('AC-03/04：交错正文、思考与工具独立，切回最新进度，停止已出正文的 A 不影响 B', async ({ page }) => {
  await setup(page)
  await send(page, 'A 请求', 1)
  await start(page, 0)
  await push(page, 0, { type: 'reasoning_delta', delta: 'A 独立思考。' })
  await push(page, 0, { type: 'tool_started', callId: 'a-tool', toolName: 'web_search', query: 'A 独立搜索' })
  await select(page, '会话 B')
  await send(page, 'B 请求', 2)
  await start(page, 1)
  await push(page, 1, { type: 'reasoning_delta', delta: 'B 独立思考。' })
  await push(page, 1, { type: 'tool_started', callId: 'b-tool', toolName: 'web_search', query: 'B 独立搜索' })
  await push(page, 0, { type: 'tool_finished', callId: 'a-tool', ok: true })
  await push(page, 0, { type: 'delta', contentDelta: 'A 第一段' })
  await push(page, 1, { type: 'tool_finished', callId: 'b-tool', ok: true })
  await push(page, 1, { type: 'delta', contentDelta: 'B 第一段' })
  await visible(page, 'B 第一段')
  assert.equal(await page.getByText('A 第一段', { exact: true }).count(), 0)
  await select(page, '会话 A')
  await visible(page, 'A 第一段')
  await page.getByRole('button', { name: '停止生成', exact: true }).click()
  await visible(page, '已停止生成')
  await page.locator('[data-run-row][role=button]').click()
  await visible(page, 'A 独立搜索')
  assert.equal(await page.getByText('B 独立搜索', { exact: true }).count(), 0)
  await select(page, '会话 B')
  await done(page, 1, 'B 第一段，完整终态')
  await visible(page, 'B 第一段，完整终态')
  await page.locator('[data-run-row][role=button]').click()
  await visible(page, 'B 独立搜索')
  assert.equal(await page.getByText('A 独立搜索', { exact: true }).count(), 0)
  assert.deepEqual(await page.evaluate(() => window.__concurrentFlows.map(flow => flow.aborted)), [true, false])
})

for (const failure of ['error', 'network', 'eof'] as const) {
  test(`AC-05：后台 A 的 ${failure} 不改变 B 的控件、正文和输入，切回仍显示错误`, async ({ page }) => {
    await setup(page)
    await send(page, 'A 请求', 1)
    await start(page, 0)
    await select(page, '会话 B')
    await send(page, 'B 请求', 2)
    await start(page, 1)
    await push(page, 1, { type: 'delta', contentDelta: 'B 继续生成' })
    await page.getByRole('textbox').first().fill('B 尚未发送的输入')
    if (failure === 'error')
      await push(page, 0, { type: 'error', message: 'A 受控失败', assistantMessageId: 'assistant-0' })
    else
      await page.evaluate(fail => window.__endConcurrent(0, fail), failure === 'network')
    await visible(page, 'B 继续生成')
    assert.equal(await page.getByRole('textbox').first().inputValue(), 'B 尚未发送的输入')
    assert.equal(await page.getByRole('button', { name: '停止生成', exact: true }).isVisible(), true)
    assert.equal(await page.getByText('A 受控失败', { exact: true }).count(), 0)
    await select(page, '会话 A')
    await visible(page, failure === 'error' ? 'A 受控失败' : failure === 'network' ? '受控网络异常' : '流式响应提前结束，请稍后重试')
    await select(page, '会话 B')
    await done(page, 1, 'B 正常收尾')
    await visible(page, 'B 正常收尾')
  })
}

test('AC-05：done 后尾部坏数据不翻失败；不服从取消的旧请求不能覆盖同会话的新请求', async ({ page }) => {
  await setup(page, { ignoreAbort: true })
  await send(page, 'A 旧请求', 1)
  await page.getByRole('button', { name: '停止生成', exact: true }).click()
  await visible(page, '已停止生成')
  // 单独操纵时钟越过既有的本会话800ms节流，不靠长sleep。
  await page.clock.install()
  await page.clock.fastForward(801)
  await send(page, 'A 新请求', 2)
  await start(page, 1)
  await push(page, 0, { type: 'start', userMessageId: 'old-user' })
  await push(page, 0, { type: 'delta', contentDelta: '旧请求不能出现' })
  await done(page, 0, '旧请求不能出现')
  await done(page, 1, '新请求已完成')
  await visible(page, '新请求已完成')
  assert.equal(await page.getByText('旧请求不能出现', { exact: true }).count(), 0)
  assert.equal(await page.getByText('已停止生成', { exact: true }).count(), 1)
  // 终态之后的错误不再有写入机会。
  await page.evaluate(() => window.__endConcurrent(1, true))
  assert.equal(await page.getByText('新请求已完成', { exact: true }).isVisible(), true)
})

test('AC-06：两次空白视图创建分别延迟返回，创建和 start 不抢选中、不清另一视图输入', async ({ page }) => {
  await setup(page)
  const pending: Route[] = []
  let onCreate: (route: Route) => void
  await page.route('**/api/conversations', (route) => {
    pending.push(route)
    onCreate(route)
  })
  let received = new Promise<Route>((resolve) => {
    onCreate = resolve
  })
  await page.getByRole('button', { name: '新建对话', exact: true }).click()
  await page.getByRole('textbox').first().fill('创建 A')
  await page.getByRole('button', { name: '发送消息', exact: true }).click()
  const first = await received
  await page.getByRole('textbox').first().press('Enter')
  assert.equal(pending.length, 1)
  received = new Promise<Route>((resolve) => {
    onCreate = resolve
  })
  await page.getByRole('button', { name: '新建对话', exact: true }).click()
  await page.getByRole('textbox').first().fill('创建 B')
  await page.getByRole('button', { name: '发送消息', exact: true }).click()
  const second = await received
  await page.getByRole('textbox').first().fill('B 后来输入的内容')
  await first.fulfill(json(conversation('created-a', '创建 A')))
  await poll(page, 'length', 1)
  await start(page, 0)
  assert.equal(await page.getByRole('textbox').first().inputValue(), 'B 后来输入的内容')
  await second.fulfill(json(conversation('created-b', '创建 B')))
  await poll(page, 'length', 2)
  await start(page, 1)
  await done(page, 1, '创建 B 完成')
  await visible(page, '创建 B 完成')
  assert.equal(await page.getByRole('textbox').first().inputValue(), 'B 后来输入的内容')
  await done(page, 0, '创建 A 完成')
  assert.equal(await page.getByText('创建 A 完成', { exact: true }).count(), 0)
  await select(page, '创建 A')
  await visible(page, '创建 A 完成')
  assert.deepEqual(await page.evaluate(() => window.__concurrentFlows.map(flow => flow.conversationId)), ['created-a', 'created-b'])
})

for (const outcome of ['failed', 'stopped'] as const) {
  test(`AC-06：创建中的 A ${outcome} 不影响 B，不启动迟到任务`, async ({ page }) => {
    await setup(page)
    let receive: (route: Route) => void
    const received = new Promise<Route>((resolve) => {
      receive = resolve
    })
    await page.route('**/api/conversations', route => receive(route))
    await page.getByRole('button', { name: '新建对话', exact: true }).click()
    await page.getByRole('textbox').first().fill('创建 A')
    await page.getByRole('button', { name: '发送消息', exact: true }).click()
    const held = await received
    if (outcome === 'stopped')
      await page.getByRole('button', { name: '停止生成', exact: true }).click()
    await select(page, '会话 B')
    await send(page, 'B 请求', 1)
    await start(page, 0)
    await page.getByRole('textbox').first().fill('B 输入保留')
    if (outcome === 'failed')
      await held.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ message: '创建 A 失败' }) })
    else
      await held.fulfill(json(conversation('late-a', '迟到 A')))
    await done(page, 0, 'B 正常完成')
    await visible(page, 'B 正常完成')
    assert.equal(await page.getByRole('textbox').first().inputValue(), 'B 输入保留')
    assert.equal(await page.getByText('创建 A 失败', { exact: true }).count(), 0)
    assert.equal(await page.evaluate(() => window.__concurrentFlows.length), 1)
  })
}

for (const terminal of [false, true]) {
  test(`AC-07：切回时过期快照不能覆盖 ${terminal ? 'done' : '新delta'} 与进度`, async ({ page }) => {
    await setup(page)
    await send(page, 'A 请求', 1)
    await start(page, 0)
    await push(page, 0, { type: 'delta', contentDelta: 'A 初始内容' })
    await visible(page, 'A 初始内容')
    await select(page, '会话 B')
    let receive: (route: Route) => void
    const received = new Promise<Route>((resolve) => {
      receive = resolve
    })
    await page.route(`**/api/conversations/${CONVERSATION_ID}/messages`, route => receive(route))
    await select(page, '会话 A')
    const held = await received
    if (terminal)
      await done(page, 0, 'A 完整终态')
    else
      await push(page, 0, { type: 'delta', contentDelta: '，最新追加' })
    const latest = terminal ? 'A 完整终态' : 'A 初始内容，最新追加'
    await held.fulfill(json([] as ConversationMessage[]))
    await visible(page, latest)
    assert.equal(await page.getByRole('button', { name: '停止生成', exact: true }).count(), terminal ? 0 : 1)
  })
}

test('AC-08：离开工作区取消所有在途请求，迟到事件不再修改页面', async ({ page }) => {
  await setup(page)
  await send(page, 'A 请求', 1)
  await start(page, 0)
  await push(page, 0, { type: 'reasoning_delta', delta: '尚未flush的思考' })
  await select(page, '会话 B')
  await send(page, 'B 请求', 2)
  await start(page, 1)
  // 通过已挂载页面的导航离开，避免热更新时 import 出另一份未挂载的 router。
  await page.getByRole('button', { name: '用户设置', exact: true }).click()
  await page.getByRole('menuitem', { name: '修改密码', exact: true }).click()
  await page.waitForURL('**/change-password**')
  await poll(page, 'aborted', [true, true])
  await push(page, 0, { type: 'delta', contentDelta: '卸载后不可见' })
  assert.equal(await page.getByText('卸载后不可见', { exact: true }).count(), 0)
})

test('AC-09：后台会话生成中仍禁止删除；停止后才允许删除', async ({ page }) => {
  await setup(page)
  let deleted = 0
  await page.route(`**/api/conversations/${CONVERSATION_ID}`, async (route) => {
    if (route.request().method() === 'DELETE') {
      deleted += 1
      await route.fulfill(json({ id: CONVERSATION_ID }))
    }
    else {
      await route.fallback()
    }
  })
  await send(page, 'A 请求', 1)
  await start(page, 0)
  await select(page, '会话 B')
  const row = page.getByRole('button', { name: '会话 A', exact: true }).locator('..')
  await row.getByRole('button', { name: '对话选项', exact: true }).click()
  await row.getByRole('button', { name: '删除对话', exact: true }).click()
  assert.equal(deleted, 0)
  assert.equal(await page.getByRole('button', { name: '会话 A', exact: true }).isVisible(), true)
  await select(page, '会话 A')
  await page.getByRole('button', { name: '停止生成', exact: true }).click()
  await row.getByRole('button', { name: '对话选项', exact: true }).click()
  await row.getByRole('button', { name: '删除对话', exact: true }).click()
  await page.getByRole('button', { name: '会话 A', exact: true }).waitFor({ state: 'detached' })
  assert.equal(deleted, 1)
})

test('AC-03/07：A 的 delta 等待 rAF 时从 B 切回，不混入 B 消息、不丢 A 已有正文', async ({ page }) => {
  await setup(page)
  await send(page, 'A 请求', 1)
  await start(page, 0)
  await push(page, 0, { type: 'delta', contentDelta: 'A 已有正文' })
  await visible(page, 'A 已有正文')
  await select(page, '会话 B')
  await send(page, 'B 请求', 2)
  await start(page, 1)
  await push(page, 1, { type: 'delta', contentDelta: 'B 独立正文' })
  await visible(page, 'B 独立正文')
  await page.clock.install()
  await page.clock.pauseAt(new Date())
  await push(page, 0, { type: 'delta', contentDelta: '，尚未刷入的新字' })
  await select(page, '会话 A')
  await page.clock.resume()
  await visible(page, 'A 已有正文，尚未刷入的新字')
  assert.equal(await page.getByText('B 独立正文', { exact: true }).count(), 0)
  assert.equal(await page.getByText('B 请求', { exact: true }).count(), 0)
  await select(page, '会话 B')
  await visible(page, 'B 独立正文')
  assert.equal(await page.getByText('A 已有正文，尚未刷入的新字', { exact: true }).count(), 0)
})

test('AC-08/09：删除响应返回前启动的请求被正确取消，其他会话仍能生成', async ({ page }) => {
  await setup(page, { holdHeaders: true })
  let receive: (route: Route) => void
  const received = new Promise<Route>((resolve) => {
    receive = resolve
  })
  await page.route(`**/api/conversations/${CONVERSATION_ID}`, route => receive(route))
  const row = page.getByRole('button', { name: '会话 A', exact: true }).locator('..')
  await row.getByRole('button', { name: '对话选项', exact: true }).click()
  await row.getByRole('button', { name: '删除对话', exact: true }).click()
  const held = await received
  await send(page, '删除等待期间发送 A', 1)
  await held.fulfill(json({ id: CONVERSATION_ID }))
  await poll(page, 'aborted', [true])
  await page.getByRole('button', { name: '会话 A', exact: true }).waitFor({ state: 'detached' })
  await send(page, 'B 请求', 2)
  await page.evaluate(() => window.__concurrentFlows[1]!.headers())
  await start(page, 1)
  await done(page, 1, 'B 不受删除影响')
  await visible(page, 'B 不受删除影响')
})

test('侧栏：当前与后台任务都有呼吸点，收起导航仍显示，减少动画/停止/完成正确复位', async ({ page }) => {
  await setup(page, { holdHeaders: true })
  await send(page, 'A 请求', 1)
  const a = page.getByRole('button', { name: '会话 A', exact: true })
  const b = page.getByRole('button', { name: '会话 B', exact: true })
  assert.equal(await a.getAttribute('aria-busy'), 'true')
  assert.equal(await a.locator('span[aria-hidden=true]').evaluate(el => getComputedStyle(el).animationName), 'pulse-soft')
  await select(page, '会话 B')
  await send(page, 'B 请求', 2)
  assert.equal(await a.getAttribute('aria-busy'), 'true')
  assert.equal(await b.getAttribute('aria-busy'), 'true')
  await page.getByRole('complementary').screenshot({ path: '/private/tmp/issue222-sidebar-loading-desktop.png' })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('button', { name: '打开导航', exact: true }).click()
  const drawer = page.getByRole('dialog')
  assert.equal(await drawer.getByRole('button', { name: '会话 A', exact: true }).getAttribute('aria-busy'), 'true')
  assert.equal(await drawer.getByRole('button', { name: '会话 B', exact: true }).getAttribute('aria-busy'), 'true')
  await drawer.screenshot({ path: '/private/tmp/issue222-sidebar-loading-mobile.png' })
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
  await drawer.getByRole('button', { name: '关闭导航', exact: true }).click()
  await drawer.waitFor({ state: 'hidden' })
  await page.setViewportSize({ width: 1280, height: 720 })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  assert.equal(await a.locator('span[aria-hidden=true]').evaluate(el => getComputedStyle(el).animationName), 'none')
  assert.equal(await a.getAttribute('aria-busy'), 'true')
  await page.getByRole('button', { name: '收起导航', exact: true }).click()
  assert.equal(await a.getAttribute('aria-busy'), 'true')
  assert.equal(await b.getAttribute('aria-busy'), 'true')
  await select(page, '会话 A')
  await page.getByRole('button', { name: '停止生成', exact: true }).click()
  assert.equal(await a.getAttribute('aria-busy'), null)
  assert.equal(await b.getAttribute('aria-busy'), 'true')
  await select(page, '会话 B')
  await page.evaluate(() => window.__concurrentFlows[1]!.headers())
  await start(page, 1)
  await done(page, 1, 'B 完成后呼吸点消失')
  await visible(page, 'B 完成后呼吸点消失')
  assert.equal(await b.getAttribute('aria-busy'), null)
  assert.equal(await b.locator('span[aria-hidden=true]').count(), 0)
})

test('新建对话自动聚焦：连续新建无需点输入框，打字占位保留，键盘输入和手机抽屉均可直接输入', async ({ page }) => {
  await setup(page)
  const input = page.getByRole('textbox').first()
  const focused = () => input.evaluate(el => document.activeElement === el)
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await page.getByRole('button', { name: '新建对话', exact: true }).click()
    assert.equal(await focused(), true)
    await page.locator('.composer-input > p[aria-hidden=true]').waitFor()
    assert.equal(await page.locator('.composer-input > p[aria-hidden=true]').isVisible(), true)
    assert.equal(await page.locator('.typewriter-caret').count(), 0)
    await page.keyboard.type(`直接输入 ${attempt}`)
    assert.equal(await input.inputValue(), `直接输入 ${attempt}`)
    assert.equal(await page.locator('.composer-input > p[aria-hidden=true]').count(), 0)
  }
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('button', { name: '打开导航', exact: true }).click()
  const drawer = page.getByRole('dialog')
  await drawer.getByRole('button', { name: '新建对话', exact: true }).click()
  await drawer.waitFor({ state: 'hidden' })
  assert.equal(await focused(), true)
  await page.keyboard.type('手机也能直接输入')
  assert.equal(await input.inputValue(), '手机也能直接输入')
})
