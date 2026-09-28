import type { Page } from '@playwright/test'

import { expect, test } from '@playwright/test'

import { CONVERSATION_ID, installApiRoutes, installBrowserStubs } from './fixtures'

/** 相对滚动容器内容的矩形：视口跟随滚动时不算移动。 */
interface Box { x: number, y: number, w: number, h: number }

interface Frame {
  t: number
  row?: Box
  icon?: Box
  dot?: Box
  dotOpacity: number
  para?: Box
  lastChar?: Box
  textOpacity: number
  textCount: number
}

declare global {
  interface Window {
    __frames: Frame[]
    __recording: boolean
  }
}

const identity = { conversationId: CONVERSATION_ID, assistantMessageId: 'assistant-live' }
const line = (event: Record<string, unknown>) => JSON.stringify({ ...identity, ...event })
const start = JSON.stringify({ type: 'start', conversationId: CONVERSATION_ID, userMessageId: 'user-live', assistantMessageId: 'assistant-live' })
const ANSWER = [
  'React 19.2 官方博客列出的新特性主要有三个：\n\n',
  '- **<Activity> 组件**：可以把界面的某一部分藏起来但保留状态，',
  '切回来时不用重新加载。\n',
  '- **useEffectEvent**：把 Effect 里只读取最新值、不该触发重新执行的逻辑拆出来，',
  '减少多余的重复执行。\n',
  '- **性能面板**：Chrome 开发者工具里新增 React 专属的性能轨道，',
  '能看到每次渲染花在哪里。\n\n',
  '另外还有服务端渲染方面的改进，比如部分预渲染。',
]
const SOURCES = Array.from({ length: 10 }, (_, index) => ({ title: `React 19.2 来源 ${index + 1}`, url: `https://source${index + 1}.example/react-19-2` }))

/** 每一帧记下状态行、图标位、呼吸点、正文首段与末尾文字的位置，以及状态行文字的总不透明度。 */
async function startRecording(page: Page) {
  await page.evaluate(() => {
    const box = (element: Element | null | undefined) => {
      // 发出前还没有会话滚动容器，每帧现取。
      const viewport = document.querySelector<HTMLElement>('[data-agent-conversation-viewport]')

      if (!element || !viewport)
        return undefined
      const rect = element.getBoundingClientRect()
      const origin = viewport.getBoundingClientRect()

      return { x: rect.left - origin.left, y: rect.top - origin.top + viewport.scrollTop, w: rect.width, h: rect.height }
    }
    const lastChar = (element: Element | null | undefined) => {
      if (!element)
        return undefined
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
      let last: Text | undefined
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (node.nodeValue?.trim())
          last = node as Text
      }
      if (!last)
        return undefined
      const end = last.data.trimEnd().length
      const range = document.createRange()
      range.setStart(last, end - 1)
      range.setEnd(last, end)
      const rects = range.getClientRects()
      return box({ getBoundingClientRect: () => rects[rects.length - 1]! } as Element)
    }

    window.__frames = []
    window.__recording = true
    const record = () => {
      const root = [...document.querySelectorAll('.agent-run')].at(-1)
      const row = root?.querySelector('[data-run-row]')
      const dot = root?.querySelector('[data-run-dot]')
      const texts = row ? [...row.querySelectorAll('[data-run-text]')] : []

      window.__frames.push({
        t: performance.now(),
        row: box(row),
        icon: box(row?.querySelector('.run-icon')),
        dot: box(dot),
        dotOpacity: dot ? Number(getComputedStyle(dot).opacity) : 0,
        para: box(root?.querySelector('.agent-markdown-prose')),
        lastChar: lastChar(root?.querySelector('.agent-markdown-content')?.lastElementChild),
        textOpacity: texts.reduce((sum, element) => sum + Number(getComputedStyle(element).opacity), 0),
        textCount: texts.length,
      })
      if (window.__recording)
        requestAnimationFrame(record)
    }
    requestAnimationFrame(record)
  })
}

async function stopRecording(page: Page): Promise<Frame[]> {
  return page.evaluate(() => {
    window.__recording = false
    return window.__frames
  })
}

