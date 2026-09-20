import type { LLMModelProfile } from '@agent/ai'
import type { ResolvedLlmModel } from './llm-model-config.service.js'

/** 测试用的模型行快照：上下文按 DeepSeek V4 Flash 的 1M，输出上限 65_536 是测试常量（生产预设为 384k），预算断言依赖它。 */
export function createResolvedLlmModel(
  profile: Partial<LLMModelProfile> = {},
): ResolvedLlmModel {
  return {
    modelId: 'model-deepseek-v4-flash',
    provider: {
      providerId: 'provider-deepseek',
      baseUrl: 'https://api.deepseek.com/v1',
      apiKey: 'test-api-key',
    },
    profile: {
      wireName: 'deepseek-v4-flash',
      contextWindowTokens: 1_000_000,
      maxOutputTokens: 65_536,
      reasoning: true,
      reasoningEffort: 'high',
      ...profile,
    },
  }
}
