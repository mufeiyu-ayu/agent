import { Controller, Get, Inject } from '@nestjs/common'

import { AdminOverviewService } from './admin-overview.service.js'

@Controller('admin/overview')
export class AdminOverviewController {
  constructor(
    @Inject(AdminOverviewService)
    private readonly adminOverviewService: AdminOverviewService,
  ) {}

  @Get('stats')
  getStats() {
    return this.adminOverviewService.getStats()
  }

  @Get('balance')
  getBalance() {
    return this.adminOverviewService.getBalance()
  }
}
