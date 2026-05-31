import type { GenerateSeoDto } from './dto/generate-seo.dto.js'
import type { GenerateSeoContentResult } from './types/seo.types.js'
import { Inject, Injectable } from '@nestjs/common'

import { SeoGenerationService } from './seo-generation.service.js'
import { buildSeoChecks } from './tools/seo-check.tool.js'
import { normalizeKeywords } from './utils/seo-content.util.js'

@Injectable()
export class SeoService {
  constructor(
    @Inject(SeoGenerationService)
    private readonly seoGenerationService: SeoGenerationService,
  ) {}

  async generateSeoContent(input: GenerateSeoDto): Promise<GenerateSeoContentResult> {
    const keywords = normalizeKeywords(input.keywords)
    const generated = await this.seoGenerationService.generateWithJsonOutput(input)

    return {
      title: generated.title,
      description: generated.description,
      checks: buildSeoChecks({
        title: generated.title,
        description: generated.description,
        keywords,
      }),
      generatedAt: new Date().toISOString(),
    }
  }
}
