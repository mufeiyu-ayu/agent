import { Module } from '@nestjs/common'

import { PrismaModule } from '../prisma/prisma.module.js'
import { AdminConversationsController } from './admin-conversations.controller.js'
import { AdminConversationsService } from './admin-conversations.service.js'

@Module({
  imports: [PrismaModule],
  controllers: [AdminConversationsController],
  providers: [AdminConversationsService],
})
export class AdminConversationsModule {}
