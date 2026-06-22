import { Body, Controller, Get, Inject, Param, Post } from '@nestjs/common'

import { createAppValidationPipe } from '../common/pipes/app-validation.pipe.js'
import { ConversationIdParamDto } from './dto/conversation.dto.js'
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
    @Param(createAppValidationPipe({ expectedType: ConversationIdParamDto }))
    params: ConversationIdParamDto,
  ) {
    return this.messagesService.listMessages(params.conversationId)
  }

  @Post(':conversationId/messages/user')
  createUserMessage(
    @Param(createAppValidationPipe({ expectedType: ConversationIdParamDto }))
    params: ConversationIdParamDto,
    @Body(createAppValidationPipe({ expectedType: CreateMessageDto }))
    body: CreateMessageDto,
  ) {
    return this.messagesService.createUserMessage(params.conversationId, body)
  }

  @Post(':conversationId/messages/assistant')
  createAssistantMessage(
    @Param(createAppValidationPipe({ expectedType: ConversationIdParamDto }))
    params: ConversationIdParamDto,
    @Body(createAppValidationPipe({ expectedType: CreateMessageDto }))
    body: CreateMessageDto,
  ) {
    return this.messagesService.createAssistantMessage(params.conversationId, body)
  }
}
