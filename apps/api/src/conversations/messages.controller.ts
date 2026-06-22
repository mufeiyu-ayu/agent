import { Body, Controller, Get, Inject, Param, Post } from '@nestjs/common'

// DTO classes are required at runtime for Nest decorator metadata.
// eslint-disable-next-line ts/consistent-type-imports
import { ConversationIdParamDto } from './dto/conversation.dto.js'
// DTO classes are required at runtime for Nest decorator metadata.
// eslint-disable-next-line ts/consistent-type-imports
import { CreateMessageDto } from './dto/message.dto.js'
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

  @Post(':conversationId/messages/user')
  createUserMessage(
    @Param() params: ConversationIdParamDto,
    @Body() body: CreateMessageDto,
  ) {
    return this.messagesService.createUserMessage(params.conversationId, body)
  }

  @Post(':conversationId/messages/assistant')
  createAssistantMessage(
    @Param() params: ConversationIdParamDto,
    @Body() body: CreateMessageDto,
  ) {
    return this.messagesService.createAssistantMessage(params.conversationId, body)
  }
}
