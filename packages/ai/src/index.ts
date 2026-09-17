/**
 * `@agent/ai` 的公共面只列 apps/api 实际引用的符号，外加构造 client 需要的
 * `LLMRuntimeConfig`；包内实现细节（OpenAI wire 映射、profile 表、默认配置常量）
 * 留在各自模块，出现第二个真实消费者再导出。
 */

export { teeRawResponseCapture } from './clients/openai-compatible-raw-capture.js'
export { adaptOpenAICompatibleStream } from './clients/openai-compatible-stream.adapter.js'
export { OpenAICompatibleClient } from './clients/openai-compatible.client.js'
export type {
  LLMRuntimeConfig,
  ResolvedChatRequestConfig,
} from './llm-runtime-config.js'
export {
  resolveChatRequestConfig,
  resolveLLMRuntimeConfig,
} from './llm-runtime-config.js'
export {
  LLMApiError,
  LLMAuthError,
  LLMBalanceError,
  LLMConfigError,
  LLMError,
  LLMInvalidRequestError,
  LLMNetworkError,
  LLMRateLimitError,
  LLMServerError,
} from './llm.errors.js'
export type {
  ChatMessage,
  ChatOptions,
  ChatStreamOptions,
  DeepSeekBalanceResponse,
  DeepSeekModelsResponse,
  ModelIODebugCaptureSide,
  ModelRawResponseCapture,
} from './llm.types.js'
export type { ModelInputItem } from './model-input.types.js'
export { toModelInputItems } from './model-input.types.js'
export {
  getModelProfile,
  SUPPORTED_DEEPSEEK_MODELS,
} from './model-profiles.js'
export type {
  ModelFinishReason,
  ModelStreamEvent,
  ModelUsage,
  UnvalidatedModelToolCall,
} from './model-stream.types.js'
export { mergeModelUsage } from './model-stream.types.js'
export type {
  JsonObjectSchema,
  ModelToolSpec,
} from './model-tool-spec.types.js'
