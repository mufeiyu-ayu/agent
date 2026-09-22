import { Controller, Get, Inject, Query } from '@nestjs/common'

import { AdminOverviewService } from './admin-overview.service.js'
// eslint-disable-next-line ts/consistent-type-imports
import { GetAdminOverviewStatsQueryDto } from './dto/admin-overview.dto.js'

@Controller('admin/overview')
export class AdminOverviewController {
  constructor(
    @Inject(AdminOverviewService)
    private readonly adminOverviewService: AdminOverviewService,
  ) {}

  @Get('stats')
  getStats(@Query() query: GetAdminOverviewStatsQueryDto) {
    return this.adminOverviewService.getStats(query.window ?? '30d')
  }

  @Get('balance')
  getBalance() {
    return this.adminOverviewService.getBalance()
  }
}
