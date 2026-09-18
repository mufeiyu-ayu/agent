import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test
import { describe, it } from 'node:test'

import {
  resolveChatRequestConfig,
  resolveLLMRuntimeConfig,
} from './config.js'
import { LLMAuthError, LLMConfigError } from './errors.js'

describe('resolveLLMRuntimeConfig', () => {
  it('只保留三个必填 env 与 debug 开关，baseUrl 去尾斜杠', () => {
    assert.deepEqual(resolveLLMRuntimeConfig(createEnv()), {
      apiKey: 'test-api-key',
      baseUrl: 'https://api.deepseek.com/v1',
      model: 'deepseek-v4-flash',
      captureModelIO: false,
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

  it('LLM_API_KEY 缺失抛 LLMAuthError', () => {
    assert.throws(
      () => resolveLLMRuntimeConfig(createEnv({ LLM_API_KEY: undefined })),
      LLMAuthError,
    )
    assert.throws(
      () => resolveLLMRuntimeConfig(createEnv({ LLM_API_KEY: ' ' })),
      LLMAuthError,
    )
  })

  it('LLM_BASE_URL 缺失抛 LLMConfigError', () => {
    assert.throws(
      () => resolveLLMRuntimeConfig(createEnv({ LLM_BASE_URL: undefined })),
      LLMConfigError,
    )
    assert.throws(
      () => resolveLLMRuntimeConfig(createEnv({ LLM_BASE_URL: '' })),
      LLMConfigError,
    )
  })

  it('LLM_MODEL 缺失或不支持抛 LLMConfigError', () => {
    assert.throws(
      () => resolveLLMRuntimeConfig(createEnv({ LLM_MODEL: undefined })),
      LLMConfigError,
    )
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
      contextWindowTokens: 1_000_000,
      maxOutputTokens: 65_536,
      reasoningEffort: 'high',
    })
  })

  it('resolved 配置携带调用级覆盖后的完整模型事实', () => {
    const runtimeConfig = resolveLLMRuntimeConfig(createEnv())

    assert.deepEqual(
      resolveChatRequestConfig(runtimeConfig, {
        reasoningEffort: 'max',
        maxTokens: 4_096,
      }),
      {
        model: 'deepseek-v4-flash',
        contextWindowTokens: 1_000_000,
        maxOutputTokens: 4_096,
        reasoningEffort: 'max',
      },
    )
  })

  it('调用级 maxTokens 只受 Provider 上限约束', () => {
    const runtimeConfig = resolveLLMRuntimeConfig(createEnv())

    assert.equal(
      resolveChatRequestConfig(runtimeConfig, { maxTokens: 384_000 })
        .maxOutputTokens,
      384_000,
    )
    assert.throws(
      () => resolveChatRequestConfig(runtimeConfig, { maxTokens: 384_001 }),
      LLMConfigError,
    )
    assert.throws(
      () => resolveChatRequestConfig(runtimeConfig, { maxTokens: 0 }),
      LLMConfigError,
    )
  })

  it('拒绝不支持的调用级模型', () => {
    const runtimeConfig = resolveLLMRuntimeConfig(createEnv())

    assert.throws(
      () => resolveChatRequestConfig(runtimeConfig, {
        model: 'unsupported-model',
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
