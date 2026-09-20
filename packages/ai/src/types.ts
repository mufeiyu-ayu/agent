import type { ResolvedChatRequestConfig } from './config.js'

/** 当前工具输入需要的最小 JSON Schema 子集。 */
export type JsonSchemaProperty
  = | { type: 'boolean', description?: string }
    | { type: 'integer', description?: string }
    | { type: 'string', description?: string }
    | { type: 'array', items: { type: 'string' }, description?: string }

export interface JsonObjectSchema {
  type: 'object'
  properties: Record<string, JsonSchemaProperty>
  required: string[]
  additionalProperties: false
}

/** Provider-neutral 的模型可见工具说明，不包含任何服务端执行能力。 */
export interface ModelToolSpec {
  name: string
  description: string
  inputSchema: JsonObjectSchema
}

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
  reasoningTokens?: number
  promptCacheHitTokens?: number
  promptCacheMissTokens?: number
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
    ...(next.reasoningTokens === undefined
      ? {}
      : { reasoningTokens: next.reasoningTokens }),
    ...(next.promptCacheHitTokens === undefined
      ? {}
      : { promptCacheHitTokens: next.promptCacheHitTokens }),
    ...(next.promptCacheMissTokens === undefined
      ? {}
      : { promptCacheMissTokens: next.promptCacheMissTokens }),
  }

  return Object.keys(merged).length > 0 ? merged : null
}

/** Runtime 传给模型的普通消息；工具调用过程不会进入用户可见消息。 */
export interface MessageInputItem {
  type: 'message'
  role: 'system' | 'user' | 'assistant'
  content: string
}

/** 模型在同一轮里提出的一个或多个 Tool Call，映射为一条带 tool_calls[] 的 assistant 消息。 */
export interface AssistantToolCallInputItem {
  type: 'assistant_tool_call'
  calls: Array<{
    callId: string
    name: string
    rawArgumentsJson: string
  }>
  reasoningContent: string
  /** 模型在 Tool Call 之前 / 之间产生的文本，原样作为 assistant content 续传。 */
  content?: string
}

export interface ToolResultInputItem {
  type: 'tool_result'
  callId: string
  name: string
  content: string
  ok: boolean
}

/** Runtime 传给模型的内部输入。 */
export type ModelInputItem
  = | MessageInputItem
    | AssistantToolCallInputItem
    | ToolResultInputItem

/**
 * LLM 调用相关类型定义
 *
 * 职责边界：
 * - 只定义 LLM 层对上暴露的类型（消息结构、请求选项、业务需要的响应结构）
 * - 不包含任何业务字段（title、description 等由上层定义）
 * - 不暴露 OpenAI SDK 原始 chunk / response 给业务层
 */

// ─── 请求选项 ────────────────────────────────

export type ModelResponseCaptureState = 'complete' | 'partial' | 'empty'

export type ModelResponseCaptureEvent
  = | 'text_delta'
    | 'reasoning_delta'
    | 'tool_call_delta'
    | 'finish_reason'
    | 'usage'

/** Provider 原始响应的旁路聚合结果；安全计数仅供关联日志使用。 */
export interface ModelRawResponseCapture {
  state: ModelResponseCaptureState
  lastEvent: ModelResponseCaptureEvent | null
  textChars: number
  toolCallCount: number
  /** empty 时刻意缺失，避免伪造 choices / finish reason / usage。 */
  rawResponse?: unknown
}

export type ModelIODebugCaptureSide = 'request' | 'response'

/**
 * debug 模型 I/O 捕获回调。
 *
 * 仅当 AGENT_DEBUG_CAPTURE_MODEL_IO 开启时由 client 调用；载荷是 provider
 * 原始 JSON，类型刻意保持 unknown——它只用于观测落库，不进入业务逻辑，
 * 不构成对"不暴露 OpenAI SDK 原始 response"边界的破例。
 */
export interface ModelIODebugCapture {
  /** 请求真正发出前回调，body 为实际请求体（不含凭据）。 */
  onRequest: (requestBody: unknown) => void
  /** 模型流关闭时回调；明确区分完整、部分和未收到 chunk。 */
  onResponse: (capture: ModelRawResponseCapture) => void
  /** 捕获回调自身失败时的安全旁路通知，不携带原始 payload。 */
  onCaptureError?: (side: ModelIODebugCaptureSide) => void
}

/** chatStream() 的请求选项；模型与输出上限由调用方解析好的请求配置决定。 */
export interface ChatStreamOptions {
  /** 本次请求的 resolved 配置：模型名、输出上限、是否走 thinking 路径。 */
  request: ResolvedChatRequestConfig
  /** 外部中止信号，用于用户主动停止生成。 */
  signal?: AbortSignal
  /** 只包含模型可见字段的工具说明。 */
  tools?: ModelToolSpec[]
  /** debug 捕获回调；未开启捕获开关时不会被调用。 */
  debugCapture?: ModelIODebugCapture
}
