import type { ToolInvocationResult as CoreInvocationResult, ToolResult as CoreToolResult } from '@agent/agent'
import type { JsonObjectSchema } from '@agent/ai'
import type { DatabaseOperationDeadline } from '../../prisma/prisma.service.js'
import type { SerperApiKey } from '../../runtime-config/runtime-config.service.js'
import type { WorkspaceCommit, WorkspaceExecution } from '../../workspaces/workspace-files.js'

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

/** Registry 查找并验证参数后，Executor 唯一允许接收的调用。 */
export interface ValidatedToolInvocation<TInput = unknown> {
  toolName: string
  input: TInput
}

/** 完全由服务端提供，不允许模型 arguments 覆盖。 */
export interface ToolExecutionContext {
  workspace?: WorkspaceExecution
  databaseDeadline: DatabaseOperationDeadline
  signal: AbortSignal
  /** 本次问答运行配置快照里的 Serper Key（#216），只有 web_search 用。 */
  serperApiKey: SerperApiKey
}

/** Runtime 交给 `invoke` 的上下文：执行上下文加上本批 arguments 是否被截断。 */
export interface ToolInvocationContext extends ToolExecutionContext {
  /** 首次工作区计划未经开发指南约束，只记录未执行结果，下一轮重采样。 */
  workspaceGuideRequired?: boolean
  /** 模型输出达到长度限制，arguments 可能不完整：`invoke` 不查找、不校验、不执行。 */
  argumentsTruncated: boolean
}

/** API 的发布事实只在宿主持有，通用调用结果不认识 WorkspaceCommit。 */
export type ToolResult
  = | (Extract<CoreToolResult, { ok: true }> & { workspaceCommit?: WorkspaceCommit })
    | Extract<CoreToolResult, { ok: false }>

export interface ToolInvocationResult extends Omit<CoreInvocationResult, 'result'> {
  result: ToolResult
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
