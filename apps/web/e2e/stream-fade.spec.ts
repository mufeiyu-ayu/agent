import type { Page } from '@playwright/test'

import { expect, test } from '@playwright/test'

import { CONVERSATION_ID, installApiRoutes, installBrowserStubs } from './fixtures'

/** 一帧里正文每个字的位置（相对滚动容器内容）与实际不透明度（祖先 opacity 连乘）。 */
interface Frame {
  t: number
  text: string
  xs: number[]
  ys: number[]
  ops: number[]
  /** 这个字是否在片段里。 */
  fresh: boolean[]
  last?: { x: number, y: number, w: number, h: number }
  dot?: { x: number, y: number }
  dotOpacity: number
  /** 含片段的 prose 块下标、prose 块总数、片段的动画时长。 */
  spanBlocks: number[]
  proseCount: number
  spanCount: number
  durations: string[]
}

declare global {
  interface Window {
    __fadeFrames: Frame[]
    __fadeRecording: boolean
  }
}

const identity = { conversationId: CONVERSATION_ID, assistantMessageId: 'assistant-live' }
const line = (event: Record<string, unknown>) => JSON.stringify({ ...identity, ...event })
const start = JSON.stringify({ type: 'start', conversationId: CONVERSATION_ID, userMessageId: 'user-live', assistantMessageId: 'assistant-live' })

/** `perChar` 为 false 时只记片段分布（长回答逐字量太慢）。 */
async function startRecording(page: Page, perChar: boolean) {
  await page.evaluate((perChar) => {
    window.__fadeFrames = []
    window.__fadeRecording = true
    const record = () => {
      const viewport = document.querySelector<HTMLElement>('[data-agent-conversation-viewport]')
      const root = [...document.querySelectorAll('.agent-run')].at(-1)
      const content = root?.querySelector('.agent-markdown-content')
      const proses = content ? [...content.querySelectorAll('.agent-markdown-prose')] : []
      const spans = content ? [...content.querySelectorAll('.agent-markdown-fresh')] : []
      const frame: Frame = {
        t: performance.now(),
        text: '',
        xs: [],
        ys: [],
        ops: [],
        fresh: [],
        dotOpacity: 0,
        spanBlocks: [...new Set(spans.map(span => proses.indexOf(span.closest('.agent-markdown-prose')!)))],
        proseCount: proses.length,
        spanCount: spans.length,
        durations: [...new Set(spans.map(span => getComputedStyle(span).animationDuration))],
      }

      if (perChar && viewport && content) {
        const origin = viewport.getBoundingClientRect()
        const place = (rect: DOMRect) => ({ x: rect.left - origin.left, y: rect.top - origin.top + viewport.scrollTop, w: rect.width, h: rect.height })
        const opacity = new Map<Element, number>()
        const opacityOf = (element: Element): number => {
          if (element === content)
            return 1
          let value = opacity.get(element)
          if (value === undefined) {
            value = Number(getComputedStyle(element).opacity) * opacityOf(element.parentElement!)
            opacity.set(element, value)
          }
          return value
        }
        const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT)
        const range = document.createRange()

        for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
          for (let index = 0; index < node.data.length; index++) {
            if (!node.data[index]!.trim())
              continue
            range.setStart(node, index)
            range.setEnd(node, index + 1)
            const rect = place(range.getBoundingClientRect())
            frame.text += node.data[index]
            frame.ops.push(opacityOf(node.parentElement!))
            frame.fresh.push(!!node.parentElement!.closest('.agent-markdown-fresh'))
            frame.xs.push(rect.x)
            frame.ys.push(rect.y)
            frame.last = rect
          }
        }
        const dot = root?.querySelector('[data-run-dot]')
        if (dot) {
          const rect = place(dot.getBoundingClientRect())
          frame.dot = { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 }
          frame.dotOpacity = Number(getComputedStyle(dot).opacity)
        }
      }
      window.__fadeFrames.push(frame)
      if (window.__fadeRecording)
        requestAnimationFrame(record)
    }
    requestAnimationFrame(record)
  }, perChar)
}

async function stopRecording(page: Page): Promise<Frame[]> {
  return page.evaluate(() => {
    window.__fadeRecording = false
    return window.__fadeFrames
  })
}

