import type { LlmProviderFamily, ReasoningEffort } from '@agent/contracts'

/**
 * 拉取导入时的模型行预设，按家族取官方旗舰的上限（2026-09 官方文档）：
 * DeepSeek V4.1 Flash / V4 Pro 1M / 384k；GPT-5.6 1.05M / 128k；Grok 4.6 500k，官方未单列输出上限，取 128k；
 * Gemini 3.8 Flash 1M / 64k；Claude 未接入，先按 200k / 64k；other 保守。
 * 默认 reasoning_effort 取各家官方默认档，Grok 官方默认 high 经中转站一题要两分多钟，先给 low。
 * 导入后都能在表格里改。
 */

export interface ImportedModelDefaults {
  displayName: string
  contextWindowTokens: number
  maxOutputTokens: number
  reasoningEffort: ReasoningEffort | null
  visible: boolean
}

type FamilyDefaults = Omit<ImportedModelDefaults, 'displayName' | 'visible'>

const FAMILY_DEFAULTS: Record<LlmProviderFamily, FamilyDefaults> = {
  deepseek: { contextWindowTokens: 1_000_000, maxOutputTokens: 384_000, reasoningEffort: 'high' },
  openai: { contextWindowTokens: 1_050_000, maxOutputTokens: 128_000, reasoningEffort: 'medium' },
  grok: { contextWindowTokens: 500_000, maxOutputTokens: 128_000, reasoningEffort: 'low' },
  gemini: { contextWindowTokens: 1_000_000, maxOutputTokens: 65_536, reasoningEffort: null },
  claude: { contextWindowTokens: 200_000, maxOutputTokens: 64_000, reasoningEffort: 'medium' },
  other: { contextWindowTokens: 128_000, maxOutputTokens: 8_192, reasoningEffort: null },
}

/** 只有官方文档给了正式名字的模型才写显示名，其余显示名就用 wireName。 */
const DISPLAY_NAMES: Record<string, string> = {
  // 滚动别名：2026-09-10 起指向 V4.1 Flash，旧名 deepseek-v4-flash 只是临时路由，官方 /models 已不列出。
  'deepseek-flash': 'DeepSeek Flash',
  'deepseek-v4-pro': 'DeepSeek V4 Pro',
}

export function resolveImportedModelDefaults(
  family: LlmProviderFamily,
  wireName: string,
): ImportedModelDefaults {
  return {
    ...FAMILY_DEFAULTS[family],
    displayName: DISPLAY_NAMES[wireName] ?? wireName,
    // 拉取导入默认不对前台开放，管理员确认后再打开。
    visible: false,
  }
}
