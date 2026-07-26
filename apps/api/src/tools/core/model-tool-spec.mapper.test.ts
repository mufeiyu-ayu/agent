import type { ToolDefinition } from './tool.types.js'
import assert from 'node:assert/strict'
// 项目本轮使用 Node 原生测试运行器，不引入额外测试框架。
// eslint-disable-next-line test/no-import-node-test
import { describe, it } from 'node:test'

import { toModelToolSpec } from './model-tool-spec.mapper.js'

describe('toModelToolSpec', () => {
  it('ModelToolSpec 只包含模型可见字段', () => {
    const definition: ToolDefinition = {
      name: 'echo',
      version: '1',
      description: '回显输入消息。',
      input: {
        schema: {
          type: 'object',
          properties: { message: { type: 'string' } },
          required: ['message'],
          additionalProperties: false,
        },
        parse: value => value,
      },
      timeoutMs: 1_000,
      maxObservationChars: 8_000,
      requiresApproval: false,
      idempotent: true,
      risk: { level: 'low', sideEffect: 'none', network: false },
    }

    assert.deepEqual(toModelToolSpec(definition), {
      name: 'echo',
      description: '回显输入消息。',
      inputSchema: definition.input.schema,
    })
  })
})
