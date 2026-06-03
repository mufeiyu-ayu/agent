import type { GenerateSeoDto } from './dto/generate-seo.dto.js'
import type { SeoStreamEvent } from './types/seo-stream.types.js'
import { Inject, Injectable } from '@nestjs/common'

import { SeoService } from './seo.service.js'

@Injectable()
export class SeoStreamService {
  constructor(
    @Inject(SeoService)
    private readonly seoService: SeoService,
  ) {}

  async* generateSeoContentStream(input: GenerateSeoDto): AsyncGenerator<SeoStreamEvent> {
    yield {
      type: 'started',
      message: 'Request accepted',
    }

    yield {
      type: 'progress',
      message: 'Building prompt',
    }

    yield {
      type: 'progress',
      message: 'Calling model',
    }

    const result = await this.seoService.generateSeoContent(input)

    yield {
      type: 'progress',
      message: 'Validating structured result',
    }

    yield {
      type: 'result',
      data: result,
    }

    yield {
      type: 'done',
    }
  }
}
