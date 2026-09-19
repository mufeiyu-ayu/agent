import type {
  RegisteredTool,
  ToolExecutor,
} from './tool.types.js'
import assert from 'node:assert/strict'
// 项目本轮使用 Node 原生测试运行器，不引入额外测试框架。
// eslint-disable-next-line test/no-import-node-test
import { describe, it } from 'node:test'

import { ToolRegistryService } from './tool-registry.service.js'

interface EchoInput {
  message: string
}

describe('ToolRegistryService', () => {
  it('注册并按名称查找 Tool', () => {
    const registry = new ToolRegistryService()
    const zebra = createEchoTool('zebra_tool')
    const alpha = createEchoTool('alpha_tool')

    registry.register(zebra)
    registry.register(alpha)

    assert.equal(registry.get('zebra_tool'), zebra)
    assert.equal(registry.get('alpha_tool'), alpha)
  })

  it('拒绝重复注册', () => {
    const registry = new ToolRegistryService()

    registry.register(createEchoTool())
    assert.throws(() => registry.register(createEchoTool()), /工具已注册：echo/)
  })

  it('未注册的工具查找返回 undefined', () => {
    const registry = new ToolRegistryService()

    assert.equal(registry.get('missing_tool'), undefined)
  })
})

function createEchoTool(
  name = 'echo',
  execute: ToolExecutor<EchoInput>['execute'] = async invocation => ({
    ok: true,
    modelContent: invocation.input.message,
  }),
): RegisteredTool<EchoInput> {
  return {
    definition: {
      name,
      version: '1',
      description: '回显输入消息。',
      input: {
        schema: {
          type: 'object',
          properties: { message: { type: 'string' } },
          required: ['message'],
          additionalProperties: false,
        },
        parse: parseEchoInput,
      },
      timeoutMs: 1_000,
      maxObservationChars: 8_000,
      evidencePolicy: 'discovery_only',
    },
    executor: { execute },
  }
}

function parseEchoInput(value: unknown): EchoInput {
  if (
    typeof value !== 'object'
    || value === null
    || Array.isArray(value)
  ) {
    throw new Error('invalid echo input')
  }

  const record = value as Record<string, unknown>

  if (
    Object.keys(value).length !== 1
    || !Object.hasOwn(value, 'message')
    || typeof record.message !== 'string'
  ) {
    throw new Error('invalid echo input')
  }

  return { message: record.message }
}
