import type { Ref } from 'vue'
import type { StreamingContentBlock } from './useStreamingMarkdown'

import assert from 'node:assert/strict'
import { it, onTestFinished, vi } from 'vitest'

import { nextTick, ref } from 'vue'

// hook 只用到这几个浏览器 API：换成可控时钟与手动推进的 rAF。
let now = 0
const frames: Array<() => void> = []

Object.assign(globalThis, {
  document: { visibilityState: 'visible', addEventListener() {}, removeEventListener() {} },
  window: { matchMedia: () => ({ matches: false }) },
  requestAnimationFrame: (callback: FrameRequestCallback) => frames.push(() => callback(now)),
  cancelAnimationFrame: () => {},
})
Object.defineProperty(performance, 'now', { configurable: true, value: () => now })

const { useStreamingMarkdown } = await import('./useStreamingMarkdown')

/** 流式中一次性到达 `backlog` 个字符并立刻结束，返回放完所用的时间。 */
async function settleDuration(backlog: number): Promise<number> {
  now = 0
  frames.length = 0
  const text = ref('开头')
  const streaming = ref(true)
  const blocks = useStreamingMarkdown(() => text.value, () => streaming.value)

  text.value += `${'流'.repeat(backlog - 3)}END`
  streaming.value = false
  const doneAt = now
  await nextTick()

  for (let step = 0; step < 100; step++) {
    if (blocks.value.some(block => block.type === 'markdown' && block.html.includes('END')))
      return now - doneAt
    now += 16
    for (const frame of frames.splice(0))
      frame()
    await nextTick()
  }
  assert.fail(`积压 ${backlog} 字在 1.6s 内都没放完`)
}

it('#169 AC-05 流结束时积压多少都在 150ms 内提交完整正文', async () => {
  for (const backlog of [20, 500, 2000])
    assert.ok(await settleDuration(backlog) <= 150, `积压 ${backlog} 字`)
})

function fadeOf(block: StreamingContentBlock | undefined) {
  return block?.type === 'markdown' ? block.fade : undefined
}

/** 挂载 hook，返回可改写的正文与按 16ms 一帧推进的时钟。 */
function mount(initial: string, fadeInitialText = false) {
  now = 0
  frames.length = 0
  const text = ref(initial)
  const streaming = ref(true)
  const blocks = useStreamingMarkdown(() => text.value, () => streaming.value, fadeInitialText)
  return { text, streaming, blocks, ...mountClock(blocks) }
}

/** 按 16ms 一帧推进时钟、执行 rAF 与定时器，记下每次提交的时刻与已放出的「流」字数。 */
function mountClock(blocks: Ref<StreamingContentBlock[]>) {
  const commits: Array<{ at: number, chars: number }> = []
  let last = blocks.value

  async function advance(ms: number) {
    await nextTick()
    for (const end = now + ms; now < end;) {
      now += 16
      vi.advanceTimersByTime(16)
      for (const frame of frames.splice(0))
        frame()
      await nextTick()
      if (blocks.value !== last) {
        last = blocks.value
        commits.push({ at: now, chars: blocks.value.reduce((sum, block) => sum + (block.type === 'markdown' ? block.html.split('流').length - 1 : 0), 0) })
      }
    }
  }
  return { commits, advance }
}

it('#214 AC-02 流式中提交间隔不小于 64ms，积压按 280ms 时间常数放出', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  onTestFinished(() => {
    vi.useRealTimers()
  })
  const { text, commits, advance } = mount('开头')

  text.value += '流'.repeat(100)
  await advance(400)
  // 第一次提交在 64ms，放出 ceil(100 × 64 / 280) = 23 字；之后每次都相隔 64ms 以上。
  assert.deepEqual(commits[0], { at: 64, chars: 23 })
  for (const [index, commit] of commits.entries()) {
    if (index > 0)
      assert.ok(commit.at - commits[index - 1]!.at >= 64, `第 ${index} 次提交间隔 ${commit.at - commits[index - 1]!.at}ms`)
  }
})

