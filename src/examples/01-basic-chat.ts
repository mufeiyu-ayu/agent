import process from 'node:process'

import { env } from '../config.js'
import { createChatCompletion, getAssistantContent } from '../deepseek/chat.js'
import { createDeepSeekClient } from '../deepseek/client.js'

const client = createDeepSeekClient()

async function main() {
  const completion = await createChatCompletion(client, {
    model: env.DEEPSEEK_MODEL,
    messages: [
      {
        role: 'system',
        content: 'You are a helpful assistant.',
      },
      {
        role: 'user',
        content: '请用一句话解释 Agent 开发里的上下文管理是什么。',
      },
    ],
    thinking: { type: env.DEEPSEEK_THINKING },
    reasoning_effort: env.DEEPSEEK_REASONING_EFFORT,
    stream: false,
  })

  console.log(getAssistantContent(completion))
}

main().catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})
