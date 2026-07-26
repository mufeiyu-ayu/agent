import type { SupportedDeepSeekModel } from './llm.types.js'

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
