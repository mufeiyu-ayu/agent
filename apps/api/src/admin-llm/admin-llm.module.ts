import { Module } from '@nestjs/common'

import { PrismaModule } from '../prisma/prisma.module.js'
import { AdminLlmController } from './admin-llm.controller.js'
import { AdminLlmService } from './admin-llm.service.js'

// LLMService / LLMRuntimeConfigService 来自 @Global 的 LlmModule。
@Module({
  imports: [PrismaModule],
  controllers: [AdminLlmController],
  providers: [AdminLlmService],
})
export class AdminLlmModule {}
