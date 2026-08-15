import type { DatabaseOperationDeadline } from '../../prisma/prisma.service.js'
import type {
  ToolExecutionContext,
  ToolResult,
  UnvalidatedToolCallEnvelope,
  ValidatedToolInvocation,
} from './tool.types.js'
import { Inject, Injectable } from '@nestjs/common'

import { DatabaseOperationDeadlineExceededError } from '../../prisma/prisma.service.js'
import { ToolRegistryService } from './tool-registry.service.js'

@Injectable()
export class ToolInvocationService {
  constructor(
    @Inject(ToolRegistryService)
    private readonly registry: ToolRegistryService,
  ) {}

  async invoke(
    envelope: UnvalidatedToolCallEnvelope,
    context: ToolExecutionContext,
  ): Promise<ToolResult> {
    // 工具调用开始前先响应已触发的外部中断，避免继续查找、校验或执行工具。
    context.signal.throwIfAborted()

    const tool = this.registry.get(envelope.toolName)

    if (!tool) {
      return {
        ok: false,
        code: 'unknown_tool',
        modelContent: `工具 ${envelope.toolName} 不存在。`,
        retryable: false,
      }
    }

    // 服务端固定的可信 Provider 网络访问是允许的；模型可影响目标的任意外网访问继续 fail closed。
    if (
      tool.definition.requiresApproval
      || tool.definition.risk.level !== 'low'
      || tool.definition.risk.sideEffect !== 'none'
      || (
        tool.definition.risk.network !== 'none'
        && tool.definition.risk.network !== 'trusted_provider'
      )
    ) {
      return {
        ok: false,
        code: 'execution_failed',
        modelContent: `工具 ${envelope.toolName} 当前不允许执行。`,
        retryable: false,
      }
    }

    // 将模型返回的 arguments JSON 解析为对象，再通过工具输入契约校验并规范化。
    let input: unknown

    try {
      input = tool.definition.input.parse(JSON.parse(envelope.rawArgumentsJson))
    }
    catch {
      return {
        ok: false,
        code: 'invalid_arguments',
        modelContent: `工具 ${envelope.toolName} 的参数无效。`,
        retryable: false,
      }
    }

    // 将校验后的输入与服务端工具元数据组装为执行器唯一允许接收的可信调用。
    const invocation: ValidatedToolInvocation = {
      callId: envelope.callId,
      toolName: tool.definition.name,
      toolVersion: tool.definition.version,
      samplingAttemptId: envelope.samplingAttemptId,
      input,
    }
    const executionController = new AbortController()
    const toolDeadlineAt = Date.now() + tool.definition.timeoutMs
    const databaseDeadline = createToolDatabaseDeadline(
      context.databaseDeadline,
      executionController.signal,
      toolDeadlineAt,
    )
    let hasCancellationOutcome = false
    let resolveCancellation!: (outcome: ToolInvocationOutcome) => void
    const cancellation = new Promise<ToolInvocationOutcome>((resolve) => {
      resolveCancellation = resolve
    })

    // 一次性仲裁超时与外部中断，只有先到达的取消原因生效。
    const settleCancellation = (outcome: ToolInvocationOutcome): boolean => {
      if (hasCancellationOutcome)
        return false

      hasCancellationOutcome = true
      resolveCancellation(outcome)
      return true
    }
    const handleRunAbort = (): void => {
      if (settleCancellation({ type: 'aborted' }))
        executionController.abort(context.signal.reason)
    }
    const timeoutId = setTimeout(() => {
      if (settleCancellation({ type: 'timeout' })) {
        executionController.abort(
          new DOMException('tool execution timeout', 'TimeoutError'),
        )
      }
    }, Math.max(0, toolDeadlineAt - Date.now()))

    if (context.signal.aborted)
      handleRunAbort()
    else
      context.signal.addEventListener('abort', handleRunAbort, { once: true })

    const execution = Promise.resolve()
      .then(() => tool.executor.execute(invocation, {
        ...context,
        databaseDeadline,
        signal: executionController.signal,
      }))
      .then<ToolInvocationOutcome, ToolInvocationOutcome>(
        result => ({ type: 'result', result }),
        error => ({ type: 'error', error }),
      )

    try {
      // 这里只仲裁调用方的返回结果；若 Executor 忽略 signal，Promise.race 不代表底层工作已停止。
      const outcome = await Promise.race([execution, cancellation])

      switch (outcome.type) {
        case 'aborted':
          context.signal.throwIfAborted()
          throw new DOMException('aborted', 'AbortError')

        case 'timeout':
          return {
            ok: false,
            code: 'timeout',
            modelContent: `工具 ${envelope.toolName} 执行超时。`,
            retryable: false,
          }

        case 'result':
          context.signal.throwIfAborted()
          return outcome.result

        case 'error':
          context.signal.throwIfAborted()

          if (outcome.error instanceof ToolDatabaseDeadlineExceededError) {
            return {
              ok: false,
              code: 'timeout',
              modelContent: `工具 ${envelope.toolName} 执行超时。`,
              retryable: false,
            }
          }

          if (outcome.error instanceof DatabaseOperationDeadlineExceededError)
            throw outcome.error

          return {
            ok: false,
            code: 'execution_failed',
            modelContent: `工具 ${envelope.toolName} 执行失败。`,
            retryable: false,
          }
      }
    }
    finally {
      clearTimeout(timeoutId)
      context.signal.removeEventListener('abort', handleRunAbort)
    }
  }
}

type ToolInvocationOutcome
  = | { type: 'aborted' }
    | { type: 'error', error: unknown }
    | { type: 'result', result: ToolResult }
    | { type: 'timeout' }

class ToolDatabaseDeadlineExceededError extends Error {
  constructor() {
    super('工具数据库操作超过可用 timeout budget')
    this.name = 'ToolDatabaseDeadlineExceededError'
  }
}

function createToolDatabaseDeadline(
  runDeadline: DatabaseOperationDeadline,
  signal: AbortSignal,
  toolDeadlineAt: number,
): DatabaseOperationDeadline {
  const toolDeadlineIsFirst = toolDeadlineAt < runDeadline.deadlineAt

  return {
    deadlineAt: Math.min(runDeadline.deadlineAt, toolDeadlineAt),
    signal,
    createTimeoutError: toolDeadlineIsFirst
      ? () => new ToolDatabaseDeadlineExceededError()
      : runDeadline.createTimeoutError,
  }
}
