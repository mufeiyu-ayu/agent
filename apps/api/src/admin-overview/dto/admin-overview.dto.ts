import type { AdminOverviewWindow } from '@agent/contracts'
import { ADMIN_OVERVIEW_WINDOWS } from '@agent/contracts'
import { IsIn, IsOptional } from 'class-validator'

export class GetAdminOverviewStatsQueryDto {
  @IsOptional()
  @IsIn(ADMIN_OVERVIEW_WINDOWS)
  window?: AdminOverviewWindow
}
