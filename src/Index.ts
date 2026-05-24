import type {
  ChatCompletionMessageParam,
} from 'openai/resources/chat/completions'

import process from 'node:process'

import { createChatCompletion } from './services/deepseek-chat.js'

import { appendAssistantMessage } from './utils/messages.js'
import 'dotenv/config'

async function main() {
  const messages: ChatCompletionMessageParam[] = [
    {
      role: 'system',
      content: '你是一个简洁准确的知识问答助手。',
    },
    {
      role: 'user',
      content: 'What is the highest mountain in the world?',
    },
  ]

  const round1Completion = await createChatCompletion(messages)
  const round1Answer = appendAssistantMessage(messages, round1Completion)

  console.log('Round 1 Answer:')
  console.log(round1Answer)
  console.log('Messages Round 1:')
  console.log(JSON.stringify(messages, null, 2))

  messages.push({
    role: 'user',
    content: 'What is the second?',
  })

  const round2Completion = await createChatCompletion(messages)
  const round2Answer = appendAssistantMessage(messages, round2Completion)

  console.log('Round 2 Answer:')
  console.log(round2Answer)
  console.log('Messages Round 2:')
  console.log(JSON.stringify(messages, null, 2))
}

main().catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})
