import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test
import { describe, it } from 'node:test'

import {
  DEEPSEEK_MODEL_PROFILES,
  getModelProfile,
} from './model-profiles.js'

describe('DeepSeek model profiles', () => {
  it('记录两个支持模型的 Provider 能力，不混入应用默认值', () => {
    assert.deepEqual(DEEPSEEK_MODEL_PROFILES, {
      'deepseek-v4-flash': {
        id: 'deepseek-v4-flash',
        contextWindowTokens: 1_000_000,
        providerMaxOutputTokens: 384_000,
      },
      'deepseek-v4-pro': {
        id: 'deepseek-v4-pro',
        contextWindowTokens: 1_000_000,
        providerMaxOutputTokens: 384_000,
      },
    })
  })

  it('只为支持的模型返回 Profile', () => {
    assert.equal(getModelProfile('deepseek-v4-flash')?.id, 'deepseek-v4-flash')
    assert.equal(getModelProfile('unsupported-model'), undefined)
  })
})
