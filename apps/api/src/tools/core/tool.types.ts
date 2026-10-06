import type { JsonObjectSchema } from '@agent/ai'
import type { WorkspaceToolDisplay } from '@agent/contracts'
import type { DatabaseOperationDeadline } from '../../prisma/prisma.service.js'
import type { SerperApiKey } from '../../runtime-config/runtime-config.service.js'
import type { WorkspaceCommit, WorkspaceExecution } from '../../workspaces/workspace-files.js'
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

/** 只给界面看的结构化结果（#208）：随 tool_finished 事件发给前台，不进模型上下文；按协议字段存进 tool Step，刷新后还原时间线（#212）。 */
export interface ToolDisplay {
  workspace?: WorkspaceToolDisplay
  /** web_search：来源列表。 */
  results?: Array<{ title: string, url: string }>
  /** web_fetch：重定向后的最终地址、网页标题与正文字数。 */
  finalUrl?: string
  title?: string
  chars?: number
  /** 模型拿到了说明、但界面上算失败的情况（如网页内容类型不支持）。 */
  failure?: 'timeout' | 'failed'
  /** 已记录但未执行；指南生效后重新采样，不是成功或失败。 */
  skipped?: 'workspace_replan'
}

export type ToolResult
  = | {
    ok: true
    workspaceCommit?: WorkspaceCommit
    modelContent: string
    display?: ToolDisplay
  }
  | {
    ok: false
    code:
      | 'execution_failed'
      | 'workspace_replan'
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
