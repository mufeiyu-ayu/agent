import type OpenAI from 'openai'
import type {
  ChatCompletionCreateParamsNonStreaming,
  ChatCompletionCreateParamsStreaming,
} from 'openai/resources/chat/completions'

import type {
  DeepSeekChatCompletion,
  DeepSeekChatParams,
  DeepSeekReasoningDelta,
  DeepSeekReasoningMessage,
  DeepSeekStreamChatParams,
} from './types.js'

export async function createChatCompletion(client: OpenAI, params: DeepSeekChatParams) {
  return client.chat.completions.create(toOpenAINonStreamingParams(params))
}

export async function createStreamingChatCompletion(client: OpenAI, params: DeepSeekStreamChatParams) {
  return client.chat.completions.create(toOpenAIStreamingParams(params))
}

export function getAssistantContent(completion: DeepSeekChatCompletion) {
  return completion.choices[0]?.message.content ?? ''
}

export function getReasoningContent(completion: DeepSeekChatCompletion) {
  const message = completion.choices[0]?.message as DeepSeekReasoningMessage | undefined

  return message?.reasoning_content ?? ''
}

export function getReasoningDelta(delta: unknown) {
  return (delta as DeepSeekReasoningDelta | undefined)?.reasoning_content ?? ''
}

function toOpenAINonStreamingParams(params: DeepSeekChatParams): ChatCompletionCreateParamsNonStreaming {
  // DeepSeek 在 OpenAI 兼容请求体上扩展了 thinking 字段，SDK 类型尚未完整覆盖。
  return params as unknown as ChatCompletionCreateParamsNonStreaming
}

function toOpenAIStreamingParams(params: DeepSeekStreamChatParams): ChatCompletionCreateParamsStreaming {
  // 只在 DeepSeek 边界做类型收束，业务代码就不需要散落类型断言。
  return params as unknown as ChatCompletionCreateParamsStreaming
}