/** 同一个元素出现后每一帧的位置都不变（误差 0.5px）；尺寸按需一起比。 */
function expectStill(frames: Frame[], pick: (frame: Frame) => Box | undefined, withHeight: boolean, label: string) {
  const boxes = frames.map(pick).filter((value): value is Box => !!value)
  const first = boxes[0]!

  expect(boxes.length, `${label} 出现过`).toBeGreaterThan(0)
  for (const current of boxes) {
    expect(Math.abs(current.x - first.x), `${label} 横向移动`).toBeLessThanOrEqual(0.5)
    expect(Math.abs(current.y - first.y), `${label} 纵向移动`).toBeLessThanOrEqual(0.5)
    if (withHeight)
      expect(Math.abs(current.h - first.h), `${label} 高度变化`).toBeLessThanOrEqual(0.5)
  }
}

const center = (value: Box) => ({ x: value.x + value.w / 2, y: value.y + value.h / 2 })

async function send(page: Page, text: string) {
  await page.goto('/workspace')
  await page.getByRole('textbox').first().fill(text)
  await startRecording(page)
  await page.getByRole('button', { name: '发送消息' }).click()
}

test('#208 AC-08 带工具的慢回答：状态行与正文全程零移动，换字不暗，呼吸点原地变成图标，展开可见查询词与来源', async ({ page }) => {
  // 站点图标一律失败：测试不访问外网，同时走首字母兜底。
  await page.route('**/favicon.ico', route => route.abort())
  await installApiRoutes(page, () => [])
  await installBrowserStubs(page, {
    lines: [
      start,
      line({ type: 'tool_started', callId: 'call-search', toolName: 'web_search', query: 'React 19.2 release' }),
      line({ type: 'tool_finished', callId: 'call-search', ok: true, results: SOURCES }),
      line({ type: 'tool_started', callId: 'call-fetch', toolName: 'web_fetch', url: 'https://react.dev/blog/2025/10/01/react-19-2' }),
      line({ type: 'tool_finished', callId: 'call-fetch', ok: true, finalUrl: 'https://react.dev/blog/2025/10/01/react-19-2', title: 'React 19.2 – React', chars: 6800 }),
      ...ANSWER.map(contentDelta => line({ type: 'delta', contentDelta })),
      line({ type: 'done', content: ANSWER.join(''), generatedAt: '2026-09-28T00:00:00.000Z' }),
    ],
    holdBeforeIndex: -1,
    // 1.0s 思考中 → 2.2s 搜索（1.3s 就来了，停够 1.2s 才换）→ 3.4s 阅读 → 4.9s 思考中 → 6.2s 正文开始、变成摘要。
    delaysMs: [0, 1300, 1300, 700, 1500, 1300, 120, 120, 120, 120, 120, 120, 120, 200],
  })

  await send(page, 'React 19.2 官方博客里列了哪些新特性？')
  await expect(page.locator('[data-run-row]')).toContainText('搜索 React 19.2 release', { timeout: 5_000 })
  await expect(page.locator('[data-run-row]')).toContainText('阅读 react.dev', { timeout: 5_000 })
  await expect(page.locator('[data-run-row]')).toContainText('已搜索 1 次、阅读 1 个网页', { timeout: 10_000 })
  await expect(page.getByRole('button', { name: '停止生成' })).toHaveCount(0, { timeout: 10_000 })
  await page.waitForTimeout(600)
  const frames = await stopRecording(page)

  // 状态行与正文首段：出现后位置、高度都不变。
  expectStill(frames, frame => frame.row, true, '状态行')
  expectStill(frames, frame => frame.para, false, '正文首段')

  // 换字：文字完全显出来之后，任何一帧两段文字的总不透明度都不低于 0.7。
  const visibleFrom = frames.findIndex(frame => frame.textOpacity >= 0.99)
  const swapFrames = frames.slice(visibleFrom).filter(frame => frame.textCount > 0)
  const darkest = Math.min(...swapFrames.map(frame => frame.textOpacity))
  expect(swapFrames.filter(frame => frame.textCount === 2).length, '发生过交叉淡化').toBeGreaterThan(10)
  expect(darkest).toBeGreaterThanOrEqual(0.7)

  // 呼吸点：状态行出现前后都在图标位，误差不超过 1px。
  const rowAt = frames.findIndex(frame => frame.row)
  const before = frames.slice(0, rowAt).filter(frame => frame.dotOpacity > 0.9).at(-1)!
  const after = frames[rowAt]!
  expect(before, '状态行出现前有呼吸点').toBeTruthy()
  expect(Math.abs(center(before.dot!).x - center(after.icon!).x)).toBeLessThanOrEqual(1)
  expect(Math.abs(center(before.dot!).y - center(after.icon!).y)).toBeLessThanOrEqual(1)
  expect(Math.abs(center(after.dot!).y - center(before.dot!).y)).toBeLessThanOrEqual(1)

  // 摘要行：定稿后可展开，时间线里有查询词；再点搜索这一步看到来源（最多 5 条）与「还有 5 条」。
  const summary = page.locator('[data-run-row]')
  await expect(summary).toHaveText(/已搜索 1 次、阅读 1 个网页\s*用时 6 秒/)
  await summary.click()
  const timeline = page.locator('[data-run-timeline]')
  await expect(timeline).toBeVisible()
  await expect(timeline).toContainText('React 19.2 release')
  await expect(timeline).toContainText('10 条结果')
  await expect(timeline).toContainText('React 19.2 – React')
  // 拿不到思考原文的模型：时间线里只有工具步骤，没有思考行（#209）。
  await expect(timeline.locator('li')).toHaveCount(2)
  await timeline.getByRole('button', { name: /React 19.2 release/ }).click()
  await expect(timeline.getByRole('link', { name: /React 19.2 来源 1\b/ })).toHaveAttribute('href', 'https://source1.example/react-19-2')
  await expect(timeline.getByRole('link', { name: /React 19.2 来源/ })).toHaveCount(5)
  await expect(timeline).toContainText('还有 5 条')
})

