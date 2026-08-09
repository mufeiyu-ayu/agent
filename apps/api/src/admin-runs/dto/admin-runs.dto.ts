import type { AgentRunStatus } from '@agent/contracts'
import { Transform, Type } from 'class-transformer'
import {
  IsIn,
  IsInt,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsRFC3339,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator'

export const ADMIN_RUN_PAGE_SIZE_MAX = 50
export const ADMIN_RUN_PAGE_MAX = 1_000_000

const ADMIN_RUN_STATUSES: AgentRunStatus[] = [
  'RUNNING',
  'COMPLETED',
  'FAILED',
  'ABORTED',
]
export class ListAdminRunsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(ADMIN_RUN_PAGE_MAX)
  page?: number

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(ADMIN_RUN_PAGE_SIZE_MAX)
  pageSize?: number

  @IsOptional()
  @IsIn(ADMIN_RUN_STATUSES)
  status?: AgentRunStatus

  @IsOptional()
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  query?: string

  @IsOptional()
  @IsISO8601({ strict: true, strictSeparator: true })
  @IsRFC3339({ message: 'dateFrom 必须是带时区的 ISO 8601 timestamp' })
  dateFrom?: string

  @IsOptional()
  @IsISO8601({ strict: true, strictSeparator: true })
  @IsRFC3339({ message: 'dateTo 必须是带时区的 ISO 8601 timestamp' })
  dateTo?: string
}

export class AdminRunIdParamDto {
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  runId!: string
}
