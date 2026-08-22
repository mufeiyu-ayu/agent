import { Controller, Get, Inject, Param, Query } from '@nestjs/common'

import { AdminConversationsService } from './admin-conversations.service.js'
// DTO classes are required at runtime for Nest decorator metadata.
// eslint-disable-next-line ts/consistent-type-imports
import { AdminConversationIdParamDto, ListAdminConversationsQueryDto } from './dto/admin-conversations.dto.js'

@Controller('admin/conversations')
export class AdminConversationsController {
  constructor(
    @Inject(AdminConversationsService)
    private readonly adminConversationsService: AdminConversationsService,
  ) {}

  @Get()
  list(@Query() query: ListAdminConversationsQueryDto) {
    return this.adminConversationsService.list(query)
  }

  @Get(':conversationId')
  getDetail(@Param() params: AdminConversationIdParamDto) {
    return this.adminConversationsService.getDetail(params.conversationId)
  }
}