async function send(page: Page, chunks: string[], delayMs: number, perChar = true) {
  await installApiRoutes(page, () => [])
  await installBrowserStubs(page, {
    lines: [
      start,
      ...chunks.map(contentDelta => line({ type: 'delta', contentDelta })),
      line({ type: 'done', content: chunks.join(''), generatedAt: '2026-09-28T00:00:00.000Z' }),
    ],
    holdBeforeIndex: -1,
    delaysMs: [0, 300, ...chunks.slice(1).map(() => delayMs), 150],
  })
  await page.goto('/workspace')
  await page.getByRole('textbox').first().fill('怎么做 SEO？')
  // 字体按首次用到时加载（行内代码的等宽字体），加载完成那一帧行高会变：先加载好，只量渐显本身。
  await page.evaluate(() => Promise.allSettled([...document.fonts].map(font => font.load())))
  await startRecording(page, perChar)
  await page.getByRole('button', { name: '发送消息' }).click()
  await expect(page.getByRole('button', { name: '停止生成' })).toHaveCount(0, { timeout: 30_000 })
}

/** AC-09：块不再是尾块后，片段在最后一批淡入完（0.42s 加余量）内摘掉，已完成的块里不留片段。 */
function expectSpansOnlyNearTail(frames: Frame[]) {
  const leftTailAt = new Map<number, number>()
  for (const frame of frames) {
    for (let index = 0; index < frame.proseCount - 1; index++) {
      if (!leftTailAt.has(index))
        leftTailAt.set(index, frame.t)
    }
    for (const index of frame.spanBlocks) {
      const since = frame.t - (leftTailAt.get(index) ?? frame.t)
      expect(since, `第 ${index} 块已不是尾块 ${since.toFixed(0)}ms 仍有片段`).toBeLessThanOrEqual(700)
    }
  }
}

function commonPrefix(a: string, b: string) {
  let index = 0
  while (index < a.length && index < b.length && a[index] === b[index])
    index++
  return index
}

const ANSWER = [
  '## 结论\n\n',
  'SEO 的核心是让**搜索引擎**和*用户*都能快速理解页面，',
  '先确认 `title` 与 H1 表达同一个意图，再看 [官方指南](https://developers.google.com/search/docs) 里的建议。\n\n',
  '- 标题写清楚主题，',
  '控制在 60 字符以内\n',
  '- 描述概括正文：\n',
  '  - 包含主要关键词\n',
  '  - 避免重复堆砌\n',
  '- 内链锚文本要具体\n\n',
  '> 提示：改完后在 Search Console 里请求重新编入索引，',
  '通常几天内生效。\n\n',
  '最后，持续观察点击率和排名的变化，按数据调整。',
]

