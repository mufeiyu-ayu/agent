import type {
  ChatCompletion,
  ChatCompletionChunk,
  ChatCompletionCreateParamsNonStreaming,
  ChatCompletionCreateParamsStreaming,
  ChatCompletionMessageParam,
} from 'openai/resources/chat/completions'

export const DEEPSEEK_MODELS = [
  'deepseek-v4-pro',
  'deepseek-v4-flash',
] as const

export type DeepSeekModel = typeof DEEPSEEK_MODELS[number]

export type DeepSeekThinkingMode = 'enabled' | 'disabled'

export interface DeepSeekThinking {
  type: DeepSeekThinkingMode
}

export type DeepSeekReasoningEffort = 'high' | 'max'

export interface DeepSeekChatExtras {
  thinking?: DeepSeekThinking
  reasoning_effort?: DeepSeekReasoningEffort
}

export interface DeepSeekChatParams
  extends Omit<ChatCompletionCreateParamsNonStreaming, 'model' | 'reasoning_effort'>, DeepSeekChatExtras {
  model: DeepSeekModel
}

export interface DeepSeekStreamChatParams
  extends Omit<ChatCompletionCreateParamsStreaming, 'model' | 'reasoning_effort'>, DeepSeekChatExtras {
  model: DeepSeekModel
}

export type DeepSeekMessageParam = ChatCompletionMessageParam
export type DeepSeekChatCompletion = ChatCompletion
export type DeepSeekChatCompletionChunk = ChatCompletionChunk

export interface DeepSeekReasoningMessage {
  reasoning_content?: string | null
}

export interface DeepSeekReasoningDelta {
  reasoning_content?: string | null
}
