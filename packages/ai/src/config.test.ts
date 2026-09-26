import assert from 'node:assert/strict'
import { familyCompatOf } from '@agent/contracts'

import { describe, it } from 'vitest'

import { resolveChatRequestConfig } from './config.js'

const DEEPSEEK_PROFILE = {
  wireName: 'deepseek-v4-flash',
  contextWindowTokens: 1_000_000,
  maxOutputTokens: 384_000,
  compat: familyCompatOf('deepseek'),
  reasoningEffort: 'high',
} as const

/** 中转站后面的非 thinking 家族：不发 thinking，Tool Call 不要求 reasoning_content。 */
const RELAY_COMPAT = familyCompatOf('openai')

describe('resolveChatRequestConfig', () => {
  it('模型名、上下文、输出上限与默认 reasoningEffort 直接取模型行', () => {
    assert.deepEqual(resolveChatRequestConfig(DEEPSEEK_PROFILE), {
      model: 'deepseek-v4-flash',
      contextWindowTokens: 1_000_000,
      maxOutputTokens: 384_000,
      compat: { thinkingFormat: 'deepseek', requiresReasoningContent: true, toolCallIndexOptional: false, toolCallsMayFinishWithStop: false },
      reasoningEffort: 'high',
    })
  })

  it('模型行没配 reasoningEffort 且请求没覆盖时，不带这个键', () => {
    assert.deepEqual(
      resolveChatRequestConfig({ ...DEEPSEEK_PROFILE, compat: RELAY_COMPAT, reasoningEffort: null }),
      {
        model: 'deepseek-v4-flash',
        contextWindowTokens: 1_000_000,
        maxOutputTokens: 384_000,
        compat: RELAY_COMPAT,
      },
    )
  })

  it('请求级只覆盖 reasoningEffort，compat 随模型行', () => {
    assert.deepEqual(
      resolveChatRequestConfig(
        { ...DEEPSEEK_PROFILE, compat: RELAY_COMPAT, wireName: 'gpt-5.6-sol', maxOutputTokens: 8_192 },
        { reasoningEffort: 'max' },
      ),
      {
        model: 'gpt-5.6-sol',
        contextWindowTokens: 1_000_000,
        maxOutputTokens: 8_192,
        compat: RELAY_COMPAT,
        reasoningEffort: 'max',
      },
    )
  })
})
