import type {
  RegisteredTool,
  ToolExecutionContext,
  ToolExecutor,
  ValidatedToolInvocation,
} from './tool.types.js'
import assert from 'node:assert/strict'
// 项目本轮使用 Node 原生测试运行器，不引入额外测试框架。
// eslint-disable-next-line test/no-import-node-test
import { describe, it } from 'node:test'

import { toModelToolSpec } from './model-tool-spec.mapper.js'
import { ToolInvocationService } from './tool-invocation.service.js'
import { ToolRegistryService } from './tool-registry.service.js'
import { ToolRegistryError } from './tool.errors.js'
import { ToolsModule } from './tools.module.js'

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

describe('ToolInvocationService', () => {
  it('未知工具返回结构化失败', async () => {
    const service = new ToolInvocationService(new ToolRegistryService())

    assert.deepEqual(
      await service.invoke(createEnvelope('missing_tool'), createContext()),
      {
        ok: false,
        code: 'unknown_tool',
        modelContent: '工具 missing_tool 不存在。',
        retryable: false,
      },
    )
  })

  it('拒绝非法 JSON、缺字段、错类型和额外字段，且不执行工具', async () => {
    let executionCount = 0
    const registry = new ToolRegistryService()
    registry.register(createEchoTool('echo', async () => {
      executionCount += 1
      return { ok: true, data: { echoed: 'unexpected' }, modelContent: 'unexpected' }
    }))
    const service = new ToolInvocationService(registry)
    const invalidArguments = [
      '{',
      '{}',
      '{"message":1}',
      '{"message":"hello","extra":true}',
    ]

    for (const rawArgumentsJson of invalidArguments) {
      const result = await service.invoke(
        { ...createEnvelope(), rawArgumentsJson },
        createContext(),
      )

      assert.equal(result.ok, false)
      assert.equal(result.ok ? undefined : result.code, 'invalid_arguments')
    }

    assert.equal(executionCount, 0)
  })

  it('合法调用只把已验证参数与 Registry 版本交给 Executor', async () => {
    let receivedInvocation: ValidatedToolInvocation<EchoInput> | undefined
    let receivedContext: ToolExecutionContext | undefined
    const registry = new ToolRegistryService()
    registry.register(createEchoTool('echo', async (invocation, context) => {
      receivedInvocation = invocation
      receivedContext = context
      return {
        ok: true,
        data: { echoed: invocation.input.message },
        modelContent: invocation.input.message,
      }
    }))
    const service = new ToolInvocationService(registry)
    const context = createContext()

    const result = await service.invoke(createEnvelope(), context)

    assert.deepEqual(result, {
      ok: true,
      data: { echoed: 'hello' },
      modelContent: 'hello',
    })
    assert.deepEqual(receivedInvocation, {
      callId: 'call-1',
      toolName: 'echo',
      toolVersion: '1',
      samplingAttemptId: 'sampling-2',
      input: { message: 'hello' },
    })
    assert.equal(receivedContext, context)
  })

  it('把普通执行异常转换为安全失败，不泄漏原始错误', async () => {
    const registry = new ToolRegistryService()
    registry.register(createEchoTool('echo', async () => {
      throw new Error('database password: secret')
    }))
    const service = new ToolInvocationService(registry)

    const result = await service.invoke(createEnvelope(), createContext())

    assert.equal(result.ok, false)
    assert.equal(result.ok ? undefined : result.code, 'execution_failed')
    assert.doesNotMatch(result.modelContent, /password|secret/)
  })

  it('已触发的 AbortSignal 不执行工具，并继续抛出 Abort', async () => {
    let executionCount = 0
    const registry = new ToolRegistryService()
    registry.register(createEchoTool('echo', async () => {
      executionCount += 1
      return { ok: true, data: { echoed: 'unexpected' }, modelContent: 'unexpected' }
    }))
    const service = new ToolInvocationService(registry)
    const abortController = new AbortController()
    abortController.abort()

    await assert.rejects(
      service.invoke(createEnvelope(), createContext(abortController.signal)),
      { name: 'AbortError' },
    )
    assert.equal(executionCount, 0)
  })

  it('Executor 抛出的 AbortError 继续向上抛出', async () => {
    const registry = new ToolRegistryService()
    registry.register(createEchoTool('echo', async () => {
      throw new DOMException('aborted', 'AbortError')
    }))
    const service = new ToolInvocationService(registry)

    await assert.rejects(
      service.invoke(createEnvelope(), createContext()),
      { name: 'AbortError' },
    )
  })
})

describe('模型映射与 NestJS 模块', () => {
  it('ModelToolSpec 只包含模型可见字段', () => {
    const definition = createEchoTool().definition

    assert.deepEqual(toModelToolSpec(definition), {
      name: 'echo',
      description: '回显输入消息。',
      inputSchema: definition.input.schema,
    })
  })

  it('ToolsModule 提供并导出 Registry 与 InvocationService', () => {
    const providers = Reflect.getMetadata('providers', ToolsModule)
    const exports = Reflect.getMetadata('exports', ToolsModule)

    assert.deepEqual(providers, [ToolRegistryService, ToolInvocationService])
    assert.deepEqual(exports, [ToolRegistryService, ToolInvocationService])
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
      requiresApproval: false,
      idempotent: true,
      risk: { level: 'low', sideEffect: 'none', network: false },
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

function createEnvelope(toolName = 'echo') {
  return {
    callId: 'call-1',
    toolName,
    rawArgumentsJson: '{"message":"hello"}',
    samplingAttemptId: 'sampling-2',
  }
}

function createContext(signal = new AbortController().signal): ToolExecutionContext {
  return {
    runId: 'run-1',
    conversationId: 'conversation-1',
    signal,
    executionAttempt: 1,
  }
}
