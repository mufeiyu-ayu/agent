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
    const tool = this.registry.get(envelope.toolName)

    if (!tool) {
      return {
        ok: false,
        code: 'unknown_tool',
        modelContent: `工具 ${envelope.toolName} 不存在。`,
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

    context.signal.throwIfAborted()

    try {
      return await tool.executor.execute(invocation, context)
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
