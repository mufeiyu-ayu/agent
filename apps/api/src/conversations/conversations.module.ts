import { Module } from '@nestjs/common'

import { AttachmentsModule } from '../attachments/attachments.module.js'
import { PrismaModule } from '../prisma/prisma.module.js'
import { SkillsModule } from '../skills/skills.module.js'
import { WorkspacesModule } from '../workspaces/workspaces.module.js'
import { ConversationsController } from './conversations.controller.js'
import { ConversationsService } from './conversations.service.js'
import { MessagesController } from './messages.controller.js'
import { MessagesService } from './messages.service.js'

@Module({
  imports: [PrismaModule, WorkspacesModule, AttachmentsModule, SkillsModule],
  controllers: [ConversationsController, MessagesController],
  providers: [ConversationsService, MessagesService],
  exports: [ConversationsService],
})
export class ConversationsModule {}
