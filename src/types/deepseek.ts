import type {
  ChatCompletionCreateParamsNonStreaming,
  ChatCompletionCreateParamsStreaming,
} from 'openai/resources/chat/completions'

export type DeepSeekChatCompletionParams = ChatCompletionCreateParamsNonStreaming & {
  thinking?: {
    type: 'enabled' | 'disabled'
  }
}

export type DeepSeekChatCompletionStreamingParams = ChatCompletionCreateParamsStreaming & {
  thinking?: {
    type: 'enabled' | 'disabled'
  }
}
