/**
 * `@agent/ai` 的公共面只列 apps/api 实际引用的符号，外加构造 client 需要的
 * `LLMRuntimeConfig`；包内实现细节（OpenAI wire 映射、profile 表、默认配置常量）
 * 留在各自模块，出现第二个真实消费者再导出。
 */

export { teeRawResponseCapture } from './api/openai-completions-raw-capture.js'
export { adaptOpenAICompatibleStream } from './api/openai-completions-stream.js'
export { OpenAICompatibleClient } from './api/openai-completions.js'
export type {
  LLMRuntimeConfig,
  ResolvedChatRequestConfig,
} from './config.js'
export {
  resolveChatRequestConfig,
  resolveLLMRuntimeConfig,
} from './config.js'
export type {
  DeepSeekBalanceResponse,
  DeepSeekModelsResponse,
} from './deepseek.js'
export {
  getModelProfile,
  SUPPORTED_DEEPSEEK_MODELS,
} from './deepseek.js'
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
} from './errors.js'
export type {
  AssistantToolCallInputItem,
  ChatOptions,
  ChatStreamOptions,
  JsonObjectSchema,
  MessageInputItem,
  ModelFinishReason,
  ModelInputItem,
  ModelIODebugCaptureSide,
  ModelRawResponseCapture,
  ModelStreamEvent,
  ModelToolSpec,
  ModelUsage,
  ToolResultInputItem,
  UnvalidatedModelToolCall,
} from './types.js'
export { mergeModelUsage } from './types.js'
