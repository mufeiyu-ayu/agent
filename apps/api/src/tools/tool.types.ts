/** 当前工具输入需要的最小 JSON Schema 子集。 */
export type JsonSchemaProperty
  = | { type: 'boolean', description?: string }
    | { type: 'integer', description?: string }
    | { type: 'string', description?: string }

export interface JsonObjectSchema {
  type: 'object'
  properties: Record<string, JsonSchemaProperty>
  required: string[]
  additionalProperties: false
}

/** 将模型可见 Schema 与服务端运行时解析绑定为同一个输入契约。 */
export interface ToolInputContract<TInput> {
  schema: JsonObjectSchema
  parse: (value: unknown) => TInput
}

export interface ToolRisk {
  level: 'high' | 'low' | 'medium'
  sideEffect: 'external_write' | 'none'
  network: boolean
}

/** 工具的服务端定义；执行器与运行上下文不会暴露给模型。 */
export interface ToolDefinition<TInput = unknown> {
  name: string
  version: string
  description: string
  input: ToolInputContract<TInput>
  timeoutMs: number
  requiresApproval: boolean
  idempotent: boolean
  risk: ToolRisk
}

/** 模型提出、但尚未经过工具查找和参数验证的调用。 */
export interface UnvalidatedToolCallEnvelope {
  callId: string
  toolName: string
  rawArgumentsJson: string
  samplingAttemptId: string
}

/** Registry 查找并验证参数后，Executor 唯一允许接收的调用。 */
export interface ValidatedToolInvocation<TInput = unknown> {
  callId: string
  toolName: string
  toolVersion: string
  samplingAttemptId: string
  input: TInput
}

/** 完全由服务端提供，不允许模型 arguments 覆盖。 */
export interface ToolExecutionContext {
  runId: string
  conversationId: string
  signal: AbortSignal
  executionAttempt: number
}

export type ToolResult<T = unknown>
  = | {
    ok: true
    data: T
    modelContent: string
  }
  | {
    ok: false
    code: 'execution_failed' | 'invalid_arguments' | 'unknown_tool'
    modelContent: string
    retryable: boolean
  }

export interface ToolExecutor<TInput, TOutput> {
  execute: (
    invocation: ValidatedToolInvocation<TInput>,
    context: ToolExecutionContext,
  ) => Promise<ToolResult<TOutput>>
}

/** Definition 与对应 Executor 的显式组装边界。 */
export interface RegisteredTool<TInput = unknown, TOutput = unknown> {
  definition: ToolDefinition<TInput>
  executor: ToolExecutor<TInput, TOutput>
}
