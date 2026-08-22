/**
 * LLM 领域的模型注册入口：支持模型名单与模型能力 Profile 在此维护，
 * Record 类型保证名单与 Profile 双向一致。
 * 注意：前端另持有一份展示用名单（apps/web/src/types/llm.ts 的
 * DeepSeekModelId / FALLBACK_DEEPSEEK_MODELS），新增模型时需同步。
 */

export const SUPPORTED_DEEPSEEK_MODELS = [
  'deepseek-v4-flash',
  'deepseek-v4-pro',
] as const

export type SupportedDeepSeekModel = typeof SUPPORTED_DEEPSEEK_MODELS[number]

export interface ModelProfile {
  id: SupportedDeepSeekModel
  contextWindowTokens: number
  providerMaxOutputTokens: number
}

export const DEEPSEEK_MODEL_PROFILES: Readonly<
  Record<SupportedDeepSeekModel, ModelProfile>
> = {
  'deepseek-v4-flash': {
    id: 'deepseek-v4-flash',
    contextWindowTokens: 1_000_000,
    providerMaxOutputTokens: 384_000,
  },
  'deepseek-v4-pro': {
    id: 'deepseek-v4-pro',
    contextWindowTokens: 1_000_000,
    providerMaxOutputTokens: 384_000,
  },
}

export function getModelProfile(model: string): ModelProfile | undefined {
  return Object.hasOwn(DEEPSEEK_MODEL_PROFILES, model)
    ? DEEPSEEK_MODEL_PROFILES[model as SupportedDeepSeekModel]
    : undefined
}
