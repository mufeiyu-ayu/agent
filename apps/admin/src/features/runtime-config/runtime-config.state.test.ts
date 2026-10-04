import type { AdminRuntimeConfig } from '@agent/contracts'
import assert from 'node:assert/strict'
import { describe, it, onTestFinished, vi } from 'vitest'

import { createRuntimeConfigState, isRuntimeConfigDirty, toRuntimeConfigForm, toRuntimeConfigInput } from './runtime-config.state'

const CONFIG: AdminRuntimeConfig = {
  runDeadlineMs: 600_000,
  compactionKeepRecentTokens: 20_000,
  debugCaptureModelIo: false,
  serperApiKeyLast4: 'abcd',
  updatedAt: '2026-09-29T00:00:00.000Z',
}

describe('运行配置表单映射', () => {
  it('时限按秒编辑、按毫秒提交；Key 留空不提交，填了去首尾空白', () => {
    const form = toRuntimeConfigForm(CONFIG)

    assert.equal(form.runDeadlineSeconds, 600)
    assert.equal(form.compactionKeepRecentTokens, 20_000)
    assert.equal(form.serperApiKey, '')
    assert.deepEqual(toRuntimeConfigInput({ ...form, runDeadlineSeconds: 90, compactionKeepRecentTokens: 15_000 }), {
      runDeadlineMs: 90_000,
      compactionKeepRecentTokens: 15_000,
      debugCaptureModelIo: false,
    })
    assert.equal(toRuntimeConfigInput({ ...form, serperApiKey: '  sk-new  ' }).serperApiKey, 'sk-new')
  })

  it('没有改动时不可保存；改任一项或填了 Key 才算改动，Key 只填空白不算', () => {
    const form = toRuntimeConfigForm(CONFIG)

    assert.equal(isRuntimeConfigDirty(form, CONFIG), false)
    assert.equal(isRuntimeConfigDirty({ ...form, serperApiKey: '   ' }, CONFIG), false)
    assert.equal(isRuntimeConfigDirty({ ...form, serperApiKey: 'sk' }, CONFIG), true)
    assert.equal(isRuntimeConfigDirty({ ...form, runDeadlineSeconds: 120 }, CONFIG), true)
    assert.equal(isRuntimeConfigDirty({ ...form, compactionKeepRecentTokens: 15_000 }, CONFIG), true)
    assert.equal(isRuntimeConfigDirty({ ...form, debugCaptureModelIo: true }, CONFIG), true)
  })
})

it('加载与保存各自防重复，失败后复位并可重试，保存仍映射为毫秒且不回填密钥', async () => {
  const requests: { method: string, body: unknown, resolve: (response: Response) => void }[] = []
  const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation((_url, init) => new Promise<Response>((resolve) => {
    requests.push({ method: init!.method!, body: init?.body ? JSON.parse(String(init.body)) : undefined, resolve })
  }))
  onTestFinished(() => fetch.mockRestore())
  const state = createRuntimeConfigState()
  const respond = (index: number, status: number) => requests[index]!.resolve(new Response(JSON.stringify({
    success: status === 200,
    data: CONFIG,
    message: '保存失败',
  }), { status }))

  const load = state.load()
  await state.load()
  assert.equal(requests.length, 1)
  assert.equal(state.loading.value, true)
  respond(0, 200)
  await load
  assert.equal(state.loading.value, false)
  assert.deepEqual(state.config.value, CONFIG)

  const form = { ...toRuntimeConfigForm(CONFIG), runDeadlineSeconds: 90 }
  const save = state.save(form)
  await assert.rejects(state.save(form), /操作正在进行/)
  assert.equal(requests.length, 2)
  assert.equal(requests[1]!.method, 'PATCH')
  assert.equal((requests[1]!.body as { runDeadlineMs: number }).runDeadlineMs, 90_000)
  assert.equal(state.saving.value, true)
  respond(1, 502)
  await assert.rejects(save, /保存失败/)
  assert.equal(state.saving.value, false)
  assert.deepEqual(state.config.value, CONFIG)
  const retry = state.save(form)
  respond(2, 200)
  await retry
  assert.equal(state.saving.value, false)
  assert.equal(requests.length, 3)
})
