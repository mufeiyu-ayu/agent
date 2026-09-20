/**
 * `@agent/ai` 的公共面只列 apps/api 实际引用的符号，外加构造 client 需要的
 * `LLMClientConfig` 与模型能力 `LLMModelProfile`；包内实现细节（OpenAI wire 映射）
 * 留在各自模块，出现第二个真实消费者再导出。
 */

export { teeRawResponseCapture } from './api/openai-completions-raw-capture.js'
export { adaptOpenAICompatibleStream } from './api/openai-completions-stream.js'
export { OpenAICompatibleClient } from './api/openai-completions.js'
export type {
  ChatRequestOverrides,
  LLMClientConfig,
  LLMModelProfile,
  ResolvedChatRequestConfig,
} from './config.js'
export { resolveChatRequestConfig } from './config.js'
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
  ProviderBalanceResponse,
  ProviderModelsResponse,
} from './provider-metadata.js'
export type {
  AssistantToolCallInputItem,
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
