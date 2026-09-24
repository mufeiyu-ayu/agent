import type { LlmFamilyCompat, ReasoningEffort } from '@agent/contracts'
import type { ClientOptions } from 'openai'

/** 构造一个 Provider client 需要的全部事实；apiKey / baseUrl 来自数据库里的 Provider 行。 */
export interface LLMClientConfig {
  apiKey: string
  baseUrl: string
  /** debug 开关：是否捕获 provider 原始请求 / 响应 JSON，默认关闭。 */
  captureModelIO: boolean
  /** 原样交给 SDK 的 `fetchOptions`；调用方用它为每个请求指定出口（例如 undici `dispatcher`）。 */
  fetchOptions?: ClientOptions['fetchOptions']
}

/**
 * 一个模型行的能力事实，由 Admin 人工维护，不从 Provider 接口猜。
 * `compat` 是所属家族的协议差异（thinking 开关格式、Tool Call 是否必须回 reasoning_content），
 * 取值只来自 `@agent/contracts` 的 `LLM_FAMILY_CAPABILITIES`；
 * `reasoningEffort` 是默认的 `reasoning_effort`，任何家族配置了就发，null 不发。
 */
export interface LLMModelProfile {
  /** 发给 Provider 的模型名。 */
  wireName: string
  contextWindowTokens: number
  maxOutputTokens: number
  compat: LlmFamilyCompat
  reasoningEffort: ReasoningEffort | null
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
  compat: LlmFamilyCompat
  /** 省略表示请求体不带 reasoning_effort。 */
  reasoningEffort?: ReasoningEffort
}

export interface ChatRequestOverrides {
  /** 请求级覆盖模型行的默认 reasoning_effort。 */
  reasoningEffort?: ReasoningEffort
}

/** 模型名与输出上限直接取模型行；请求级只能覆盖 reasoningEffort，都没有就不发。 */
export function resolveChatRequestConfig(
  profile: LLMModelProfile,
  overrides: ChatRequestOverrides = {},
): ResolvedChatRequestConfig {
  const reasoningEffort = overrides.reasoningEffort ?? profile.reasoningEffort ?? undefined

  return {
    model: profile.wireName,
    contextWindowTokens: profile.contextWindowTokens,
    maxOutputTokens: profile.maxOutputTokens,
    compat: profile.compat,
    ...(reasoningEffort ? { reasoningEffort } : {}),
  }
}
