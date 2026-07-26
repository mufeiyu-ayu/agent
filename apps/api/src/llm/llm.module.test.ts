import assert from 'node:assert/strict'
import process from 'node:process'
// eslint-disable-next-line test/no-import-node-test
import { describe, it } from 'node:test'
import { NestFactory } from '@nestjs/core'

import {
  LLMRuntimeConfigService,
} from './llm-runtime-config.js'
import { LLMConfigError } from './llm.errors.js'
import { LlmModule } from './llm.module.js'
import 'reflect-metadata'

const ENV_NAMES = [
  'LLM_API_KEY',
  'LLM_BASE_URL',
  'LLM_MODEL',
  'LLM_CHAT_REQUEST_TIMEOUT_MS',
  'LLM_STREAM_TIMEOUT_MS',
  'LLM_DEFAULT_MAX_OUTPUT_TOKENS',
  'LLM_APPLICATION_MAX_OUTPUT_TOKENS',
] as const

describe('LlmModule fail-fast assembly', () => {
  it('应用上下文初始化时真实实例化配置 Provider 并使用默认值', async () => {
    await withRuntimeEnv({}, async () => {
      const app = await NestFactory.createApplicationContext(LlmModule, {
        abortOnError: false,
        logger: false,
      })

      try {
        const config = app.get(LLMRuntimeConfigService).value

        assert.equal(config.chatRequestTimeoutMs, 60_000)
        assert.equal(config.metadataRequestTimeoutMs, 10_000)
        assert.equal(config.streamTimeoutMs, 600_000)
        assert.equal(config.defaultMaxOutputTokens, 65_536)
        assert.equal(config.applicationMaxOutputTokens, 131_072)
      }
      finally {
        await app.close()
      }
    })
  })

  it('非法环境变量让应用上下文在初始化阶段失败', async () => {
    await assertModuleInitializationFails({
      LLM_CHAT_REQUEST_TIMEOUT_MS: '0',
    })
  })

  it('默认输出大于应用硬上限时初始化失败', async () => {
    await assertModuleInitializationFails({
      LLM_DEFAULT_MAX_OUTPUT_TOKENS: '131073',
      LLM_APPLICATION_MAX_OUTPUT_TOKENS: '131072',
    })
  })

  it('应用硬上限大于当前模型 Provider 上限时初始化失败', async () => {
    await assertModuleInitializationFails({
      LLM_APPLICATION_MAX_OUTPUT_TOKENS: '384001',
    })
  })
})

async function assertModuleInitializationFails(
  overrides: Record<string, string>,
): Promise<void> {
  await withRuntimeEnv(overrides, async () => {
    await assert.rejects(
      NestFactory.createApplicationContext(LlmModule, {
        abortOnError: false,
        logger: false,
      }),
      LLMConfigError,
    )
  })
}

async function withRuntimeEnv(
  overrides: Record<string, string>,
  operation: () => Promise<void>,
): Promise<void> {
  const previousValues = new Map(
    ENV_NAMES.map(name => [name, process.env[name]]),
  )

  try {
    for (const name of ENV_NAMES)
      delete process.env[name]

    Object.assign(process.env, {
      LLM_API_KEY: 'test-api-key',
      LLM_BASE_URL: 'https://api.deepseek.com/v1',
      LLM_MODEL: 'deepseek-v4-flash',
      ...overrides,
    })
    await operation()
  }
  finally {
    for (const [name, value] of previousValues) {
      if (value === undefined)
        delete process.env[name]
      else
        process.env[name] = value
    }
  }
}