it('#214 AC-01 新放出的字按提交记成批次；挂载时已有的正文不算，文字被改写时原偏移沿用原批次、不重播', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  onTestFinished(() => {
    vi.useRealTimers()
  })
  const { text, blocks, advance } = mount('已有')

  assert.equal(fadeOf(blocks.value[0])?.batches?.length, 0, '挂载时已有的正文不记批次，但尾块走 VNode')
  text.value += ' &amp'
  await advance(320)
  const before = fadeOf(blocks.value[0])!.batches!
  assert.equal(before[0]!.start, '已有'.length)
  assert.equal(before.at(-1)!.end, '已有 &amp'.length)

  // 实体补全把已显示的「&amp」改写成「&」，同一次提交里又多出「 B」：总长没超过上次，不记新批次。
  text.value = '已有 & B'
  await advance(16)
  const after = fadeOf(blocks.value[0])!.batches!
  assert.ok(after.length > 0)
  assert.ok(after.every(batch => before.some(old => old.id === batch.id && old.bornAt === batch.bornAt)), '没有新批次')
  assert.ok(after.every(batch => batch.end <= '已有 & B'.length))
})

it('#214 尾块完成、流结束后，片段淡入完才切回 v-html', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  onTestFinished(() => {
    vi.useRealTimers()
  })
  const { text, streaming, blocks, advance } = mount('')

  text.value = '第一段'
  await advance(320)
  text.value += '\n\n第二段'
  while (blocks.value.length < 2)
    await advance(16)
  // 第一段已不是尾块，但还有片段在淡入：仍走 VNode；新尾块有自己的批次。
  assert.ok(fadeOf(blocks.value[0])!.batches!.length > 0)
  assert.ok(fadeOf(blocks.value[1])!.batches!.length > 0)
  // 「第二段」还在陆续放出：等放完、最后一批也淡入完。
  await advance(800)
  assert.equal(fadeOf(blocks.value[0])?.batches, undefined)
  assert.equal(fadeOf(blocks.value[1])?.batches?.length, 0, '流式中的尾块淡入完仍走 VNode')

  text.value += '继续'
  streaming.value = false
  await advance(160)
  assert.ok(fadeOf(blocks.value[1])!.batches!.length > 0, '流结束时最后一批还在淡入')
  await advance(480)
  assert.equal(fadeOf(blocks.value[1])?.batches, undefined)
})

it('#214 一次提交带出的每个新块都淡入：非尾块的新块、流结束收尾时新起的一段、实时流挂载时带进来的第一段', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  onTestFinished(() => {
    vi.useRealTimers()
  })
  const live = mount('第一段\n\n## 标题', true)
  assert.deepEqual(live.blocks.value.map(block => fadeOf(block)?.batches.length), [1, 1], '挂载时带进来的第一段按实时流处理')

  const { text, streaming, blocks, advance } = mount('开头')
  await advance(64)
  text.value += '\n\n## 标题\n\n正文'
  streaming.value = false
  await advance(160)
  assert.equal(blocks.value.length, 3)
  assert.ok(blocks.value.slice(1).every(block => fadeOf(block)?.batches.length), '标题、收尾时新起的正文都有片段')
})

it('#214 尾块一度含不支持的 token（列表里的分隔线）、之后恢复时，已显示的字不重播', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  onTestFinished(() => {
    vi.useRealTimers()
  })
  now = 0
  frames.length = 0
  // 终态渲染（不补齐、不裁掉末尾标记）时「- ***」是列表项里的分隔线。
  const text = ref('- 项一\n- ***')
  const streaming = ref(false)
  const blocks = useStreamingMarkdown(() => text.value, () => streaming.value)
  const { advance } = mountClock(blocks)
  assert.equal(fadeOf(blocks.value[0]), undefined, '含分隔线时回退 v-html')

  streaming.value = true
  text.value += '重点***'
  await advance(200)
  const fade = fadeOf(blocks.value[0])
  assert.ok(fade?.batches.length)
  assert.ok(fade.batches.every(batch => batch.start >= '项一'.length), '「项一」不进新批次')
})
