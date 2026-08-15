import type { DatabaseOperationDeadline } from '../../prisma/prisma.service.js'

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

/**
 * 工具的网络访问面。
 *
 * - `none`：完全不出网。
 * - `trusted_provider`：只访问服务端固定的可信 Provider，模型 arguments 无法改变目标。
 * - `arbitrary`：目标可由模型或输入影响，当前一律 fail closed。
 */
export type ToolNetworkAccess = 'arbitrary' | 'none' | 'trusted_provider'

export interface ToolRisk {
  level: 'high' | 'low' | 'medium'
  sideEffect: 'external_write' | 'none'
  network: ToolNetworkAccess
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
  databaseDeadline: DatabaseOperationDeadline
  signal: AbortSignal
  executionAttempt: number
}

export type JsonPrimitive = boolean | null | number | string

export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue }

/**
 * 工具自愿提供的、可安全持久化到 AgentStep 的摘要。
 *
 * 与 `data`（服务端完整结果）和 `modelContent`（模型可见文本）是三种不同投影：
 * 这里只允许放不含正文、excerpt、向量、内部距离和 credential 的元数据。
 *
 * 类型上限定为 JSON-compatible；运行时仍由 `normalizeToolStepSummary` 在持久化
 * 之前 fail closed 校验，不信任任何 Tool 的类型断言。
 */
export type ToolStepSummary = Record<string, JsonValue>

export type ToolResult<T = unknown>
  = | {
    ok: true
    data: T
    modelContent: string
    stepSummary?: ToolStepSummary
  }
  | {
    ok: false
    code: 'execution_failed' | 'invalid_arguments' | 'timeout' | 'unknown_tool'
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
