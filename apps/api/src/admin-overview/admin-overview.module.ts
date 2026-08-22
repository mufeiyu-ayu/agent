import { Module } from '@nestjs/common'

import { PrismaModule } from '../prisma/prisma.module.js'
import { AdminOverviewController } from './admin-overview.controller.js'
import { AdminOverviewService } from './admin-overview.service.js'

// LLMRuntimeConfigService 来自 @Global 的 LlmModule 导出，复用同一单例。
@Module({
  imports: [PrismaModule],
  controllers: [AdminOverviewController],
  providers: [AdminOverviewService],
})
export class AdminOverviewModule {}
