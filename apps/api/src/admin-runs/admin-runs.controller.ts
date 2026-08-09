import { Controller, Get, Inject, Param, Query } from '@nestjs/common'

import { AdminRunsService } from './admin-runs.service.js'
// DTO classes are required at runtime for Nest decorator metadata.
// eslint-disable-next-line ts/consistent-type-imports
import { AdminRunIdParamDto, ListAdminRunsQueryDto } from './dto/admin-runs.dto.js'

@Controller('admin/runs')
export class AdminRunsController {
  constructor(
    @Inject(AdminRunsService)
    private readonly adminRunsService: AdminRunsService,
  ) {}

  @Get()
  list(@Query() query: ListAdminRunsQueryDto) {
    return this.adminRunsService.list(query)
  }

  @Get(':runId')
  getDetail(@Param() params: AdminRunIdParamDto) {
    return this.adminRunsService.getDetail(params.runId)
  }
}
