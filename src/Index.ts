import type { ChatCompletionCreateParamsNonStreaming } from 'openai/resources/chat/completions'

import process from 'node:process'

import OpenAI from 'openai'
import 'dotenv/config'

const openai = new OpenAI({
  baseURL: 'https://api.deepseek.com',
  apiKey: process.env.DEEPSEEK_API_KEY,
})

async function main() {
  const completion = await openai.chat.completions.create({
    messages: [
      {
        role: 'system',
        content: '你是一个专业的 SEO 内容生成助手。',
      },
      {
        role: 'user',
        content: '帮我为 PUBG UC 充值页面生成英文 SEO title 和 description。',
      },
    ],
    model: 'deepseek-v4-flash',
    thinking: { type: 'disabled' },
    stream: false,
  } as unknown as ChatCompletionCreateParamsNonStreaming)

  console.log(completion)
}

main().catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})
