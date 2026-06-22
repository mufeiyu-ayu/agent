import { Body, Controller, Delete, Get, Inject, Param, Post } from '@nestjs/common'

import { ConversationsService } from './conversations.service.js'
// DTO classes are required at runtime for Nest decorator metadata.
// eslint-disable-next-line ts/consistent-type-imports
import { ConversationIdParamDto, CreateConversationDto } from './dto/conversation.dto.js'

@Controller('api/conversations')
export class ConversationsController {
  constructor(
    @Inject(ConversationsService)
    private readonly conversationsService: ConversationsService,
  ) {}

  @Post()
  create(
    @Body() body: CreateConversationDto,
  ) {
    return this.conversationsService.create(body)
  }

  @Get()
  list() {
    return this.conversationsService.list()
  }

  @Delete(':conversationId')
  delete(
    @Param() params: ConversationIdParamDto,
  ) {
    return this.conversationsService.delete(params.conversationId)
  }
}
