/** 模型单次 sampling 的结束原因，已与具体 Provider 类型解耦。 */
export type ModelFinishReason
  = | 'stop'
    | 'tool_calls'
    | 'length'
    | 'content_filter'
    | 'unknown'

/**
 * 模型提出、Provider adapter 已完成分片拼装，但尚未经过业务校验的 Tool Call。
 *
 * 它不等于已经通过 Registry、参数 Schema 和权限检查的 Tool Invocation。
 */
export interface UnvalidatedModelToolCall {
  providerCallId: string
  name: string
  argumentsJson: string
  index: number
}

/** 单次模型 sampling 的 token 使用量。 */
export interface ModelUsage {
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
}

/** LLM 层向 Agent Runtime 暴露的 provider-neutral 流事件。 */
export type ModelStreamEvent
  = | {
    type: 'text_delta'
    delta: string
  }
  | {
    type: 'tool_call_started'
  }
  | {
    type: 'tool_call_completed'
    toolCall: UnvalidatedModelToolCall
    reasoningContent: string
  }
  | {
    type: 'usage'
    usage: ModelUsage
  }
  | {
    type: 'response_completed'
    finishReason: ModelFinishReason
  }

/** 合并流式 usage 分片；没有任何已知字段时保持 null，绝不补零。 */
export function mergeModelUsage(
  current: ModelUsage | null,
  next: ModelUsage,
): ModelUsage | null {
  const merged: ModelUsage = {
    ...(current ?? {}),
    ...(next.inputTokens === undefined ? {} : { inputTokens: next.inputTokens }),
    ...(next.outputTokens === undefined ? {} : { outputTokens: next.outputTokens }),
    ...(next.totalTokens === undefined ? {} : { totalTokens: next.totalTokens }),
  }

  return Object.keys(merged).length > 0 ? merged : null
}
