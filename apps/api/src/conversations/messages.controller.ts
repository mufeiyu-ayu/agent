import { Controller, Get, Inject, Param } from '@nestjs/common'

// DTO classes are required at runtime for Nest decorator metadata.
// eslint-disable-next-line ts/consistent-type-imports
import { ConversationIdParamDto } from './dto/conversation.dto.js'
import { MessagesService } from './messages.service.js'

@Controller('api/conversations')
export class MessagesController {
  constructor(
    @Inject(MessagesService)
    private readonly messagesService: MessagesService,
  ) {}

  @Get(':conversationId/messages')
  listMessages(
    @Param() params: ConversationIdParamDto,
  ) {
    return this.messagesService.listMessages(params.conversationId)
  }
}
