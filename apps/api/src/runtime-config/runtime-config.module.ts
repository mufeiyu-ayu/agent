import { Module } from '@nestjs/common'

import { PrismaModule } from '../prisma/prisma.module.js'
import { RuntimeConfigController } from './runtime-config.controller.js'
import { RuntimeConfigService } from './runtime-config.service.js'

// LlmModelConfigService（Serper Key 的加解密）来自 @Global 的 LlmModule。
@Module({
  imports: [PrismaModule],
  controllers: [RuntimeConfigController],
  providers: [RuntimeConfigService],
  exports: [RuntimeConfigService],
})
export class RuntimeConfigModule {}
