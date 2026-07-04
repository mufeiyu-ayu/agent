import type { ChatMessage } from '../llm/llm.types.js'
import { Injectable } from '@nestjs/common'

import { buildSeoAgentChatMessages } from './prompts/seo-agent.prompt.js'

export interface BuildSeoContextInput {
  historyMessages: ChatMessage[]
}

@Injectable()
export class SeoContextBuilder {
  buildModelMessages(input: BuildSeoContextInput): ChatMessage[] {
    return buildSeoAgentChatMessages(input.historyMessages)
  }
}
