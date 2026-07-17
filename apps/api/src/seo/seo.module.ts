import { Module } from '@nestjs/common'

import { AgentRuntimeModule } from '../agent-runtime/agent-runtime.module.js'
import { SeoContextBuilder } from './seo-context-builder.service.js'
import { SeoController } from './seo.controller.js'
import { SeoService } from './seo.service.js'

@Module({
  imports: [AgentRuntimeModule],
  controllers: [SeoController],
  providers: [SeoContextBuilder, SeoService],
})
export class SeoModule {}
