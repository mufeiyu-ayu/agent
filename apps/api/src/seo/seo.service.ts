import type { GenerateSeoDto } from './dto/generate-seo.dto.js'
import type { GenerateSeoContentResult } from './types/seo.types.js'
import { Injectable } from '@nestjs/common'

import { buildSeoChecks } from './tools/seo-check.tool.js'
import { buildMockDescription, buildMockTitle, normalizeKeywords } from './utils/seo-content.util.js'

@Injectable()
export class SeoService {
  generateSeoContent(input: GenerateSeoDto): GenerateSeoContentResult {
    const pageTopic = input.pageTopic.trim()
    const language = input.language.trim()
    const keywords = normalizeKeywords(input.keywords)
    const primaryKeyword = keywords[0] ?? pageTopic
    const title = buildMockTitle(primaryKeyword)
    const description = buildMockDescription(primaryKeyword, pageTopic, language)

    return {
      title,
      description,
      checks: buildSeoChecks({
        title,
        description,
        keywords,
      }),
      generatedAt: new Date().toISOString(),
    }
  }
}
