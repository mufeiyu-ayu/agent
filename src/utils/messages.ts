import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions'
import type { createChatCompletion } from '../services/deepseek-chat.js'

export function appendAssistantMessage(
  messages: ChatCompletionMessageParam[],
  completion: Awaited<ReturnType<typeof createChatCompletion>>,
) {
  const content = completion.choices[0]?.message.content

  if (content == null) {
    throw new Error('模型没有返回 content，当前示例暂不处理 tool_calls 或空内容。')
  }

  messages.push({
    role: 'assistant',
    content,
  })

  return content
}
