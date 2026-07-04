import { Module } from '@nestjs/common'

import { AgentRuntimeModule } from '../agent-runtime/agent-runtime.module.js'
import { PrismaModule } from '../prisma/prisma.module.js'
import { SeoController } from './seo.controller.js'
import { SeoService } from './seo.service.js'

@Module({
  imports: [AgentRuntimeModule, PrismaModule],
  controllers: [SeoController],
  providers: [SeoService],
})
export class SeoModule {}
