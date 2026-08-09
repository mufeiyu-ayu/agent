import type { DatabaseOperationDeadline } from '../../prisma/prisma.service.js'
import type {
  RegisteredTool,
  ToolExecutionContext,
  ToolExecutor,
  ToolResult,
  ValidatedToolInvocation,
} from './tool.types.js'
import assert from 'node:assert/strict'
// 项目本轮使用 Node 原生测试运行器，不引入额外测试框架。
// eslint-disable-next-line test/no-import-node-test
import { describe, it } from 'node:test'

import { DatabaseOperationDeadlineExceededError } from '../../prisma/prisma.service.js'
import { ToolInvocationService } from './tool-invocation.service.js'
import { ToolRegistryService } from './tool-registry.service.js'

interface EchoInput {
  message: string
}

interface EchoOutput {
  echoed: string
}

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
    const startedAt = Date.now()

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
    assert.ok(receivedContext)
    assert.equal(receivedContext.runId, context.runId)
    assert.equal(receivedContext.conversationId, context.conversationId)
    assert.notEqual(receivedContext.databaseDeadline, context.databaseDeadline)
    assert.equal(receivedContext.databaseDeadline.signal, receivedContext.signal)
    assert.ok(receivedContext.databaseDeadline.deadlineAt >= startedAt)
    assert.ok(receivedContext.databaseDeadline.deadlineAt < context.databaseDeadline.deadlineAt)
    assert.equal(receivedContext.executionAttempt, 1)
    assert.notEqual(receivedContext.signal, context.signal)
    assert.equal(receivedContext.signal.aborted, false)
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

  it('Tool deadline 更早时把数据库 timeout 保持为 Tool timeout', async () => {
    let receivedDeadline: DatabaseOperationDeadline | undefined
    const registry = new ToolRegistryService()
    const tool = createEchoTool('echo', async (_, context) => {
      receivedDeadline = context.databaseDeadline
      throw context.databaseDeadline.createTimeoutError()
    })

    tool.definition.timeoutMs = 20
    registry.register(tool)
    const service = new ToolInvocationService(registry)
    const context = createContext()
    const result = await service.invoke(createEnvelope(), context)

    assert.ok(receivedDeadline)
    assert.ok(receivedDeadline.deadlineAt < context.databaseDeadline.deadlineAt)
    assert.deepEqual(result, {
      ok: false,
      code: 'timeout',
      modelContent: '工具 echo 执行超时。',
      retryable: false,
    })
  })

  it('Run deadline 更早时保留数据库 deadline 错误并交回 Runtime 归因', async () => {
    const deadlineError = new DatabaseOperationDeadlineExceededError()
    const registry = new ToolRegistryService()
    const tool = createEchoTool('echo', async (_, context) => {
      throw context.databaseDeadline.createTimeoutError()
    })
    const context = createContext()

    tool.definition.timeoutMs = 1_000
    context.databaseDeadline = {
      ...context.databaseDeadline,
      deadlineAt: Date.now() + 100,
      createTimeoutError: () => deadlineError,
    }
    registry.register(tool)
    const service = new ToolInvocationService(registry)

    await assert.rejects(
      service.invoke(createEnvelope(), context),
      error => error === deadlineError,
    )
  })

  it('拒绝当前阶段不支持的风险和审批配置，且不执行工具', async () => {
    let executionCount = 0
    const execute: ToolExecutor<EchoInput, EchoOutput>['execute'] = async () => {
      executionCount += 1
      return { ok: true, data: { echoed: 'unexpected' }, modelContent: 'unexpected' }
    }
    const approvalTool = createEchoTool('approval_tool', execute)
    const mediumRiskTool = createEchoTool('medium_risk_tool', execute)
    const writeTool = createEchoTool('write_tool', execute)
    const networkTool = createEchoTool('network_tool', execute)
    approvalTool.definition.requiresApproval = true
    mediumRiskTool.definition.risk.level = 'medium'
    writeTool.definition.risk.sideEffect = 'external_write'
    networkTool.definition.risk.network = true

    const registry = new ToolRegistryService()
    const tools = [approvalTool, mediumRiskTool, writeTool, networkTool]

    for (const tool of tools)
      registry.register(tool)

    const service = new ToolInvocationService(registry)

    for (const tool of tools) {
      const result = await service.invoke(
        createEnvelope(tool.definition.name),
        createContext(),
      )

      assert.equal(result.ok, false)
      assert.equal(result.ok ? undefined : result.code, 'execution_failed')
    }

    assert.equal(executionCount, 0)
  })

  it('已触发的 AbortSignal 优先于工具查找和参数验证，且不执行工具', async () => {
    let executionCount = 0
    const registry = new ToolRegistryService()
    registry.register(createEchoTool('echo', async () => {
      executionCount += 1
      return { ok: true, data: { echoed: 'unexpected' }, modelContent: 'unexpected' }
    }))
    const service = new ToolInvocationService(registry)
    const abortController = new AbortController()
    abortController.abort()

    const envelopes = [
      createEnvelope('missing_tool'),
      { ...createEnvelope(), rawArgumentsJson: '{' },
      createEnvelope(),
    ]

    for (const envelope of envelopes) {
      await assert.rejects(
        service.invoke(envelope, createContext(abortController.signal)),
        { name: 'AbortError' },
      )
    }

    assert.equal(executionCount, 0)
  })

  it('Executor 返回期间触发的 AbortSignal 仍继续抛出 Abort', async () => {
    const abortController = new AbortController()
    const registry = new ToolRegistryService()
    registry.register(createEchoTool('echo', async () => {
      abortController.abort()
      return { ok: true, data: { echoed: 'unexpected' }, modelContent: 'unexpected' }
    }))
    const service = new ToolInvocationService(registry)

    await assert.rejects(
      service.invoke(createEnvelope(), createContext(abortController.signal)),
      { name: 'AbortError' },
    )
  })

  it('没有用户取消或 timeout 时把 Executor 的 AbortError 转成安全失败', async () => {
    const registry = new ToolRegistryService()
    registry.register(createEchoTool('echo', async () => {
      throw new DOMException('aborted', 'AbortError')
    }))
    const service = new ToolInvocationService(registry)

    assert.deepEqual(
      await service.invoke(createEnvelope(), createContext()),
      {
        ok: false,
        code: 'execution_failed',
        modelContent: '工具 echo 执行失败。',
        retryable: false,
      },
    )
  })

  it('Executor 忽略 signal 时调用方仍按 Tool timeout 返回，但不声称底层工作已停止', async () => {
    let executionCount = 0
    const registry = new ToolRegistryService()
    const tool = createEchoTool('echo', async () => {
      executionCount += 1
      return await new Promise(() => {})
    })

    tool.definition.timeoutMs = 20
    registry.register(tool)
    const service = new ToolInvocationService(registry)
    const watchdog = createWatchdog(200)
    let outcome: ToolResult | 'watchdog'

    try {
      outcome = await Promise.race([
        service.invoke(createEnvelope(), createContext()),
        watchdog.promise,
      ])
    }
    finally {
      watchdog.clear()
    }

    assert.notEqual(outcome, 'watchdog')
    assert.deepEqual(outcome, {
      ok: false,
      code: 'timeout',
      modelContent: '工具 echo 执行超时。',
      retryable: false,
    })
    assert.equal(executionCount, 1)
  })

  it('用户 abort 先于 timeout 时继续抛 AbortError，而不是返回 timeout', async () => {
    const abortController = new AbortController()
    const registry = new ToolRegistryService()
    const tool = createEchoTool('echo', async () => await new Promise(() => {}))

    tool.definition.timeoutMs = 200
    registry.register(tool)
    const service = new ToolInvocationService(registry)
    const abortTimer = setTimeout(() => abortController.abort(), 10)
    const watchdog = createWatchdog(300)

    try {
      const outcome = await Promise.race([
        service.invoke(createEnvelope(), createContext(abortController.signal)).then(
          result => result,
          error => error as unknown,
        ),
        watchdog.promise,
      ])

      assert.notEqual(outcome, 'watchdog')
      assert.ok(outcome instanceof Error)
      assert.equal(outcome.name, 'AbortError')
    }
    finally {
      clearTimeout(abortTimer)
      watchdog.clear()
    }
  })

  it('timeout 会中止传给 Executor 的组合 signal', async () => {
    let executionSignal: AbortSignal | undefined
    const registry = new ToolRegistryService()
    const tool = createEchoTool('echo', async (_, context) => {
      executionSignal = context.signal
      return await new Promise(() => {})
    })

    tool.definition.timeoutMs = 20
    registry.register(tool)
    const service = new ToolInvocationService(registry)

    const result = await service.invoke(createEnvelope(), createContext())

    assert.equal(result.ok, false)
    assert.equal(result.ok ? undefined : result.code, 'timeout')
    assert.ok(executionSignal)
    assert.equal(executionSignal.aborted, true)
  })

  it('timeout 后 Executor 晚到 resolve 或 reject 不改变结果且不产生 unhandled rejection', async () => {
    for (const lateOutcome of ['resolve', 'reject'] as const) {
      const deferred = createDeferredToolResult()
      const unhandledReasons: unknown[] = []
      const onUnhandledRejection = (reason: unknown) => unhandledReasons.push(reason)
      const registry = new ToolRegistryService()
      const tool = createEchoTool('echo', async () => await deferred.promise)

      tool.definition.timeoutMs = 20
      registry.register(tool)
      const service = new ToolInvocationService(registry)
      process.on('unhandledRejection', onUnhandledRejection)

      try {
        const result = await service.invoke(createEnvelope(), createContext())

        if (lateOutcome === 'resolve') {
          deferred.resolve({
            ok: true,
            data: { echoed: 'late' },
            modelContent: 'late',
          })
        }
        else {
          deferred.reject(new Error('late database password: secret'))
        }

        await delay(20)
        assert.deepEqual(result, {
          ok: false,
          code: 'timeout',
          modelContent: '工具 echo 执行超时。',
          retryable: false,
        })
        assert.deepEqual(unhandledReasons, [])
      }
      finally {
        process.off('unhandledRejection', onUnhandledRejection)
      }
    }
  })

  it('Executor 提前完成后清理 timeout timer 和用户 signal listener', async () => {
    const abortController = new AbortController()
    let executionSignal: AbortSignal | undefined
    const registry = new ToolRegistryService()
    const tool = createEchoTool('echo', async (invocation, context) => {
      executionSignal = context.signal
      return {
        ok: true,
        data: { echoed: invocation.input.message },
        modelContent: invocation.input.message,
      }
    })

    tool.definition.timeoutMs = 20
    registry.register(tool)
    const service = new ToolInvocationService(registry)

    await service.invoke(createEnvelope(), createContext(abortController.signal))
    await delay(30)
    assert.ok(executionSignal)
    assert.equal(executionSignal.aborted, false)

    abortController.abort()
    assert.equal(executionSignal.aborted, false)
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
    databaseDeadline: createDatabaseDeadline(signal),
    signal,
    executionAttempt: 1,
  }
}

function createDatabaseDeadline(signal: AbortSignal): DatabaseOperationDeadline {
  return {
    deadlineAt: Date.now() + 60_000,
    signal,
    createTimeoutError: () => new DatabaseOperationDeadlineExceededError(),
  }
}

function delay(durationMs: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, durationMs))
}

function createWatchdog(durationMs: number): {
  promise: Promise<'watchdog'>
  clear: () => void
} {
  let timeoutId: ReturnType<typeof setTimeout> | undefined
  const promise = new Promise<'watchdog'>((resolve) => {
    timeoutId = setTimeout(resolve, durationMs, 'watchdog')
  })

  return {
    promise,
    clear: () => {
      if (timeoutId !== undefined)
        clearTimeout(timeoutId)
    },
  }
}

function createDeferredToolResult(): {
  promise: Promise<ToolResult<EchoOutput>>
  resolve: (result: ToolResult<EchoOutput>) => void
  reject: (reason: unknown) => void
} {
  let resolve!: (result: ToolResult<EchoOutput>) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<ToolResult<EchoOutput>>((done, fail) => {
    resolve = done
    reject = fail
  })

  return { promise, reject, resolve }
}
