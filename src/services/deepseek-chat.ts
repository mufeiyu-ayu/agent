import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions'
import type {
  DeepSeekChatCompletionParams,
  DeepSeekChatCompletionStreamingParams,
} from '../types/deepseek.js'

import process from 'node:process'
import OpenAI from 'openai'

import 'dotenv/config'

let openai: OpenAI | null = null

type CreateChatCompletionOptions = Pick<
  DeepSeekChatCompletionParams,
  'max_tokens' | 'response_format' | 'thinking' | 'tool_choice' | 'tools'
>

type CreateStreamingChatCompletionOptions = Pick<
  DeepSeekChatCompletionStreamingParams,
  'max_tokens' | 'thinking'
>

function getDeepSeekApiKey() {
  const apiKey = process.env.DEEPSEEK_API_KEY

  if (apiKey == null || apiKey.length === 0) {
    throw new Error('缺少 DEEPSEEK_API_KEY，请先在 .env 文件中配置 DeepSeek API Key。')
  }

  return apiKey
}

function getOpenAIClient() {
  openai ??= new OpenAI({
    baseURL: 'https://api.deepseek.com',
    apiKey: getDeepSeekApiKey(),
  })

  return openai
}

export async function createChatCompletion(
  messages: ChatCompletionMessageParam[],
  options: CreateChatCompletionOptions = {},
) {
  const params: DeepSeekChatCompletionParams = {
    model: 'deepseek-v4-flash',
    messages,
    ...options,
    stream: false,
  }

  return getOpenAIClient().chat.completions.create(params)
}

export async function createStreamingChatCompletion(
  messages: ChatCompletionMessageParam[],
  options: CreateStreamingChatCompletionOptions = {},
) {
  const params: DeepSeekChatCompletionStreamingParams = {
    model: 'deepseek-v4-flash',
    messages,
    ...options,
    stream: true,
  }

  return getOpenAIClient().chat.completions.create(params)
}
