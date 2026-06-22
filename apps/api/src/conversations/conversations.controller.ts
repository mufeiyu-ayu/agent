import { Body, Controller, Delete, Get, Inject, Param, Post } from '@nestjs/common'

import { createAppValidationPipe } from '../common/pipes/app-validation.pipe.js'
import { ConversationsService } from './conversations.service.js'
import { ConversationIdParamDto, CreateConversationDto } from './dto/conversation.dto.js'

@Controller('api/conversations')
export class ConversationsController {
  constructor(
    @Inject(ConversationsService)
    private readonly conversationsService: ConversationsService,
  ) {}

  @Post()
  create(
    @Body(createAppValidationPipe({ expectedType: CreateConversationDto }))
    body: CreateConversationDto,
  ) {
    return this.conversationsService.create(body)
  }

  @Get()
  list() {
    return this.conversationsService.list()
  }

  @Delete(':conversationId')
  delete(
    @Param(createAppValidationPipe({ expectedType: ConversationIdParamDto }))
    params: ConversationIdParamDto,
  ) {
    return this.conversationsService.delete(params.conversationId)
  }
}
