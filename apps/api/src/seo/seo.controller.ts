import { Body, Controller, Inject, Post } from '@nestjs/common'

import { createAppValidationPipe } from '../common/pipes/app-validation.pipe.js'
import { GenerateSeoDto } from './dto/generate-seo.dto.js'
import { SeoService } from './seo.service.js'

@Controller('api/seo')
export class SeoController {
  constructor(
    @Inject(SeoService)
    private readonly seoService: SeoService,
  ) {}

  @Post('generate')
  generateSeoContent(
    @Body(createAppValidationPipe({ expectedType: GenerateSeoDto }))
    body: GenerateSeoDto,
  ) {
    return this.seoService.generateSeoContent(body)
  }
}
