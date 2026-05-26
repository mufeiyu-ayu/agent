import type {
  ChatCompletionMessageParam,
} from 'openai/resources/chat/completions'

import process from 'node:process'

import { createChatCompletion } from './services/deepseek-chat.js'
import { weatherTools } from './tools/weather.js'
import 'dotenv/config'

async function sendMessages(messages: ChatCompletionMessageParam[]) {
  const response = await createChatCompletion(messages, {
    tools: weatherTools,
  })
  const message = response.choices[0]?.message

  if (message == null) {
    throw new Error('模型没有返回 assistant message。')
  }
  return message
}

async function main() {
  const messages: ChatCompletionMessageParam[] = [
    {
      role: 'user',
      content: 'How\'s the weather in Hangzhou, Zhejiang?',
    },
  ]

  const message = await sendMessages(messages)
  console.log(`User>\t ${messages[0]?.content}`)

  const tool = message.tool_calls?.[0]
  if (tool == null) {
    console.log('模型没有选择调用工具，直接回复：')
    console.log(message.content)
    return
  }

  messages.push(message)
  messages.push({
    role: 'tool',
    tool_call_id: tool.id,
    content: '24℃',
  })

  console.log(messages, 3333)
  const finalMessage = await sendMessages(messages)

  console.log(`Model>\t ${finalMessage.content}`)
}

main().catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})