test('#208 AC-08 1 秒内开始的快回答：没有状态行，正文零移动，尾点跟着正文末尾，结束后淡出', async ({ page }) => {
  const chunks = Array.from({ length: 18 }, (_, index) => index === 8 ? '\n\n第二段，' : `第 ${index + 1} 小段文字，`)
  await installApiRoutes(page, () => [])
  await installBrowserStubs(page, {
    lines: [
      start,
      ...chunks.map(contentDelta => line({ type: 'delta', contentDelta })),
      line({ type: 'done', content: chunks.join(''), generatedAt: '2026-09-28T00:00:00.000Z' }),
    ],
    holdBeforeIndex: -1,
    delaysMs: [0, 300, ...chunks.slice(1).map(() => 80), 150],
  })

  await send(page, '什么是 SEO？')
  await expect(page.getByRole('button', { name: '停止生成' })).toHaveCount(0)
  await expect.poll(async () => Number(await page.locator('[data-run-dot]').evaluate(element => getComputedStyle(element).opacity))).toBe(0)
  const frames = await stopRecording(page)

  expect(frames.some(frame => frame.row), '全程没有状态行').toBe(false)
  expectStill(frames, frame => frame.para, false, '正文首段')

  // 正文在写时、以及 done 之后淡出途中，只要尾点还看得见，就在最后一个字右边、同一行。
  const streaming = frames.filter(frame => frame.lastChar && frame.dotOpacity > 0.05)
  expect(streaming.length).toBeGreaterThan(10)
  for (const frame of streaming) {
    const dot = center(frame.dot!)
    const char = frame.lastChar!

    expect(dot.x - (char.x + char.w), '尾点在末尾文字右侧').toBeGreaterThan(0)
    expect(dot.x - (char.x + char.w), '尾点紧跟末尾文字').toBeLessThan(14)
    expect(Math.abs(dot.y - center(char).y), '尾点与末尾文字同一行').toBeLessThanOrEqual(3)
  }
})

