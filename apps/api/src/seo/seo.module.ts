import { Module } from '@nestjs/common'

import { PrismaModule } from '../prisma/prisma.module.js'
import { SeoController } from './seo.controller.js'
import { SeoService } from './seo.service.js'

@Module({
  imports: [PrismaModule],
  controllers: [SeoController],
  providers: [SeoService],
})
export class SeoModule {}
