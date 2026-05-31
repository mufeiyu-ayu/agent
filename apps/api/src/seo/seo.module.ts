import { Module } from '@nestjs/common'

import { SeoGenerationService } from './seo-generation.service.js'
import { SeoController } from './seo.controller.js'
import { SeoService } from './seo.service.js'

@Module({
  controllers: [SeoController],
  providers: [SeoService, SeoGenerationService],
})
export class SeoModule {}
