import type { GenerateSeoDto } from './dto/generate-seo.dto.js'
import type { SeoGenerationOutput } from './types/seo.types.js'
import { Inject, Injectable } from '@nestjs/common'

import { LLMService } from '../llm/llm.service.js'
import { buildSeoGenerationMessages } from './prompts/seo-generation.prompt.js'
import { parseSeoGenerationOutput } from './validators/seo-output.validator.js'

@Injectable()
export class SeoGenerationService {
  constructor(
    @Inject(LLMService)
    private readonly llmService: LLMService,
  ) {}

  async generateWithJsonOutput(input: GenerateSeoDto): Promise<SeoGenerationOutput> {
    const messages = buildSeoGenerationMessages(input)

    const rawContent = await this.llmService.chat(messages, {
      ...(input.model ? { model: input.model } : {}),
      responseFormat: { type: 'json_object' },
      temperature: 0.2,
      maxTokens: 800,
    })

    return parseSeoGenerationOutput(rawContent)
  }
}
