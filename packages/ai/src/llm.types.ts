import type { DeepSeekReasoningEffort } from '@agent/contracts'
import type { ModelToolSpec } from './model-tool-spec.types.js'

/**
 * LLM 调用相关类型定义
 *
 * 职责边界：
 * - 只定义 LLM 层对上暴露的类型（消息结构、请求选项、业务需要的响应结构）
 * - 不包含任何 SEO 业务字段（title、description 等由上层定义）
 * - 不暴露 OpenAI SDK 原始 chunk / response 给业务层
 */

// ─── 消息结构 ────────────────────────────────

/** 标准 chat message */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

// ─── 请求选项 ────────────────────────────────

/** chat() 方法的可选参数，会覆盖环境变量中的默认值 */
export interface ChatOptions {
  /** 模型名，默认从 LLM_MODEL 环境变量读取 */
  model?: string
  /** DeepSeek Thinking Mode 思考强度，省略时稳定回落 high。 */
  reasoningEffort?: DeepSeekReasoningEffort
  /** 最大输出 token 数，默认由已验证的 LLM runtime config 提供 */
  maxTokens?: number
  /** JSON 输出约束（对应 OpenAI response_format） */
  responseFormat?: { type: 'json_object' } | { type: 'text' }
}

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

/** chatStream() 方法的可选参数。 */
export interface ChatStreamOptions extends ChatOptions {
  /** 外部中止信号，用于后续支持用户主动停止生成。 */
  signal?: AbortSignal
  /** 只包含模型可见字段的工具说明。 */
  tools?: ModelToolSpec[]
  /** debug 捕获回调；未开启捕获开关时不会被调用。 */
  debugCapture?: ModelIODebugCapture
}

export interface DeepSeekModelInfo {
  id: string
  object: 'model'
  owned_by: string
}

export interface DeepSeekModelsResponse {
  object: 'list'
  data: DeepSeekModelInfo[]
}

export interface DeepSeekBalanceInfo {
  currency: 'CNY' | 'USD'
  total_balance: string
  granted_balance: string
  topped_up_balance: string
}

export interface DeepSeekBalanceResponse {
  is_available: boolean
  balance_infos: DeepSeekBalanceInfo[]
}
