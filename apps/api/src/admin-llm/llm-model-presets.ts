import type { LlmProviderFamily, ReasoningEffort } from '@agent/contracts'

/**
 * 输入预算的安全余量：token 估算不是精确计数，单次输入上限最多到「窗口 − 输出上限 − 它」。
 */
export const INPUT_SAFETY_MARGIN_TOKENS = 16_384

/**
 * 导入时单次输入上限的默认值，与迁移前的输入预算一致（存量行迁移成的也是它）。
 * 只是导入预设，行上的值可在表格里改；运行时不再有任何上限常量，直接用行上的值。
 */
const IMPORTED_MAX_INPUT_TOKENS = 262_144

/** 单次输入上限允许的最大值；窗口放不下输出上限加安全余量时小于 1，这样的行不能对前台可见。 */
export function maxInputTokensCeiling(row: { contextWindowTokens: number, maxOutputTokens: number }): number {
  return row.contextWindowTokens - row.maxOutputTokens - INPUT_SAFETY_MARGIN_TOKENS
}

/**
 * 拉取导入时的模型行预设，按家族取官方旗舰的上限（2026-09 官方文档）：
 * DeepSeek V4.1 Flash / V4 Pro 1M / 384k；GPT-5.6 1.05M / 128k；Grok 4.6 500k，官方未单列输出上限，取 128k；
 * Gemini 3.8 Flash 1M / 64k；Claude 未接入，先按 200k / 64k；other 保守。
 * 默认 reasoning_effort 取各家官方默认档，Grok 官方默认 high 经中转站一题要两分多钟，先给 low。
 * 单次输入上限默认取 262,144 与窗口容量中较小的一个。导入后都能在表格里改。
 */

export interface ImportedModelDefaults {
  displayName: string
  contextWindowTokens: number
  maxInputTokens: number
  maxOutputTokens: number
  reasoningEffort: ReasoningEffort | null
  visible: boolean
}

type FamilyDefaults = Omit<ImportedModelDefaults, 'displayName' | 'maxInputTokens' | 'visible'>

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
  const defaults = FAMILY_DEFAULTS[family]

  return {
    ...defaults,
    maxInputTokens: Math.min(IMPORTED_MAX_INPUT_TOKENS, maxInputTokensCeiling(defaults)),
    displayName: DISPLAY_NAMES[wireName] ?? wireName,
    // 拉取导入默认不对前台开放，管理员确认后再打开。
    visible: false,
  }
}