test('#214 AC-01/03/04/08c 按批淡入：已显示的字零位移、不透明度只升不降、不中途跳满，尾点跟着最后一个字', async ({ page }) => {
  await send(page, ANSWER, 140)
  // 等最后一批淡入完、尾块切回 v-html、尾点淡出。
  await expect.poll(async () => page.locator('.agent-markdown-fresh').count()).toBe(0)
  await page.waitForTimeout(300)
  const frames = (await stopRecording(page)).filter(frame => frame.text)

  expect(frames.at(-1)!.text).toMatch(/^结论SEO的核心.*官方指南.*避免重复堆砌.*按数据调整。$/)
  expect(frames.at(-1)!.ops.every(value => value === 1), '终态全部不透明').toBe(true)

  // AC-01：淡入确实发生、时长 0.42s；回答的第一段（随正文组件一起挂载）也淡入。
  expect(frames[0]!.ops[0], '第一个字出现时还在淡入').toBeLessThan(0.5)
  expect(frames.filter(frame => frame.ops.some(value => value > 0.05 && value < 0.95)).length).toBeGreaterThan(20)
  expect([...new Set(frames.flatMap(frame => frame.durations))]).toEqual(['0.42s'])
  expectSpansOnlyNearTail(frames)

  const moved: string[] = []
  const dimmed: string[] = []
  const jumped: string[] = []
  for (const [index, frame] of frames.entries()) {
    if (index === 0)
      continue
    const previous = frames[index - 1]!
    const shared = commonPrefix(previous.text, frame.text)
    const dt = frame.t - previous.t
    for (let char = 0; char < shared; char++) {
      const label = `第 ${index} 帧「${frame.text[char]}」（第 ${char} 字）`
      if (Math.abs(frame.xs[char]! - previous.xs[char]!) > 0.5 || Math.abs(frame.ys[char]! - previous.ys[char]!) > 0.5)
        moved.push(label)
      if (frame.ops[char]! < previous.ops[char]! - 0.01)
        dimmed.push(label)
      // 单帧增幅不超过缓动曲线的最大斜率（约 3.7 / 时长），留 1.5 倍余量；离开片段（切回 v-html）时淡入必须已经结束。
      const leftFragment = previous.fresh[char] && !frame.fresh[char] && previous.ops[char]! < 0.98
      if (leftFragment || frame.ops[char]! - previous.ops[char]! > Math.max(0.25, dt * 3.7 / 420 * 1.5))
        jumped.push(`${label} ${previous.ops[char]!.toFixed(2)} → ${frame.ops[char]!.toFixed(2)}（${dt.toFixed(0)}ms）`)
    }
  }
  // AC-03：已显示的字不移动（含尾块切回 v-html 那一帧）。
  expect(moved, '已显示的字移动').toEqual([])
  // AC-01 / AC-04：不重播（不透明度不下降），也不从淡入中途直接跳到 1。
  expect(dimmed, '不透明度下降').toEqual([])
  expect(jumped, '不透明度跳变').toEqual([])

  // AC-08c：尾点看得见时，在最后一个已放出的字（含淡入中的）右边、同一行。
  const trailing = frames.filter(frame => frame.last && frame.dot && frame.dotOpacity > 0.05)
  expect(trailing.length).toBeGreaterThan(10)
  for (const frame of trailing) {
    expect(frame.dot!.x - (frame.last!.x + frame.last!.w), '尾点在末尾文字右侧').toBeGreaterThan(0)
    expect(frame.dot!.x - (frame.last!.x + frame.last!.w), '尾点紧跟末尾文字').toBeLessThan(14)
    expect(Math.abs(frame.dot!.y - (frame.last!.y + frame.last!.h / 2)), '尾点与末尾文字同一行').toBeLessThanOrEqual(3)
  }
})

test('#214 AC-09 5000 字回答：块不再是尾块后片段随即摘掉，输出完后正文里没有片段', async ({ page }) => {
  const paragraph = '这是一段用于验证长回答渲染负担的正文，包含**加粗**与`代码`。'.repeat(5)
  const chunks = Array.from({ length: 30 }, (_, index) => `${paragraph.slice(0, 80)}${index % 2 ? '\n\n' : ''}${paragraph.slice(80)}\n\n`)
  expect(chunks.join('').length).toBeGreaterThan(5000)
  await send(page, chunks, 60, false)
  await expect.poll(async () => page.locator('.agent-markdown-fresh').count()).toBe(0)
  const frames = await stopRecording(page)

  expect(Math.max(...frames.map(frame => frame.spanCount)), '出现过片段').toBeGreaterThan(0)
  expectSpansOnlyNearTail(frames)
})

test('#214 AC-08 减少动画偏好：不出现片段，终态完整', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await send(page, ANSWER, 60, false)
  const frames = await stopRecording(page)

  expect(frames.every(frame => frame.spanCount === 0)).toBe(true)
  await expect(page.locator('.agent-markdown-content').last()).toContainText('按数据调整。')
})

test('#214 AC-08 后台标签页：不记批次，终态完整、没有片段', async ({ page }) => {
  await installApiRoutes(page, () => [])
  await installBrowserStubs(page, {
    lines: [start, ...ANSWER.map(contentDelta => line({ type: 'delta', contentDelta })), line({ type: 'done', content: ANSWER.join(''), generatedAt: '2026-09-28T00:00:00.000Z' })],
    holdBeforeIndex: 2,
  })
  await page.goto('/workspace')
  await page.getByRole('textbox').first().fill('怎么做 SEO？')
  await page.getByRole('button', { name: '发送消息' }).click()
  await expect(page.locator('.agent-markdown-content')).toContainText('结论')
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' })
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await startRecording(page, false)
  await page.evaluate(() => window.__releaseStream?.())
  await expect(page.getByRole('button', { name: '停止生成' })).toHaveCount(0)
  await expect(page.locator('.agent-markdown-content')).toContainText('按数据调整。')
  await page.waitForTimeout(600)
  const frames = await stopRecording(page)

  expect(frames.at(-1)!.spanCount).toBe(0)
})
