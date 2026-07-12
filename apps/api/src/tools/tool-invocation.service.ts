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

    try {
      const result = await tool.executor.execute(invocation, context)
      context.signal.throwIfAborted()
      return result
    }
    catch (error) {
      if (context.signal.aborted || isAbortError(error))
        throw error

      return {
        ok: false,
        code: 'execution_failed',
        modelContent: `工具 ${envelope.toolName} 执行失败。`,
        retryable: false,
      }
    }
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}
