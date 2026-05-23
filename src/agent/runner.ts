import type OpenAI from 'openai'

import type {
  DeepSeekMessageParam,
  DeepSeekModel,
  DeepSeekReasoningEffort,
  DeepSeekThinkingMode,
} from '../deepseek/types.js'

import { env } from '../config.js'
import { createChatCompletion } from '../deepseek/chat.js'
import { ConversationMemory } from './memory.js'
import { learningToolDefinitions, learningToolMap } from './tools.js'

export interface AgentRunnerOptions {
  client: OpenAI
  model?: DeepSeekModel
  systemPrompt?: string
  thinking?: DeepSeekThinkingMode
  reasoningEffort?: DeepSeekReasoningEffort
  maxToolRounds?: number
}

export class AgentRunner {
  private readonly memory: ConversationMemory

  constructor(private readonly options: AgentRunnerOptions) {
    const initialMessages: DeepSeekMessageParam[] = options.systemPrompt
      ? [{ role: 'system', content: options.systemPrompt }]
      : []

    this.memory = new ConversationMemory(initialMessages)
  }

  async ask(input: string) {
    this.memory.addUser(input)

    const maxToolRounds = this.options.maxToolRounds ?? 4

    for (let round = 0; round < maxToolRounds; round += 1) {
      const completion = await createChatCompletion(this.options.client, {
        model: this.options.model ?? env.DEEPSEEK_MODEL,
        messages: this.memory.list(),
        tools: learningToolDefinitions,
        stream: false,
        thinking: { type: this.options.thinking ?? env.DEEPSEEK_THINKING },
        reasoning_effort: this.options.reasoningEffort ?? env.DEEPSEEK_REASONING_EFFORT,
      })

      const assistantMessage = completion.choices[0]?.message

      if (!assistantMessage)
        throw new Error('模型没有返回 assistant message')

      this.memory.add(assistantMessage as DeepSeekMessageParam)

      const toolCalls = assistantMessage.tool_calls

      if (!toolCalls?.length)
        return assistantMessage.content ?? ''

      for (const toolCall of toolCalls) {
        if (toolCall.type !== 'function')
          throw new Error(`暂不支持 custom tool call：${toolCall.id}`)

        const tool = learningToolMap.get(toolCall.function.name)
        const content = tool
          ? await tool.call(toolCall.function.arguments)
          : `未知工具：${toolCall.function.name}`

        this.memory.add({
          role: 'tool',
          tool_call_id: toolCall.id,
          content,
        })
      }
    }

    throw new Error(`工具调用超过最大轮数：${maxToolRounds}`)
  }

  messages() {
    return this.memory.list()
  }
}
