import type {
  RegisteredTool,
  ToolExecutor,
} from './tool.types.js'
import assert from 'node:assert/strict'
// 项目本轮使用 Node 原生测试运行器，不引入额外测试框架。
// eslint-disable-next-line test/no-import-node-test
import { describe, it } from 'node:test'

import { ToolRegistryService } from './tool-registry.service.js'
import { ToolRegistryError } from './tool.errors.js'

interface EchoInput {
  message: string
}

interface EchoOutput {
  echoed: string
}

describe('ToolRegistryService', () => {
  it('注册、查找并按名称稳定列出 Definition', () => {
    const registry = new ToolRegistryService()
    const zebra = createEchoTool('zebra_tool')
    const alpha = createEchoTool('alpha_tool')

    registry.register(zebra)
    registry.register(alpha)

    assert.equal(registry.get('zebra_tool'), zebra)
    assert.deepEqual(
      registry.listDefinitions().map(definition => definition.name),
      ['alpha_tool', 'zebra_tool'],
    )
  })

  it('拒绝非法名称和重复注册', () => {
    const registry = new ToolRegistryService()

    assert.throws(
      () => registry.register(createEchoTool('Bad Tool')),
      (error: unknown) => error instanceof ToolRegistryError
        && error.code === 'invalid_tool_name',
    )

    registry.register(createEchoTool())
    assert.throws(
      () => registry.register(createEchoTool()),
      (error: unknown) => error instanceof ToolRegistryError
        && error.code === 'duplicate_tool',
    )
  })

  it('require 对未知工具给出明确错误', () => {
    const registry = new ToolRegistryService()

    assert.throws(
      () => registry.require('missing_tool'),
      (error: unknown) => error instanceof ToolRegistryError
        && error.code === 'unknown_tool',
    )
  })
})

function createEchoTool(
  name = 'echo',
  execute: ToolExecutor<EchoInput, EchoOutput>['execute'] = async invocation => ({
    ok: true,
    data: { echoed: invocation.input.message },
    modelContent: invocation.input.message,
  }),
): RegisteredTool<EchoInput, EchoOutput> {
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
      requiresApproval: false,
      idempotent: true,
      risk: { level: 'low', sideEffect: 'none', network: 'none' },
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
