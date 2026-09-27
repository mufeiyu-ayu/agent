import { Transform, Type } from 'class-transformer'
import {
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

import {
  ADMIN_RUN_PAGE_MAX,
  ADMIN_RUN_PAGE_SIZE_MAX,
} from '../../admin-runs/dto/admin-runs.dto.js'

export class ListAdminConversationsQueryDto {
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
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  userId?: string

  /** 按最近活跃（updatedAt）筛选的起止时间。 */
  @IsOptional()
  @IsISO8601({ strict: true, strictSeparator: true })
  @IsRFC3339({ message: 'dateFrom 必须是带时区的 ISO 8601 timestamp' })
  dateFrom?: string

  @IsOptional()
  @IsISO8601({ strict: true, strictSeparator: true })
  @IsRFC3339({ message: 'dateTo 必须是带时区的 ISO 8601 timestamp' })
  dateTo?: string
}

export class AdminConversationIdParamDto {
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  conversationId!: string
}
