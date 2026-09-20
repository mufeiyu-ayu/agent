import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test
import { describe, it } from 'node:test'

import { resolveChatRequestConfig } from './config.js'

const DEEPSEEK_PROFILE = {
  wireName: 'deepseek-v4-flash',
  contextWindowTokens: 1_000_000,
  maxOutputTokens: 384_000,
  reasoning: true,
}

describe('resolveChatRequestConfig', () => {
  it('模型名、上下文与输出上限直接取模型行，reasoningEffort 回落 high', () => {
    assert.deepEqual(resolveChatRequestConfig(DEEPSEEK_PROFILE), {
      model: 'deepseek-v4-flash',
      contextWindowTokens: 1_000_000,
      maxOutputTokens: 384_000,
      reasoning: true,
      reasoningEffort: 'high',
    })
  })

  it('请求级只覆盖 reasoningEffort，reasoning 随模型行', () => {
    assert.deepEqual(
      resolveChatRequestConfig(
        { ...DEEPSEEK_PROFILE, reasoning: false, wireName: 'gpt-5.6-sol', maxOutputTokens: 8_192 },
        { reasoningEffort: 'max' },
      ),
      {
        model: 'gpt-5.6-sol',
        contextWindowTokens: 1_000_000,
        maxOutputTokens: 8_192,
        reasoning: false,
        reasoningEffort: 'max',
      },
    )
  })
})
