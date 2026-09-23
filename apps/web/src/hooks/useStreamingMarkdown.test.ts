import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test
import test from 'node:test'

import { nextTick, ref } from 'vue'

// hook 只用到这几个浏览器 API：换成可控时钟与手动推进的 rAF。
let now = 0
const frames: Array<() => void> = []

Object.assign(globalThis, {
  document: { visibilityState: 'visible', addEventListener() {}, removeEventListener() {} },
  requestAnimationFrame: (callback: FrameRequestCallback) => frames.push(() => callback(now)),
  cancelAnimationFrame: () => {},
})
Object.defineProperty(performance, 'now', { configurable: true, value: () => now })

const { useStreamingMarkdown } = await import('./useStreamingMarkdown')

/** 流式中一次性到达 `backlog` 个字符并立刻结束（Grounding 重放后紧跟 done），返回放完所用的时间。 */
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

test('#169 AC-05 流结束时积压多少都在 150ms 内提交完整正文', async () => {
  for (const backlog of [20, 500, 2000])
    assert.ok(await settleDuration(backlog) <= 150, `积压 ${backlog} 字`)
})
