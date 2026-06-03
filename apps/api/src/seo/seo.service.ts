import type { GenerateSeoDto } from './dto/generate-seo.dto.js'
import type { GenerateSeoContentResult } from './types/seo.types.js'
import { Inject, Injectable } from '@nestjs/common'

import { SeoGenerationService } from './seo-generation.service.js'

@Injectable()
export class SeoService {
  constructor(
    @Inject(SeoGenerationService)
    private readonly seoGenerationService: SeoGenerationService,
  ) {}

  async generateSeoContent(input: GenerateSeoDto): Promise<GenerateSeoContentResult> {
    const generated = await this.seoGenerationService.generateWithJsonOutput(input)

    return {
      title: generated.title,
      description: generated.description,
      suggestions: generated.suggestions,
      generatedAt: new Date().toISOString(),
    }
  }
}
