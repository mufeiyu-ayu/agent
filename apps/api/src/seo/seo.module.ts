import { Module } from '@nestjs/common'

import { AgentRuntimeModule } from '../agent-runtime/agent-runtime.module.js'
import { SeoController } from './seo.controller.js'
import { SeoService } from './seo.service.js'

@Module({
  imports: [AgentRuntimeModule],
  controllers: [SeoController],
  providers: [SeoService],
})
export class SeoModule {}
