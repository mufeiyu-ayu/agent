import type { ChatCompletionCreateParamsNonStreaming } from 'openai/resources/chat/completions'

export type DeepSeekChatCompletionParams = ChatCompletionCreateParamsNonStreaming & {
  thinking?: {
    type: 'enabled' | 'disabled'
  }
}
