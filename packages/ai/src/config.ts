import type { SupportedDeepSeekModel } from './deepseek.js'
import type { ChatOptions } from './types.js'
import { DEFAULT_DEEPSEEK_REASONING_EFFORT } from '@agent/contracts'

import { getModelProfile } from './deepseek.js'
import { LLMAuthError, LLMConfigError } from './errors.js'

/**
 * 调用方未传 `ChatOptions.maxTokens` 时显式发送的 `max_tokens`。
 * DeepSeek 不传时的默认值偏小，所以始终显式发送；没有部署差异需求前不做 env。
 * 须不大于每个 profile 的 `providerMaxOutputTokens`，否则默认请求会被下面的校验拒绝。
 */
const DEFAULT_MAX_OUTPUT_TOKENS = 65_536

export interface LLMRuntimeConfig {
  apiKey: string
  baseUrl: string
  model: SupportedDeepSeekModel
  /** debug 开关：是否捕获 provider 原始请求 / 响应 JSON，默认关闭。 */
  captureModelIO: boolean
}

/**
 * 单次 chat 请求的完整 resolved 配置。
 *
 * 它是调用方继续决策所需的全部模型事实：携带 contextWindowTokens，
 * 调用方（如 Context Selection）不需要再穿透 LLM 边界补查 Model Profile。
 */
export interface ResolvedChatRequestConfig {
  model: SupportedDeepSeekModel
  contextWindowTokens: number
  maxOutputTokens: number
  reasoningEffort: NonNullable<ChatOptions['reasoningEffort']>
}

export function resolveLLMRuntimeConfig(
  env: NodeJS.ProcessEnv,
): LLMRuntimeConfig {
  const apiKey = env.LLM_API_KEY?.trim()
  const baseUrl = env.LLM_BASE_URL?.trim()
  const model = env.LLM_MODEL?.trim()

  if (!apiKey)
    throw new LLMAuthError('请在项目根目录 .env 中设置 LLM_API_KEY')
  if (!baseUrl)
    throw new LLMConfigError('LLM_BASE_URL', '必须提供非空 URL')
  if (!model)
    throw new LLMConfigError('LLM_MODEL', '必须提供支持的模型名')

  const profile = getModelProfile(model)

  if (!profile)
    throw new LLMConfigError('LLM_MODEL', `不支持模型 ${model}`)

  return {
    apiKey,
    baseUrl: baseUrl.replace(/\/+$/, ''),
    model: profile.id,
    captureModelIO: readBooleanFlag(env, 'AGENT_DEBUG_CAPTURE_MODEL_IO'),
  }
}

function readBooleanFlag(env: NodeJS.ProcessEnv, name: string): boolean {
  const value = env[name]?.trim().toLowerCase()

  return value === '1' || value === 'true'
}

export function resolveChatRequestConfig(
  runtimeConfig: LLMRuntimeConfig,
  options: ChatOptions = {},
): ResolvedChatRequestConfig {
  const requestedModel = (options.model ?? runtimeConfig.model).trim()
  const profile = getModelProfile(requestedModel)

  if (!profile)
    throw new LLMConfigError('model', `不支持模型 ${requestedModel || '(empty)'}`)

  const maxOutputTokens = options.maxTokens ?? DEFAULT_MAX_OUTPUT_TOKENS

  if (
    !Number.isSafeInteger(maxOutputTokens)
    || maxOutputTokens <= 0
  ) {
    throw new LLMConfigError('maxTokens', '必须是正整数')
  }
  if (maxOutputTokens > profile.providerMaxOutputTokens) {
    throw new LLMConfigError(
      'maxTokens',
      `不得大于模型 ${profile.id} 的 Provider 上限`,
    )
  }

  return {
    model: profile.id,
    contextWindowTokens: profile.contextWindowTokens,
    maxOutputTokens,
    reasoningEffort: options.reasoningEffort ?? DEFAULT_DEEPSEEK_REASONING_EFFORT,
  }
}
