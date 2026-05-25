import type {
  ChatCompletionMessageParam,
} from 'openai/resources/chat/completions'
import type { SeoMetadataOutput } from './types/seo.js'

import process from 'node:process'

import { createChatCompletion } from './services/deepseek-chat.js'
import { parseJsonOutput } from './utils/json-output.js'
import 'dotenv/config'

async function main() {
  const systemPrompt = `
用户会提供一个页面主题。
请根据页面主题生成英文 SEO title 和 description。

你必须只输出 json，不要输出任何解释、Markdown 或额外文本。

示例 json 输出：
{
  "title": "Buy PUBG UC Online - Fast & Secure Top Up",
  "description": "Top up PUBG UC instantly with secure payment and fast delivery."
}
`

  const messages: ChatCompletionMessageParam[] = [
    {
      role: 'system',
      content: systemPrompt,
    },
    {
      role: 'user',
      content: 'PUBG UC 充值页面',
    },
  ]

  const completion = await createChatCompletion(messages, {
    max_tokens: 500,
    response_format: {
      type: 'json_object',
    },
  })

  const content = completion.choices[0]?.message.content
  const seoMetadata = parseJsonOutput<SeoMetadataOutput>(content)

  console.log('Raw JSON Output:')
  console.log(content, typeof content, 33)
  console.log('Parsed Object:')
  console.log(seoMetadata, typeof seoMetadata)
}

main().catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})
