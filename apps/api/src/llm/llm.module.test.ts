import assert from 'node:assert/strict'
import process from 'node:process'
// eslint-disable-next-line test/no-import-node-test
import { describe, it } from 'node:test'
import { LLMConfigError } from '@agent/ai'
import { NestFactory } from '@nestjs/core'

import { LLMRuntimeConfigService } from './llm-runtime-config.service.js'
import { LlmModule } from './llm.module.js'
import 'reflect-metadata'

const ENV_NAMES = [
  'LLM_API_KEY',
  'LLM_BASE_URL',
  'LLM_MODEL',
  'AGENT_DEBUG_CAPTURE_MODEL_IO',
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

        assert.equal(config.captureModelIO, false)
      }
      finally {
        await app.close()
      }
    })
  })

  it('LLM_MODEL 不支持时应用上下文在初始化阶段失败', async () => {
    await withRuntimeEnv({ LLM_MODEL: 'unsupported-model' }, async () => {
      await assert.rejects(
        NestFactory.createApplicationContext(LlmModule, {
          abortOnError: false,
          logger: false,
        }),
        LLMConfigError,
      )
    })
  })
})

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