test('#209 AC-05 思考短句：状态行随思考换字时状态行与正文全程零移动，展开思考行后完整思考限高、可滚动', async ({ page }) => {
  const LONG = '官方博客通常会按功能分节列出新特性，每一节都有示例代码和迁移说明，这次要特别留意 Activity 组件、useEffectEvent 和性能面板这三部分的描述是否与社区总结一致。'
  const FILLER = Array.from({ length: 7 }, (_, index) => `第 ${index + 1} 段：先确认官方博客的发布日期，再核对每个新特性的名称和用途，避免把实验性功能当成正式特性写进回答里。\n\n`)
  const think = (delta: string) => line({ type: 'reasoning_delta', delta })

  await installApiRoutes(page, () => [])
  await installBrowserStubs(page, {
    lines: [
      start,
      think('用户想知道 React 19.2 官方列了哪些新特性，'),
      think('先找到官方发布说明。\n\n'),
      ...FILLER.map(think),
      think(LONG),
      // 紧跟着 tool_started 到达（间隔远小于前台 200ms 的写入节流）：这一句要先写进这一轮，不能丢。
      think('再确认一下英文关键词。'),
      line({ type: 'tool_started', callId: 'call-search', toolName: 'web_search', query: 'React 19.2 release' }),
      line({ type: 'tool_finished', callId: 'call-search', ok: true, results: SOURCES }),
      think('结果够用了，可以开始回答。'),
      ...ANSWER.map(contentDelta => line({ type: 'delta', contentDelta })),
      line({ type: 'done', content: ANSWER.join(''), generatedAt: '2026-09-28T00:00:00.000Z' }),
    ],
    holdBeforeIndex: -1,
    // 0.3s 半句 → 0.8s 第一句 → 0.9~1.5s 七段（1.0s 状态行出现，停 1.5 秒后到 2.5s 直接换到第 7 段）
    // → 3.0s 超长一句（4.0s 换上）→ 4.5s 最后一句与搜索同时到（5.5s 换成搜索）→ 6.0s 搜完 → 6.2s 第二轮一句（6.7s 换上）→ 8.0s 正文。
    delaysMs: [0, 300, 500, ...FILLER.map(() => 100), 1500, 1500, 0, 1500, 200, 1800, ...ANSWER.slice(1).map(() => 120), 200],
  })

  await send(page, 'React 19.2 官方博客里列了哪些新特性？')
  const row = page.locator('[data-run-row]')
  await expect(row).toContainText('第 7 段：先确认官方博客的发布日期', { timeout: 5_000 })
  await expect(row).toContainText('官方博客通常会按功能分节列出新特性', { timeout: 5_000 })
  // 超长一句单行省略：状态行不换行、不撑出正文宽度。
  const label = row.locator('.run-label').last()
  expect(await label.evaluate(element => element.scrollWidth > element.clientWidth)).toBe(true)
  await expect(row).toContainText('搜索 React 19.2 release', { timeout: 5_000 })
  await expect(row).toContainText('结果够用了，可以开始回答。', { timeout: 5_000 })
  await expect(row).toContainText('已搜索 1 次', { timeout: 10_000 })
  await expect(page.getByRole('button', { name: '停止生成' })).toHaveCount(0, { timeout: 10_000 })
  await page.waitForTimeout(600)
  const frames = await stopRecording(page)

  expectStill(frames, frame => frame.row, true, '状态行')
  expectStill(frames, frame => frame.para, false, '正文首段')

  // 时间线：两轮思考与搜索按时间交错，思考行文字是这一轮最后一句（紧贴 tool_started 到达的那句也在）。
  await row.click()
  const timeline = page.locator('[data-run-timeline]')
  await expect(timeline).toBeVisible()
  await expect(timeline.locator('li')).toHaveCount(3)
  await expect(timeline.locator('li').nth(0)).toContainText('再确认一下英文关键词。')
  await expect(timeline.locator('li').nth(1)).toContainText('React 19.2 release')
  await expect(timeline.locator('li').nth(2)).toContainText('结果够用了，可以开始回答。')

  // 完整思考默认折叠；点开后限高约 7 行、可滚动，纯文本分段。
  await expect(page.locator('[data-run-thought]')).toHaveCount(0)
  await timeline.getByRole('button', { name: /再确认一下英文关键词/ }).click()
  const thought = page.locator('[data-run-thought]')
  await expect(thought).toBeVisible()
  await expect(thought.locator('p')).toHaveCount(9)
  await expect(thought.locator('p').last()).toHaveText(`${LONG}再确认一下英文关键词。`)
  await expect(thought).toHaveClass(/is-overflowing/)
  const metrics = await thought.evaluate((element) => {
    const style = getComputedStyle(element)
    const before = element.scrollTop

    element.scrollTop = element.scrollHeight

    return {
      client: element.clientHeight,
      scroll: element.scrollHeight,
      lineHeight: Number.parseFloat(style.lineHeight),
      fontSize: Number.parseFloat(style.fontSize),
      overflowY: style.overflowY,
      scrolled: element.scrollTop - before,
    }
  })
  expect(metrics.overflowY).toBe('auto')
  expect(metrics.scroll, '内容超出限高').toBeGreaterThan(metrics.client)
  expect(metrics.client, '限高约 7 行（加底部渐隐留白）').toBeLessThanOrEqual(metrics.lineHeight * 7 + metrics.fontSize * 1.5 + 1)
  expect(metrics.client).toBeGreaterThan(metrics.lineHeight * 6)
  expect(metrics.scrolled, '可以滚动').toBeGreaterThan(0)

  // 第二轮只有一句：不超出限高，没有底部渐隐与留白。
  await timeline.getByRole('button', { name: /结果够用了/ }).click()
  await expect(page.locator('[data-run-thought]').nth(1)).not.toHaveClass(/is-overflowing/)
})

