import process from 'node:process'

import { env } from '../config.js'
import { createStreamingChatCompletion, getReasoningDelta } from '../deepseek/chat.js'
import { createDeepSeekClient } from '../deepseek/client.js'

const client = createDeepSeekClient()

async function main() {
  const stream = await createStreamingChatCompletion(client, {
    model: env.DEEPSEEK_MODEL,
    messages: [
      {
        role: 'system',
        content: 'You are a helpful assistant.',
      },
      {
        role: 'user',
        content: '请用三点说明流式输出适合哪些 Agent 场景。',
      },
    ],
    thinking: { type: env.DEEPSEEK_THINKING },
    reasoning_effort: env.DEEPSEEK_REASONING_EFFORT,
    stream: true,
  })

  let reasoningLength = 0

  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta
    const reasoning = getReasoningDelta(delta)

    reasoningLength += reasoning.length
    process.stdout.write(delta?.content ?? '')
  }

  process.stdout.write('\n')

  if (reasoningLength > 0)
    process.stderr.write(`已收到 thinking 内容，长度：${reasoningLength}\n`)
}

main().catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})
