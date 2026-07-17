import type {
  ToolExecutionContext,
  ToolResult,
  UnvalidatedToolCallEnvelope,
  ValidatedToolInvocation,
} from './tool.types.js'
import { Inject, Injectable } from '@nestjs/common'

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

    if (
      tool.definition.requiresApproval
      || tool.definition.risk.level !== 'low'
      || tool.definition.risk.sideEffect !== 'none'
      || tool.definition.risk.network
    ) {
      return {
        ok: false,
        code: 'execution_failed',
        modelContent: `工具 ${envelope.toolName} 当前不允许执行。`,
        retryable: false,
      }
    }

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

    const invocation: ValidatedToolInvocation = {
      callId: envelope.callId,
      toolName: tool.definition.name,
      toolVersion: tool.definition.version,
      samplingAttemptId: envelope.samplingAttemptId,
      input,
    }
    const executionController = new AbortController()
    let hasCancellationOutcome = false
    let resolveCancellation!: (outcome: ToolInvocationOutcome) => void
    const cancellation = new Promise<ToolInvocationOutcome>((resolve) => {
      resolveCancellation = resolve
    })
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
    }, tool.definition.timeoutMs)

    context.signal.addEventListener('abort', handleRunAbort, { once: true })

    const execution = Promise.resolve()
      .then(() => tool.executor.execute(invocation, {
        ...context,
        signal: executionController.signal,
      }))
      .then<ToolInvocationOutcome, ToolInvocationOutcome>(
        result => ({ type: 'result', result }),
        () => ({ type: 'error' }),
      )

    try {
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
    | { type: 'error' }
    | { type: 'result', result: ToolResult }
    | { type: 'timeout' }
