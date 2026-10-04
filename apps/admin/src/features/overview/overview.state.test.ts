import assert from 'node:assert/strict'
import { setImmediate } from 'node:timers/promises'
import { it, onTestFinished, vi } from 'vitest'
import { effectScope, nextTick } from 'vue'
import { useOverviewDashboard } from './overview.state'

it('刷新等待统计与余额；切换窗口仅重取统计，旧结果和 finally 不能覆盖新请求，失败可重试', async () => {
  const requests: { url: string, signal: AbortSignal, resolve: (response: Response) => void }[] = []
  const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation((url, init) => new Promise<Response>((resolve) => {
    requests.push({ url: String(url), signal: init!.signal as AbortSignal, resolve })
  }))
  const scope = effectScope()
  onTestFinished(() => {
    scope.stop()
    fetch.mockRestore()
  })
  const state = scope.run(useOverviewDashboard)!
  const respond = async (index: number, data: unknown, status = 200) => {
    requests[index]!.resolve(new Response(JSON.stringify({ success: status === 200, data, message: '失败' }), { status }))
    await setImmediate()
  }

  assert.equal(requests.length, 2)
  await respond(0, { window: '30d' })
  assert.equal(state.statsLoading.value, false)
  assert.equal(state.balanceLoading.value, true)
  state.refresh()
  assert.equal(requests.length, 2, '余额尚未返回时不重复刷新两路接口')
  await respond(1, { available: true, currency: 'CNY', totalBalance: '12' })
  state.refresh()
  state.refresh()
  assert.equal(requests.length, 4)

  state.activeWindow.value = '7d'
  await nextTick()
  assert.equal(requests.length, 5)
  assert.equal(requests[2]!.signal.aborted, true)
  assert.match(requests[4]!.url, /window=7d/)
  await respond(2, { window: 'stale' })
  assert.equal(state.statsLoading.value, true)
  assert.equal(state.stats.value?.window, '30d')
  await respond(4, null, 502)
  assert.equal(state.statsLoading.value, false)
  assert.equal(state.statsError.value, '失败')
  const retry = state.loadStats()
  assert.equal(requests.length, 6)
  await respond(5, { window: '7d' })
  await retry
  assert.equal(state.stats.value?.window, '7d')
  await respond(3, null, 502)
  assert.equal(state.balance.value?.available, false)
  assert.equal(state.balanceLoading.value, false)
  state.refresh()
  assert.equal(requests.length, 8, '完成后手动刷新仍真正请求两路接口')
  scope.stop()
  assert.equal(requests[6]!.signal.aborted, true)
  assert.equal(requests[7]!.signal.aborted, true)
})
