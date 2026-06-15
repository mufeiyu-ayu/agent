import type { SeoChatDto } from './dto/seo-chat.dto.js'
import type { SeoChatResult } from './types/seo.types.js'
import { Inject, Injectable } from '@nestjs/common'

import { LLMService } from '../llm/llm.service.js'
import { buildSeoAgentChatMessages } from './prompts/seo-agent.prompt.js'

@Injectable()
export class SeoService {
  constructor(
    @Inject(LLMService)
    private readonly llmService: LLMService,
  ) {}

  async chat(input: SeoChatDto): Promise<SeoChatResult> {
    const messages = buildSeoAgentChatMessages(input)
    const reply = await this.llmService.chat(messages, {
      ...(input.model ? { model: input.model } : {}),
      temperature: 0.4,
      maxTokens: 1200,
    })

    return {
      reply,
      generatedAt: new Date().toISOString(),
    }
  }
}
