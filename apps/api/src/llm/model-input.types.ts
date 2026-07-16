import type { ChatMessage } from './llm.types.js'

/** Runtime 传给模型的内部输入；工具调用过程不会进入用户可见消息。 */
export type ModelInputItem
  = | {
    type: 'message'
    role: ChatMessage['role']
    content: string
  }
  | {
    type: 'assistant_tool_call'
    callId: string
    name: string
    rawArgumentsJson: string
    content?: string
  }
  | {
    type: 'tool_result'
    callId: string
    name: string
    content: string
    ok: boolean
  }

export function toModelInputItems(messages: ChatMessage[]): ModelInputItem[] {
  return messages.map(message => ({
    type: 'message',
    role: message.role,
    content: message.content,
  }))
}
