import type { AuthContext } from '../auth/auth.decorators.js'
import { Body, Controller, Delete, Get, Inject, Param, Patch, Post, Query } from '@nestjs/common'

import { CurrentAuth } from '../auth/auth.decorators.js'
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
    @CurrentAuth() auth: AuthContext,
    @Body() body: CreateConversationDto,
  ) {
    return this.conversationsService.create(auth.user.id, body)
  }

  @Get()
  list(
    @CurrentAuth() auth: AuthContext,
    @Query() query: ListConversationsQueryDto,
  ) {
    return this.conversationsService.list(auth.user.id, query)
  }

  @Patch(':conversationId')
  update(
    @CurrentAuth() auth: AuthContext,
    @Param() params: ConversationIdParamDto,
    @Body() body: UpdateConversationDto,
  ) {
    return this.conversationsService.update(auth.user.id, params.conversationId, body)
  }

  @Delete(':conversationId')
  delete(
    @CurrentAuth() auth: AuthContext,
    @Param() params: ConversationIdParamDto,
  ) {
    return this.conversationsService.delete(auth.user.id, params.conversationId)
  }
}
