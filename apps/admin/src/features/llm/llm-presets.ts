import type { LlmProviderFamily } from '@agent/contracts'
import { LLM_PROVIDER_FAMILIES } from '@agent/contracts'

/**
 * 服务商预设：选家族即选服务商，自动带官方标识（见 LlmFamilyLogo）。
 * 只有官方公开文档给出的地址才预填（DeepSeek）；中转站地址属于部署配置，由人填，不进代码。
 */
export interface LlmProviderPreset {
  family: LlmProviderFamily
  /** 品牌色；官方标识本身是单色的用 currentColor 跟随主题文字色。 */
  color: string
  suggestedBaseUrl: string
}

const PRESET_BY_FAMILY: Record<LlmProviderFamily, Omit<LlmProviderPreset, 'family'>> = {
  deepseek: { color: '#4d6bfe', suggestedBaseUrl: 'https://api.deepseek.com/v1' },
  openai: { color: 'currentColor', suggestedBaseUrl: '' },
  grok: { color: 'currentColor', suggestedBaseUrl: '' },
  gemini: { color: '#4285f4', suggestedBaseUrl: '' },
  claude: { color: '#d97757', suggestedBaseUrl: '' },
  other: { color: 'currentColor', suggestedBaseUrl: '' },
}

export const LLM_PROVIDER_PRESETS: LlmProviderPreset[] = LLM_PROVIDER_FAMILIES.map(family => ({
  family,
  ...PRESET_BY_FAMILY[family],
}))

export function getLlmProviderPreset(family: LlmProviderFamily): LlmProviderPreset {
  return { family, ...PRESET_BY_FAMILY[family] }
}