test('#212 AC-09 完成一轮后刷新、切换会话再切回：摘要行与展开的时间线与刷新前一致，还原时状态行无动画、零移动', async ({ page }) => {
  const OTHER_ID = 'conversation-other'
  const THOUGHTS = ['先找官方发布说明。', '资料够了，开始回答。']
  const FETCHED = { finalUrl: 'https://react.dev/blog/2025/10/01/react-19-2', title: 'React 19.2 – React', chars: 6800 }
  const json = (data: unknown) => ({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, code: 0, message: 'ok', data }) })
  // 服务端在这一轮结束后返回的消息：activity 与流事件是同一份数据（#212）。
  const persisted = [
    { id: 'user-live', conversationId: CONVERSATION_ID, role: 'USER', content: 'React 19.2 官方博客里列了哪些新特性？', status: 'COMPLETED', createdAt: '2026-09-28T00:00:00.000Z', updatedAt: '2026-09-28T00:00:00.000Z' },
    {
      id: 'assistant-live',
      conversationId: CONVERSATION_ID,
      role: 'ASSISTANT',
      content: ANSWER.join(''),
      status: 'COMPLETED',
      createdAt: '2026-09-28T00:00:01.000Z',
      updatedAt: '2026-09-28T00:00:05.000Z',
      activity: {
        // 与下面的推送节奏一致：正文约在 3.5 秒开始。
        answerStartedMs: 3_540,
        toolBeforeAnswer: true,
        items: [
          { kind: 'thought', text: THOUGHTS[0] },
          { kind: 'tool', callId: 'call-search', toolName: 'web_search', query: 'React 19.2 release', ok: true, durationMs: 620, results: SOURCES },
          { kind: 'tool', callId: 'call-fetch', toolName: 'web_fetch', url: FETCHED.finalUrl, ok: true, durationMs: 620, ...FETCHED },
          { kind: 'thought', text: THOUGHTS[1] },
        ],
      },
    },
  ] as const
  let serverMessages: unknown[] = []

  await page.route('**/favicon.ico', route => route.abort())
  await installApiRoutes(page, () => serverMessages as never)
  await page.route('**/api/conversations?*', route => route.fulfill(json({
    items: [
      { id: CONVERSATION_ID, title: '落地页 SEO 诊断', createdAt: '2026-08-17T08:00:00.000Z', updatedAt: '2026-08-17T09:00:00.000Z' },
      { id: OTHER_ID, title: '另一个会话', createdAt: '2026-08-16T08:00:00.000Z', updatedAt: '2026-08-16T09:00:00.000Z' },
    ],
    nextCursor: null,
  })))
  await page.route(`**/api/conversations/${OTHER_ID}/messages`, route => route.fulfill(json([])))
  await installBrowserStubs(page, {
    lines: [
      start,
      line({ type: 'reasoning_delta', delta: THOUGHTS[0] }),
      line({ type: 'tool_started', callId: 'call-search', toolName: 'web_search', query: 'React 19.2 release' }),
      line({ type: 'tool_finished', callId: 'call-search', ok: true, results: SOURCES }),
      line({ type: 'tool_started', callId: 'call-fetch', toolName: 'web_fetch', url: FETCHED.finalUrl }),
      line({ type: 'tool_finished', callId: 'call-fetch', ok: true, ...FETCHED }),
      line({ type: 'reasoning_delta', delta: THOUGHTS[1] }),
      ...ANSWER.map(contentDelta => line({ type: 'delta', contentDelta })),
      line({ type: 'done', content: ANSWER.join(''), generatedAt: '2026-09-28T00:00:05.000Z' }),
    ],
    holdBeforeIndex: -1,
    delaysMs: [0, 300, 500, 600, 200, 600, 300, 900, ...ANSWER.slice(1).map(() => 80), 150],
  })
  // 每一帧记下状态行的位置、文字不透明度与正在跑的动画：刷新后的还原要一出现就是定稿，不淡入、不描绘、不移动。
  await page.addInitScript(() => {
    const frames: Array<{ y: number, opacity: number, animations: string[] }> = []

    Object.assign(window, { __restoreFrames: frames })
    const record = () => {
      const row = document.querySelector('[data-run-row]')
      const viewport = document.querySelector<HTMLElement>('[data-agent-conversation-viewport]')

      if (row && viewport) {
        const running = row.closest('.agent-run')!.getAnimations({ subtree: true }).filter(animation => animation.playState === 'running')

        frames.push({
          y: row.getBoundingClientRect().top - viewport.getBoundingClientRect().top + viewport.scrollTop,
          opacity: [...row.querySelectorAll('[data-run-text]')].reduce((sum, element) => sum + Number(getComputedStyle(element).opacity), 0),
          animations: running.map(animation => (animation as CSSAnimation).animationName ?? (animation as CSSTransition).transitionProperty),
        })
      }
      requestAnimationFrame(record)
    }
    requestAnimationFrame(record)
  })

  const row = page.locator('[data-run-row]')
  const timeline = page.locator('[data-run-timeline]')
  /** 当前画面：摘要行文字、展开后每一行时间线，以及搜索这一步展开后的来源。 */
  const view = async () => {
    // 切回会话时先恢复滚动位置，期间整个会话区不可见（innerText 为空）。
    await expect(row).toBeVisible()
    await expect(row).toHaveAttribute('aria-expanded', 'false')
    const summary = await row.textContent()

    await row.click()
    await expect(timeline).toBeVisible()
    await timeline.getByRole('button', { name: /React 19.2 release/ }).click()
    await expect(timeline.getByRole('link', { name: /React 19.2 来源/ })).toHaveCount(5)
    await timeline.getByRole('button', { name: /React 19.2 – React/ }).click()
    const result = {
      summary,
      steps: await timeline.locator('li .run-tl-head').allInnerTexts(),
      sources: await timeline.getByRole('link', { name: /React 19.2 来源/ }).evaluateAll(links => links.map(link => link.getAttribute('href'))),
      page: await timeline.getByRole('link', { name: '打开原网页' }).getAttribute('href'),
    }

    return result
  }

  await page.goto('/workspace')
  await page.getByRole('textbox').first().fill('React 19.2 官方博客里列了哪些新特性？')
  await page.getByRole('button', { name: '发送消息' }).click()
  await expect(row).toContainText('已搜索 1 次、阅读 1 个网页', { timeout: 10_000 })
  await expect(page.getByRole('button', { name: '停止生成' })).toHaveCount(0, { timeout: 10_000 })
  await page.waitForTimeout(600)
  const live = await view()

  expect(live.summary).toMatch(/已搜索 1 次、阅读 1 个网页\s*用时 3 秒/)
  expect(live.steps).toHaveLength(4)
  serverMessages = [...persisted]

  // 切到另一个会话再切回：还是离开前的样子（摘要收起）。
  await page.getByText('另一个会话').click()
  await expect(row).toHaveCount(0)
  await page.getByText('落地页 SEO 诊断').click()
  expect(await view()).toEqual(live)

  // 刷新：本页内存里的过程没了，全靠接口下发的 activity 还原。
  await page.reload()
  await expect(row).toBeVisible()
  await page.waitForTimeout(800)
  const frames = await page.evaluate(() => (window as unknown as { __restoreFrames: Array<{ y: number, opacity: number, animations: string[] }> }).__restoreFrames)

  expect(frames.length).toBeGreaterThan(10)
  for (const frame of frames) {
    expect(frame.animations, '还原的状态行没有动画').toEqual([])
    expect(frame.opacity, '摘要一出现就完全显示').toBe(1)
    expect(Math.abs(frame.y - frames[0]!.y), '状态行零移动').toBeLessThanOrEqual(0.5)
  }
  expect(await view()).toEqual(live)

  // 刷新后再切走切回：重新拉取、按新消息重新还原，仍与刷新前一致（摘要收起）。
  await page.getByText('另一个会话').click()
  await expect(row).toHaveCount(0)
  await page.getByText('落地页 SEO 诊断').click()
  expect(await view()).toEqual(live)
})
