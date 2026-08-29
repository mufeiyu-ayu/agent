import { Module } from '@nestjs/common'

import { PrismaModule } from '../prisma/prisma.module.js'
import { AdminQaController } from './admin-qa.controller.js'
import { AdminQaService } from './admin-qa.service.js'

@Module({
  imports: [PrismaModule],
  controllers: [AdminQaController],
  providers: [AdminQaService],
})
export class AdminQaModule {}
