import type { ChatStreamToolFinishedEvent } from '@agent/contracts'
import type { NormalizedToolObservation } from './tool-observation.js'

export interface UnvalidatedToolCallEnvelope {
  callId: string
  toolName: string
  rawArgumentsJson: string
}

/** 仅跨端协议的显示字段，不包含宿主执行对象。 */
export type ToolDisplay = Pick<ChatStreamToolFinishedEvent, 'workspace' | 'results' | 'finalUrl' | 'title' | 'chars' | 'failure' | 'skipped'>

export type ToolResult
  = | { ok: true, modelContent: string, display?: ToolDisplay }
    | {
      ok: false
      code: 'execution_failed' | 'workspace_replan' | 'invalid_arguments' | 'timeout' | 'truncated_arguments' | 'unknown_tool'
      modelContent: string
    }

export interface ToolInvocationResult {
  result: ToolResult
  argumentsValidated: boolean
  observation: NormalizedToolObservation
}
