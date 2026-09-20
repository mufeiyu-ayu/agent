import type { LlmProviderFamily } from '@agent/contracts'

/**
 * 拉取导入时的模型行预设。
 * 只有官方文档给出能力值的模型才写死（当前只有 DeepSeek）；中转站后面的 gpt / gemini / claude
 * 拿不到可信的上下文窗口，按名字猜就是 cc-switch 把 context_window 报成 100 万的那个坑，一律保守默认。
 */

export interface ImportedModelDefaults {
  displayName: string
  contextWindowTokens: number
  maxOutputTokens: number
  reasoning: boolean
  visible: boolean
}

const CONSERVATIVE_DEFAULTS = {
  contextWindowTokens: 128_000,
  maxOutputTokens: 8_192,
  visible: false,
} as const

/** DeepSeek 官方模型的能力（platform.deepseek.com 文档值）。 */
const DEEPSEEK_KNOWN_MODELS: Record<string, Omit<ImportedModelDefaults, 'visible' | 'reasoning'>> = {
  'deepseek-v4-flash': {
    displayName: 'DeepSeek V4 Flash',
    contextWindowTokens: 1_000_000,
    maxOutputTokens: 384_000,
  },
}

export function resolveImportedModelDefaults(
  family: LlmProviderFamily,
  wireName: string,
): ImportedModelDefaults {
  const known = family === 'deepseek' ? DEEPSEEK_KNOWN_MODELS[wireName] : undefined

  if (known) {
    // 只有文档确认是 thinking 模型的名字才默认开思考：开了就要求 Tool Call 带 reasoning_content，
    // 对非 thinking 的 deepseek-chat 一类会让首次工具调用直接 FAILED，而探测（reasoning=false）看不出来。
    return { ...CONSERVATIVE_DEFAULTS, ...known, reasoning: true }
  }

  return {
    ...CONSERVATIVE_DEFAULTS,
    displayName: wireName,
    reasoning: false,
  }
}
