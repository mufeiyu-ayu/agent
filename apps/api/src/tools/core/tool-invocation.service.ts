import type { DatabaseOperationDeadline } from '../../prisma/prisma.service.js'
import type {
  ToolExecutionContext,
  ToolResult,
  UnvalidatedToolCallEnvelope,
  ValidatedToolInvocation,
} from './tool.types.js'
import { Inject, Injectable, Logger } from '@nestjs/common'

import { DatabaseOperationDeadlineExceededError } from '../../prisma/prisma.service.js'
import { ToolRegistryService } from './tool-registry.service.js'

@Injectable()
export class ToolInvocationService {
  private readonly logger = new Logger(ToolInvocationService.name)

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
      }
    }

    // 将校验后的输入与服务端工具名组装为执行器唯一允许接收的可信调用。
    const invocation: ValidatedToolInvocation = {
      toolName: tool.definition.name,
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
            }
          }

          if (outcome.error instanceof DatabaseOperationDeadlineExceededError)
            throw outcome.error

          // 模型与 Step 只拿到脱敏的「执行失败」，真实原因（如 Embedding 服务连不上）只进服务端日志；
          // callId 与 tool Step 落库的一致，用来对上 Run Trace。记日志失败不能改变返回结果。
          try {
            const error = outcome.error
            const message = error instanceof Error ? error.message : error

            this.logger.warn({
              event: 'tool_execution_failed',
              toolName: envelope.toolName,
              callId: envelope.callId,
              errorName: error instanceof Error ? error.name : typeof error,
              message: typeof message === 'string' ? message.slice(0, 500) : '',
            })
          }
          catch {}

          return {
            ok: false,
            code: 'execution_failed',
            modelContent: `工具 ${envelope.toolName} 执行失败。`,
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
