import { Body, Controller, Delete, Get, Inject, Param, Patch, Post, Query } from '@nestjs/common'

import { ConversationsService } from './conversations.service.js'
// DTO classes are required at runtime for Nest decorator metadata.
// eslint-disable-next-line ts/consistent-type-imports
import { ConversationIdParamDto, CreateConversationDto, ListConversationsQueryDto, UpdateConversationDto } from './dto/conversation.dto.js'

@Controller('conversations')
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
  list(
    @Query() query: ListConversationsQueryDto,
  ) {
    return this.conversationsService.list(query)
  }

  @Patch(':conversationId')
  update(
    @Param() params: ConversationIdParamDto,
    @Body() body: UpdateConversationDto,
  ) {
    return this.conversationsService.update(params.conversationId, body)
  }

  @Delete(':conversationId')
  delete(
    @Param() params: ConversationIdParamDto,
  ) {
    return this.conversationsService.delete(params.conversationId)
  }
}
