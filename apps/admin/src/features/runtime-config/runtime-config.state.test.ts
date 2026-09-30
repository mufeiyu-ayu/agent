import type { AdminRuntimeConfig } from '@agent/contracts'
import assert from 'node:assert/strict'
import { describe, it } from 'vitest'

import { isRuntimeConfigDirty, toRuntimeConfigForm, toRuntimeConfigInput } from './runtime-config.state'

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
