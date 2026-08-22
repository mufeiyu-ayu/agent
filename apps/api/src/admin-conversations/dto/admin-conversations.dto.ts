import { Transform, Type } from 'class-transformer'
import {
  IsInt,
  IsNotEmpty,
  IsOptional,
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
}

export class AdminConversationIdParamDto {
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  conversationId!: string
}
