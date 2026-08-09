import { Module } from '@nestjs/common'

import { PrismaModule } from '../prisma/prisma.module.js'
import { AdminRunsController } from './admin-runs.controller.js'
import { AdminRunsService } from './admin-runs.service.js'

@Module({
  imports: [PrismaModule],
  controllers: [AdminRunsController],
  providers: [AdminRunsService],
})
export class AdminRunsModule {}
