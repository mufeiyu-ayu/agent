import { Module } from '@nestjs/common'

import { SeoController } from './seo.controller.js'
import { SeoService } from './seo.service.js'

@Module({
  controllers: [SeoController],
  providers: [SeoService],
})
export class SeoModule {}
