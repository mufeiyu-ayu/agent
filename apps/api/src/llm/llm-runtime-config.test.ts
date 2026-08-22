import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test
import { describe, it } from 'node:test'

import {
  DEFAULT_LLM_RUNTIME_CONFIG,
  resolveChatRequestConfig,
  resolveLLMRuntimeConfig,
} from './llm-runtime-config.js'
import { LLMConfigError } from './llm.errors.js'

describe('resolveLLMRuntimeConfig', () => {
  it('缺省运维参数使用代码默认值', () => {
    const config = resolveLLMRuntimeConfig(createEnv())

    assert.deepEqual(config, {
      apiKey: 'test-api-key',
      baseUrl: 'https://api.deepseek.com/v1',
      model: 'deepseek-v4-flash',
      ...DEFAULT_LLM_RUNTIME_CONFIG,
    })
  })

  it('AGENT_DEBUG_CAPTURE_MODEL_IO 只接受 1 / true 为开启', () => {
    for (const enabled of ['1', 'true', 'TRUE', ' true ']) {
      assert.equal(
        resolveLLMRuntimeConfig(
          createEnv({ AGENT_DEBUG_CAPTURE_MODEL_IO: enabled }),
        ).captureModelIO,
        true,
      )
    }
    for (const disabled of [undefined, '', '0', 'false', 'yes', 'on']) {
      assert.equal(
        resolveLLMRuntimeConfig(
          createEnv(
            disabled === undefined
              ? {}
              : { AGENT_DEBUG_CAPTURE_MODEL_IO: disabled },
          ),
        ).captureModelIO,
        false,
      )
    }
  })

  it('接受边界内的严格正整数覆盖', () => {
    const config = resolveLLMRuntimeConfig(createEnv({
      LLM_CHAT_REQUEST_TIMEOUT_MS: '90000',
      LLM_STREAM_TIMEOUT_MS: '900000',
      LLM_DEFAULT_MAX_OUTPUT_TOKENS: '70000',
      LLM_APPLICATION_MAX_OUTPUT_TOKENS: '140000',
    }))

    assert.equal(config.chatRequestTimeoutMs, 90_000)
    assert.equal(config.streamTimeoutMs, 900_000)
    assert.equal(config.defaultMaxOutputTokens, 70_000)
    assert.equal(config.applicationMaxOutputTokens, 140_000)
  })

  it('拒绝空字符串、浮点、负数、0、NaN、Infinity、指数和超大值', () => {
    const invalidValues = [
      '',
      ' ',
      '1.5',
      '-1',
      '0',
      'NaN',
      'Infinity',
      '1e5',
      '9007199254740992',
      '2147483648',
    ]

    for (const value of invalidValues) {
      assert.throws(
        () => resolveLLMRuntimeConfig(createEnv({
          LLM_CHAT_REQUEST_TIMEOUT_MS: value,
        })),
        LLMConfigError,
      )
    }
  })

  it('拒绝默认输出大于应用硬上限', () => {
    assert.throws(
      () => resolveLLMRuntimeConfig(createEnv({
        LLM_DEFAULT_MAX_OUTPUT_TOKENS: '131073',
        LLM_APPLICATION_MAX_OUTPUT_TOKENS: '131072',
      })),
      LLMConfigError,
    )
  })

  it('拒绝应用硬上限大于当前模型 Provider 上限', () => {
    assert.throws(
      () => resolveLLMRuntimeConfig(createEnv({
        LLM_APPLICATION_MAX_OUTPUT_TOKENS: '384001',
      })),
      LLMConfigError,
    )
  })

  it('拒绝缺失或不支持的默认模型', () => {
    assert.throws(
      () => resolveLLMRuntimeConfig(createEnv({ LLM_MODEL: '' })),
      LLMConfigError,
    )
    assert.throws(
      () => resolveLLMRuntimeConfig(createEnv({ LLM_MODEL: 'unsupported-model' })),
      LLMConfigError,
    )
  })
})

describe('resolveChatRequestConfig', () => {
  it('使用已验证的默认模型和默认输出预算', () => {
    const runtimeConfig = resolveLLMRuntimeConfig(createEnv())

    assert.deepEqual(resolveChatRequestConfig(runtimeConfig), {
      model: 'deepseek-v4-flash',
      maxOutputTokens: 65_536,
    })
  })

  it('拒绝不支持的调用级模型及越过应用硬上限的输出预算', () => {
    const runtimeConfig = resolveLLMRuntimeConfig(createEnv())

    assert.throws(
      () => resolveChatRequestConfig(runtimeConfig, {
        model: 'unsupported-model',
      }),
      LLMConfigError,
    )
    assert.throws(
      () => resolveChatRequestConfig(runtimeConfig, {
        maxTokens: 131_073,
      }),
      LLMConfigError,
    )
  })
})

function createEnv(
  overrides: Record<string, string | undefined> = {},
): NodeJS.ProcessEnv {
  return {
    LLM_API_KEY: 'test-api-key',
    LLM_BASE_URL: 'https://api.deepseek.com/v1/',
    LLM_MODEL: 'deepseek-v4-flash',
    ...overrides,
  }
}
