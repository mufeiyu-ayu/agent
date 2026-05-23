import type { DeepSeekMessageParam } from '../deepseek/types.js'

export class ConversationMemory {
  private readonly messages: DeepSeekMessageParam[] = []

  constructor(initialMessages: DeepSeekMessageParam[] = []) {
    this.messages.push(...initialMessages)
  }

  add(message: DeepSeekMessageParam) {
    this.messages.push(message)
    return this
  }

  addSystem(content: string) {
    return this.add({ role: 'system', content })
  }

  addUser(content: string) {
    return this.add({ role: 'user', content })
  }

  addAssistant(content: string) {
    return this.add({ role: 'assistant', content })
  }

  list() {
    return [...this.messages]
  }

  clear() {
    this.messages.length = 0
  }
}
