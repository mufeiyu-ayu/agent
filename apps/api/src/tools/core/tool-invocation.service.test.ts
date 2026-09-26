import type { Logger } from '@nestjs/common'
import type { DatabaseOperationDeadline } from '../../prisma/prisma.service.js'
import type { NormalizedToolObservation } from './tool-observation.js'
import type {
  RegisteredTool,
  ToolExecutionContext,
  ToolExecutor,
  ToolInvocationContext,
  ToolResult,
  UnvalidatedToolCallEnvelope,
  ValidatedToolInvocation,
} from './tool.types.js'
import assert from 'node:assert/strict'
// 项目本轮使用 Node 原生测试运行器，不引入额外测试框架。
// eslint-disable-next-line test/no-import-node-test
import { describe, it, mock } from 'node:test'

import { DatabaseOperationDeadlineExceededError } from '../../prisma/prisma.service.js'
import { ToolInvocationService } from './tool-invocation.service.js'
import { normalizeToolObservation } from './tool-observation.js'
import { ToolRegistryService } from './tool-registry.service.js'

interface EchoInput {
  message: string
}

describe('ToolInvocationService', () => {
  it('argumentsValidated 与 observation 按 invoke 实际走到的分支给出', async () => {
    const longMessage = 'x'.repeat(8_001)
    const cases: Array<{
      name: string
      envelope?: Partial<UnvalidatedToolCallEnvelope>
      argumentsTruncated?: boolean
      timeoutMs?: number
      execute?: ToolExecutor<EchoInput>['execute']
      result: ToolResult
      argumentsValidated: boolean
      observation: NormalizedToolObservation
      executions: number
    }> = [
      {
        name: '成功',
        envelope: { rawArgumentsJson: JSON.stringify({ message: longMessage }) },
        result: { ok: true, modelContent: longMessage },
        argumentsValidated: true,
        // 按 echo 自己的 maxObservationChars（8_000）修剪，不是全局硬上限。
        observation: normalizeToolObservation(longMessage, 8_000),
        executions: 1,
      },
      {
        name: '未知工具',
        envelope: { toolName: 'missing_tool' },
        result: { ok: false, code: 'unknown_tool', modelContent: '工具 missing_tool 不存在。' },
        argumentsValidated: false,
        observation: untrimmed('工具 missing_tool 不存在。'),
        executions: 0,
      },
      {
        name: '非法 JSON',
        envelope: { rawArgumentsJson: '{' },
        result: { ok: false, code: 'invalid_arguments', modelContent: '工具 echo 的参数无效。' },
        argumentsValidated: false,
        observation: untrimmed('工具 echo 的参数无效。'),
        executions: 0,
      },
      {
        name: 'parse 拒绝',
        envelope: { rawArgumentsJson: '{"message":1}' },
        result: { ok: false, code: 'invalid_arguments', modelContent: '工具 echo 的参数无效。' },
        argumentsValidated: false,
        observation: untrimmed('工具 echo 的参数无效。'),
        executions: 0,
      },
      {
        // 参数本身合法，也不执行：截断批次整批都不可信。
        name: '截断批次',
        argumentsTruncated: true,
        result: {
          ok: false,
          code: 'truncated_arguments',
          modelContent: '工具 echo 的参数因模型输出达到长度限制而不完整，本次未执行；仍需要时请重新发起调用。',
        },
        argumentsValidated: false,
        observation: untrimmed('工具 echo 的参数因模型输出达到长度限制而不完整，本次未执行；仍需要时请重新发起调用。'),
        executions: 0,
      },
      {
        name: '超时：校验通过后才失败',
        timeoutMs: 20,
        execute: async () => await new Promise(() => {}),
        result: { ok: false, code: 'timeout', modelContent: '工具 echo 执行超时。' },
        argumentsValidated: true,
        observation: untrimmed('工具 echo 执行超时。'),
        executions: 1,
      },
      {
        name: '执行失败：校验通过后才失败',
        execute: async () => {
          throw new Error('database password: secret')
        },
        result: { ok: false, code: 'execution_failed', modelContent: '工具 echo 执行失败。' },
        argumentsValidated: true,
        observation: untrimmed('工具 echo 执行失败。'),
        executions: 1,
      },
    ]

    for (const testCase of cases) {
      let executions = 0
      const registry = new ToolRegistryService()
      const tool = createEchoTool('echo', async (invocation, context) => {
        executions += 1
        return testCase.execute
          ? await testCase.execute(invocation, context)
          : { ok: true, modelContent: invocation.input.message }
      })

      tool.definition.timeoutMs = testCase.timeoutMs ?? tool.definition.timeoutMs
      registry.register(tool)
      const service = new ToolInvocationService(registry)
      mock.method((service as unknown as { logger: Logger }).logger, 'warn', () => {})

      const invocation = await service.invoke(
        { ...createEnvelope(), ...testCase.envelope },
        { ...createContext(), argumentsTruncated: testCase.argumentsTruncated ?? false },
      )

      assert.deepEqual(invocation, {
        result: testCase.result,
        argumentsValidated: testCase.argumentsValidated,
        observation: testCase.observation,
      }, testCase.name)
      assert.equal(executions, testCase.executions, testCase.name)
    }
  })

  it('拒绝非法 JSON、缺字段、错类型和额外字段，且不执行工具', async () => {
    let executionCount = 0
    const registry = new ToolRegistryService()
    registry.register(createEchoTool('echo', async () => {
      executionCount += 1
      return { ok: true, modelContent: 'unexpected' }
    }))
    const service = new ToolInvocationService(registry)
    const invalidArguments = [
      '{',
      '{}',
      '{"message":1}',
      '{"message":"hello","extra":true}',
    ]

    for (const rawArgumentsJson of invalidArguments) {
      const { result } = await service.invoke(
        { ...createEnvelope(), rawArgumentsJson },
        createContext(),
      )

      assert.equal(result.ok, false)
      assert.equal(result.ok ? undefined : result.code, 'invalid_arguments')
    }

    assert.equal(executionCount, 0)
  })

  it('合法调用只把已验证参数交给 Executor', async () => {
    let receivedInvocation: ValidatedToolInvocation<EchoInput> | undefined
    let receivedContext: ToolExecutionContext | undefined
    const registry = new ToolRegistryService()
    registry.register(createEchoTool('echo', async (invocation, context) => {
      receivedInvocation = invocation
      receivedContext = context
      return {
        ok: true,
        modelContent: invocation.input.message,
      }
    }))
    const service = new ToolInvocationService(registry)
    const context = createContext()
    const startedAt = Date.now()

    const { result } = await service.invoke(createEnvelope(), context)

    assert.deepEqual(result, {
      ok: true,
      modelContent: 'hello',
    })
    assert.deepEqual(receivedInvocation, {
      toolName: 'echo',
      input: { message: 'hello' },
    })
    assert.ok(receivedContext, 'receivedContext')
    assert.notEqual(receivedContext.databaseDeadline, context.databaseDeadline)
    assert.equal(receivedContext.databaseDeadline.signal, receivedContext.signal)
    assert.ok(receivedContext.databaseDeadline.deadlineAt >= startedAt, 'receivedContext.databaseDeadline.deadlineAt >= startedAt')
    assert.ok(receivedContext.databaseDeadline.deadlineAt < context.databaseDeadline.deadlineAt, 'receivedContext.databaseDeadline.deadlineAt < context.databaseDeadline.deadlineAt')
    assert.notEqual(receivedContext.signal, context.signal)
    assert.equal(receivedContext.signal.aborted, false)
  })

  it('把普通执行异常转换为安全失败，不泄漏原始错误', async () => {
    const registry = new ToolRegistryService()
    registry.register(createEchoTool('echo', async () => {
      throw new Error('database password: secret')
    }))
    const service = new ToolInvocationService(registry)

    const { result } = await service.invoke(createEnvelope(), createContext())

    assert.equal(result.ok, false)
    assert.equal(result.ok ? undefined : result.code, 'execution_failed')
    assert.doesNotMatch(result.modelContent, /password|secret/)
  })

  it('执行异常的真实原因只进服务端日志：工具名、callId、错误名与截断后的 message', async () => {
    const failures: unknown[] = [
      Object.assign(new Error(`upstream network error${'x'.repeat(600)}`), { name: 'UpstreamError' }),
      Object.create(null),
      Object.assign(new Error('x'), { message: { nested: true } }),
      'ECONNRESET',
    ]
    const registry = new ToolRegistryService()
    registry.register(createEchoTool('echo', async () => {
      throw failures.shift()
    }))
    const service = new ToolInvocationService(registry)
    const warn = mock.method((service as unknown as { logger: Logger }).logger, 'warn', () => {})

    for (let i = 0; i < 4; i++) {
      const { result } = await service.invoke(createEnvelope(), createContext())

      assert.equal(result.ok ? undefined : result.code, 'execution_failed')
      assert.equal(result.modelContent, '工具 echo 执行失败。')
    }
    assert.equal(warn.mock.callCount(), 4)
    const [first, nullProto, oddMessage, thrownString] = warn.mock.calls.map(call => call.arguments[0] as Record<string, unknown>)
    assert.equal(first?.event, 'tool_execution_failed')
    assert.equal(first?.toolName, 'echo')
    assert.equal(first?.callId, 'call-1')
    assert.equal(first?.errorName, 'UpstreamError')
    assert.equal((first?.message as string).length, 500)
    assert.match(first?.message as string, /^upstream network error/)
    assert.deepEqual([nullProto?.errorName, nullProto?.message], ['object', ''])
    assert.deepEqual([oddMessage?.errorName, oddMessage?.message], ['Error', ''])
    assert.deepEqual([thrownString?.errorName, thrownString?.message], ['string', 'ECONNRESET'])
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
    const { result } = await service.invoke(createEnvelope(), context)

    assert.ok(receivedDeadline, 'receivedDeadline')
    assert.ok(receivedDeadline.deadlineAt < context.databaseDeadline.deadlineAt, 'receivedDeadline.deadlineAt < context.databaseDeadline.deadlineAt')
    assert.deepEqual(result, {
      ok: false,
      code: 'timeout',
      modelContent: '工具 echo 执行超时。',
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

  it('已触发的 AbortSignal 优先于截断批次、工具查找和参数验证，且不执行工具', async () => {
    let executionCount = 0
    const registry = new ToolRegistryService()
    registry.register(createEchoTool('echo', async () => {
      executionCount += 1
      return { ok: true, modelContent: 'unexpected' }
    }))
    const service = new ToolInvocationService(registry)
    const abortController = new AbortController()
    abortController.abort()

    const calls = [
      { envelope: createEnvelope(), argumentsTruncated: true },
      { envelope: createEnvelope('missing_tool'), argumentsTruncated: false },
      { envelope: { ...createEnvelope(), rawArgumentsJson: '{' }, argumentsTruncated: false },
      { envelope: createEnvelope(), argumentsTruncated: false },
    ]

    for (const { envelope, argumentsTruncated } of calls) {
      await assert.rejects(
        service.invoke(envelope, { ...createContext(abortController.signal), argumentsTruncated }),
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
      return { ok: true, modelContent: 'unexpected' }
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
      (await service.invoke(createEnvelope(), createContext())).result,
      {
        ok: false,
        code: 'execution_failed',
        modelContent: '工具 echo 执行失败。',
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
        service.invoke(createEnvelope(), createContext()).then(invocation => invocation.result),
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
      assert.ok(outcome instanceof Error, 'outcome instanceof Error')
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

    const { result } = await service.invoke(createEnvelope(), createContext())

    assert.equal(result.ok, false)
    assert.equal(result.ok ? undefined : result.code, 'timeout')
    assert.ok(executionSignal, 'executionSignal')
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
        const { result } = await service.invoke(createEnvelope(), createContext())

        if (lateOutcome === 'resolve') {
          deferred.resolve({
            ok: true,
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
        modelContent: invocation.input.message,
      }
    })

    tool.definition.timeoutMs = 20
    registry.register(tool)
    const service = new ToolInvocationService(registry)

    await service.invoke(createEnvelope(), createContext(abortController.signal))
    await delay(30)
    assert.ok(executionSignal, 'executionSignal')
    assert.equal(executionSignal.aborted, false)

    abortController.abort()
    assert.equal(executionSignal.aborted, false)
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
  }
}

function createContext(signal = new AbortController().signal): ToolInvocationContext {
  return {
    databaseDeadline: createDatabaseDeadline(signal),
    signal,
    argumentsTruncated: false,
  }
}

function untrimmed(content: string): NormalizedToolObservation {
  const chars = [...content].length

  return { content, originalChars: chars, observationChars: chars, truncated: false }
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
  promise: Promise<ToolResult>
  resolve: (result: ToolResult) => void
  reject: (reason: unknown) => void
} {
  let resolve!: (result: ToolResult) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<ToolResult>((done, fail) => {
    resolve = done
    reject = fail
  })

  return { promise, reject, resolve }
}
