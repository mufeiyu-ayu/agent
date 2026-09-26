import type { JsonObjectSchema } from '@agent/ai'
import type { DatabaseOperationDeadline } from '../../prisma/prisma.service.js'
import type { NormalizedToolObservation } from './tool-observation.js'

/** 将模型可见 Schema 与服务端运行时解析绑定为同一个输入契约。 */
export interface ToolInputContract<TInput> {
  schema: JsonObjectSchema
  parse: (value: unknown) => TInput
}

/** 工具的服务端定义；执行器与运行上下文不会暴露给模型。 */
export interface ToolDefinition<TInput = unknown> {
  name: string
  version: string
  description: string
  input: ToolInputContract<TInput>
  timeoutMs: number
  /** 该工具允许发送给模型的 Observation 字符预算。 */
  maxObservationChars: number
}

/** 模型提出、但尚未经过工具查找和参数验证的调用。 */
export interface UnvalidatedToolCallEnvelope {
  callId: string
  toolName: string
  rawArgumentsJson: string
}

/** Registry 查找并验证参数后，Executor 唯一允许接收的调用。 */
export interface ValidatedToolInvocation<TInput = unknown> {
  toolName: string
  input: TInput
}

/** 完全由服务端提供，不允许模型 arguments 覆盖。 */
export interface ToolExecutionContext {
  databaseDeadline: DatabaseOperationDeadline
  signal: AbortSignal
}

/** Runtime 交给 `invoke` 的上下文：执行上下文加上本批 arguments 是否被截断。 */
export interface ToolInvocationContext extends ToolExecutionContext {
  /** 模型输出达到长度限制，arguments 可能不完整：`invoke` 不查找、不校验、不执行。 */
  argumentsTruncated: boolean
}

export type ToolResult
  = | {
    ok: true
    modelContent: string
  }
  | {
    ok: false
    code:
      | 'execution_failed'
      | 'invalid_arguments'
      | 'timeout'
      // 模型输出达到长度限制、arguments 不完整，本次未执行。
      | 'truncated_arguments'
      | 'unknown_tool'
    modelContent: string
  }

/** `invoke` 对一次调用给出的全部事实；Runtime 只拿它记账与回喂，不再自己推断。 */
export interface ToolInvocationResult {
  result: ToolResult
  /** 参数是否通过了 `input.parse`：通过后才超时或执行失败的调用也是 true。 */
  argumentsValidated: boolean
  /** 按该工具的 Observation 预算修剪后回喂给模型的正文。 */
  observation: NormalizedToolObservation
}

export interface ToolExecutor<TInput> {
  execute: (
    invocation: ValidatedToolInvocation<TInput>,
    context: ToolExecutionContext,
  ) => Promise<ToolResult>
}

/** Definition 与对应 Executor 的显式组装边界。 */
export interface RegisteredTool<TInput = unknown> {
  definition: ToolDefinition<TInput>
  executor: ToolExecutor<TInput>
}
