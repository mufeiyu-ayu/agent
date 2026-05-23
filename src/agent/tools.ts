import type { ChatCompletionFunctionTool } from 'openai/resources/chat/completions'

import { z } from 'zod'

export interface LocalTool {
  definition: ChatCompletionFunctionTool
  call: (argsJson: string) => Promise<string>
}

const currentTimeInputSchema = z.object({
  timezone: z.string().default('Asia/Shanghai'),
})

const getCurrentTimeTool: LocalTool = {
  definition: {
    type: 'function',
    function: {
      name: 'get_current_time',
      description: '获取指定时区的当前时间。',
      parameters: {
        type: 'object',
        properties: {
          timezone: {
            type: 'string',
            description: 'IANA 时区名称，例如 Asia/Shanghai 或 America/New_York。',
          },
        },
        required: [],
      },
    },
  },
  async call(argsJson: string) {
    const input = currentTimeInputSchema.parse(parseJsonObject(argsJson))

    return new Intl.DateTimeFormat('zh-CN', {
      timeZone: input.timezone,
      dateStyle: 'full',
      timeStyle: 'long',
    }).format(new Date())
  },
}

export const learningTools = [
  getCurrentTimeTool,
]

export const learningToolDefinitions = learningTools.map(tool => tool.definition)

export const learningToolMap = new Map(
  learningTools.map(tool => [tool.definition.function.name, tool]),
)

function parseJsonObject(json: string) {
  if (!json.trim())
    return {}

  const value: unknown = JSON.parse(json)

  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new TypeError('工具参数必须是 JSON object')

  return value
}
