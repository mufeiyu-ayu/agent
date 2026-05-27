import type {
  ChatCompletionMessageParam,
} from 'openai/resources/chat/completions'

import process from 'node:process'

import { createStreamingChatCompletion } from './services/deepseek-chat.js'
import 'dotenv/config'

async function main() {
  const messages: ChatCompletionMessageParam[] = [
    {
      role: 'system',
      content: '你是一个简洁准确的 AI 学习助手，请用中文回答。',
    },
    {
      role: 'user',
      content: '请用三句话解释：什么是 LLM API 的流式输出？',
    },
  ]

  console.log(`User>\t ${messages[1]?.content}`)
  console.log('Model>\t')

  const stream = await createStreamingChatCompletion(messages, {
    max_tokens: 500,
    thinking: { type: 'disabled' },
  })

  let fullContent = ''
  console.log(stream, 'stream')
  for await (const chunk of stream) {
    const content = chunk.choices[0]?.delta.content
    if (content == null) {
      continue
    }
    fullContent += content
    process.stdout.write(content)
  }

  console.log('\n\nFull Content>')
  console.log(fullContent)
}

main().catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})
