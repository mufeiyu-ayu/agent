import type { AuthContext } from '../auth/auth.decorators.js'
import { Controller, Get, Inject, Param } from '@nestjs/common'

import { CurrentAuth } from '../auth/auth.decorators.js'
// DTO classes are required at runtime for Nest decorator metadata.
// eslint-disable-next-line ts/consistent-type-imports
import { ConversationIdParamDto } from './dto/conversation.dto.js'
import { MessagesService } from './messages.service.js'

@Controller('conversations')
export class MessagesController {
  constructor(
    @Inject(MessagesService)
    private readonly messagesService: MessagesService,
  ) {}

  @Get(':conversationId/messages')
  listMessages(
    @CurrentAuth() auth: AuthContext,
    @Param() params: ConversationIdParamDto,
  ) {
    return this.messagesService.listMessages(auth.user.id, params.conversationId)
  }
}
