import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions'
import type { DeepSeekChatCompletionParams } from '../types/deepseek.js'

import process from 'node:process'
import OpenAI from 'openai'

import 'dotenv/config'

let openai: OpenAI | null = null

type CreateChatCompletionOptions = Pick<
  DeepSeekChatCompletionParams,
  'max_tokens' | 'response_format'
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
    // 当前阶段先关闭 thinking，避免 JSON Output 示例混入推理内容字段。
    thinking: { type: 'disabled' },
    stream: false,
  }

  return getOpenAIClient().chat.completions.create(params)
}
