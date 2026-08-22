import type { ChatOptions, SupportedDeepSeekModel } from './llm.types.js'
import process from 'node:process'
import { Injectable } from '@nestjs/common'

import { LLMAuthError, LLMConfigError } from './llm.errors.js'
import { getModelProfile } from './model-profiles.js'

const MAX_TIMER_TIMEOUT_MS = 2_147_483_647

export const DEFAULT_LLM_RUNTIME_CONFIG = {
  metadataRequestTimeoutMs: 10_000,
  chatRequestTimeoutMs: 60_000,
  streamTimeoutMs: 600_000,
  defaultMaxOutputTokens: 65_536,
  applicationMaxOutputTokens: 131_072,
  captureModelIO: false,
} as const

export interface LLMRuntimeConfig {
  apiKey: string
  baseUrl: string
  model: SupportedDeepSeekModel
  metadataRequestTimeoutMs: number
  chatRequestTimeoutMs: number
  streamTimeoutMs: number
  defaultMaxOutputTokens: number
  applicationMaxOutputTokens: number
  /** debug 开关：是否捕获 provider 原始请求 / 响应 JSON，默认关闭。 */
  captureModelIO: boolean
}

export interface ChatRequestConfig {
  model: SupportedDeepSeekModel
  maxOutputTokens: number
}

@Injectable()
export class LLMRuntimeConfigService {
  readonly value = resolveLLMRuntimeConfig(process.env)
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

  const chatRequestTimeoutMs = readPositiveInteger(
    env,
    'LLM_CHAT_REQUEST_TIMEOUT_MS',
    DEFAULT_LLM_RUNTIME_CONFIG.chatRequestTimeoutMs,
    MAX_TIMER_TIMEOUT_MS,
  )
  const streamTimeoutMs = readPositiveInteger(
    env,
    'LLM_STREAM_TIMEOUT_MS',
    DEFAULT_LLM_RUNTIME_CONFIG.streamTimeoutMs,
    MAX_TIMER_TIMEOUT_MS,
  )
  const defaultMaxOutputTokens = readPositiveInteger(
    env,
    'LLM_DEFAULT_MAX_OUTPUT_TOKENS',
    DEFAULT_LLM_RUNTIME_CONFIG.defaultMaxOutputTokens,
    profile.providerMaxOutputTokens,
  )
  const applicationMaxOutputTokens = readPositiveInteger(
    env,
    'LLM_APPLICATION_MAX_OUTPUT_TOKENS',
    DEFAULT_LLM_RUNTIME_CONFIG.applicationMaxOutputTokens,
    profile.providerMaxOutputTokens,
  )

  if (defaultMaxOutputTokens > applicationMaxOutputTokens) {
    throw new LLMConfigError(
      'LLM_DEFAULT_MAX_OUTPUT_TOKENS',
      '不得大于 LLM_APPLICATION_MAX_OUTPUT_TOKENS',
    )
  }

  return {
    apiKey,
    baseUrl: baseUrl.replace(/\/+$/, ''),
    model: profile.id,
    metadataRequestTimeoutMs:
      DEFAULT_LLM_RUNTIME_CONFIG.metadataRequestTimeoutMs,
    chatRequestTimeoutMs,
    streamTimeoutMs,
    defaultMaxOutputTokens,
    applicationMaxOutputTokens,
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
): ChatRequestConfig {
  const requestedModel = (options.model ?? runtimeConfig.model).trim()
  const profile = getModelProfile(requestedModel)

  if (!profile)
    throw new LLMConfigError('model', `不支持模型 ${requestedModel || '(empty)'}`)

  const maxOutputTokens = options.maxTokens
    ?? runtimeConfig.defaultMaxOutputTokens

  if (
    !Number.isSafeInteger(maxOutputTokens)
    || maxOutputTokens <= 0
  ) {
    throw new LLMConfigError('maxTokens', '必须是正整数')
  }
  if (maxOutputTokens > runtimeConfig.applicationMaxOutputTokens) {
    throw new LLMConfigError(
      'maxTokens',
      `不得大于应用硬上限 ${runtimeConfig.applicationMaxOutputTokens}`,
    )
  }
  if (maxOutputTokens > profile.providerMaxOutputTokens) {
    throw new LLMConfigError(
      'maxTokens',
      `不得大于模型 ${profile.id} 的 Provider 上限`,
    )
  }

  return {
    model: profile.id,
    maxOutputTokens,
  }
}

function readPositiveInteger(
  env: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
  maximum: number,
): number {
  const rawValue = env[name]

  if (rawValue === undefined)
    return fallback

  const value = rawValue.trim()

  if (!/^[1-9]\d*$/.test(value)) {
    throw new LLMConfigError(
      name,
      `必须是 1-${maximum} 范围内的十进制正整数`,
    )
  }

  const numericValue = Number(value)

  if (!Number.isSafeInteger(numericValue) || numericValue > maximum) {
    throw new LLMConfigError(
      name,
      `必须是 1-${maximum} 范围内的十进制正整数`,
    )
  }

  return numericValue
}
