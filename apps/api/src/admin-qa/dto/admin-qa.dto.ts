import { Transform, Type } from 'class-transformer'
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator'

import {
  ADMIN_RUN_PAGE_MAX,
  ADMIN_RUN_PAGE_SIZE_MAX,
} from '../../admin-runs/dto/admin-runs.dto.js'

// 必须从 obj[key] 读原始 query 值：全局 pipe 开了 enableImplicitConversion，
// value 在进入 @Transform 前已被隐式 Boolean('false') === true 污染。
function toOptionalBoolean(raw: unknown): unknown {
  if (raw === 'true' || raw === true)
    return true
  if (raw === 'false' || raw === false)
    return false
  // 非法值原样返回，交给 @IsBoolean 报 400，而不是静默丢弃筛选条件
  return raw
}

export class ListQaArticlesQueryDto {
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
  @MaxLength(200)
  search?: string

  @IsOptional()
  @Transform(({ obj, key }) => toOptionalBoolean(obj[key]))
  @IsBoolean()
  qaCandidateOnly?: boolean

  @IsOptional()
  @Transform(({ obj, key }) => toOptionalBoolean(obj[key]))
  @IsBoolean()
  publishedOnly?: boolean
}

export class QaGlossaryIdParamDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  glossaryId!: number
}

export class ListQaGlossaryTermsQueryDto {
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
  @MaxLength(200)
  search?: string

  @IsOptional()
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @IsString()
  @Matches(/^[a-z]{2}(?:-[a-z0-9]{2,8})?$/i, { message: 'targetLanguage 必须是合法语言码' })
  targetLanguage?: string
}
