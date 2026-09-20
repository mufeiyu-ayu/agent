import type { DeepSeekReasoningEffort } from '@agent/contracts'
import { DEFAULT_DEEPSEEK_REASONING_EFFORT } from '@agent/contracts'

/** 构造一个 Provider client 需要的全部事实；apiKey / baseUrl 来自数据库里的 Provider 行。 */
export interface LLMClientConfig {
  apiKey: string
  baseUrl: string
  /** debug 开关：是否捕获 provider 原始请求 / 响应 JSON，默认关闭。 */
  captureModelIO: boolean
}

/**
 * 一个模型行的能力事实，由 Admin 人工维护，不从 Provider 接口猜。
 * `reasoning` 为真时走 DeepSeek thinking 路径：请求带 `thinking` / `reasoning_effort`，
 * Tool Call 要求 `reasoning_content`；为假时这三处都不做。
 */
export interface LLMModelProfile {
  /** 发给 Provider 的模型名。 */
  wireName: string
  contextWindowTokens: number
  maxOutputTokens: number
  reasoning: boolean
}

/**
 * 单次 chat 请求的完整 resolved 配置。
 *
 * 它是调用方继续决策所需的全部模型事实：携带 contextWindowTokens，
 * 调用方（如 Context Selection）不需要再穿透 LLM 边界补查 Model Profile。
 */
export interface ResolvedChatRequestConfig {
  model: string
  contextWindowTokens: number
  maxOutputTokens: number
  reasoning: boolean
  reasoningEffort: DeepSeekReasoningEffort
}

export interface ChatRequestOverrides {
  /** 只对 reasoning 模型有意义；省略时稳定回落 high。 */
  reasoningEffort?: DeepSeekReasoningEffort
}

/** 模型名与输出上限直接取模型行；请求级只能覆盖 reasoningEffort。 */
export function resolveChatRequestConfig(
  profile: LLMModelProfile,
  overrides: ChatRequestOverrides = {},
): ResolvedChatRequestConfig {
  return {
    model: profile.wireName,
    contextWindowTokens: profile.contextWindowTokens,
    maxOutputTokens: profile.maxOutputTokens,
    reasoning: profile.reasoning,
    reasoningEffort: overrides.reasoningEffort ?? DEFAULT_DEEPSEEK_REASONING_EFFORT,
  }
}
