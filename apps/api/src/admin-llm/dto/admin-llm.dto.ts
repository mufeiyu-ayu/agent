import type {
  AdminLlmImportModelsRequest,
  AdminLlmModelInput,
  AdminLlmModelTestResult,
  AdminLlmPreviewModelsRequest,
  AdminLlmProbeModelsRequest,
  AdminLlmProviderInput,
  AdminLlmTestModelsRequest,
  LlmProviderFamily,
  ReasoningEffort,
} from '@agent/contracts'
import { LLM_PROVIDER_FAMILIES, REASONING_EFFORTS } from '@agent/contracts'
import { Transform, Type } from 'class-transformer'
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator'

const trim = Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
/** 与前台一致：baseUrl 必须是 http(s) 且填到 `/v1` 之类的前缀，客户端在后面拼 `/chat/completions`。 */
const BASE_URL_PATTERN = /^https?:\/\/\S+$/u
/** Int 列上限；contextWindow 1M / maxOutput 384k 都远在其下。 */
const TOKENS_MAX = 2_147_483_647

export class AdminLlmIdParamDto {
  @trim
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  id!: string
}

/** 弹窗里 test-models 回来的单条结果，导入时原样带回来写进行。 */
export class AdminLlmModelTestResultDto implements AdminLlmModelTestResult {
  @trim
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  wireName!: string

  @IsBoolean()
  ok!: boolean

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  error!: string | null
}

export class CreateAdminLlmProviderDto implements AdminLlmProviderInput {
  @IsIn([...LLM_PROVIDER_FAMILIES])
  family!: LlmProviderFamily

  @trim
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  note!: string

  @trim
  @IsString()
  @Matches(BASE_URL_PATTERN, { message: 'baseUrl 须以 http:// 或 https:// 开头' })
  @MaxLength(512)
  baseUrl!: string

  @trim
  @IsString()
  @IsNotEmpty()
  @MaxLength(512)
  apiKey!: string

  @IsBoolean()
  enabled!: boolean

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  @MaxLength(200, { each: true })
  importWireNames?: string[]

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => AdminLlmModelTestResultDto)
  importTestResults?: AdminLlmModelTestResultDto[]
}

export class PreviewAdminLlmModelsDto implements AdminLlmPreviewModelsRequest {
  @trim
  @IsString()
  @Matches(BASE_URL_PATTERN, { message: 'baseUrl 须以 http:// 或 https:// 开头' })
  @MaxLength(512)
  baseUrl!: string

  @trim
  @IsString()
  @IsNotEmpty()
  @MaxLength(512)
  apiKey!: string
}

export class UpdateAdminLlmProviderDto implements Partial<AdminLlmProviderInput> {
  @IsOptional()
  @IsIn([...LLM_PROVIDER_FAMILIES])
  family?: LlmProviderFamily

  @IsOptional()
  @trim
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  note?: string

  @IsOptional()
  @trim
  @IsString()
  @Matches(BASE_URL_PATTERN, { message: 'baseUrl 须以 http:// 或 https:// 开头' })
  @MaxLength(512)
  baseUrl?: string

  /** 省略或空串表示不改密钥。 */
  @IsOptional()
  @trim
  @IsString()
  @MaxLength(512)
  apiKey?: string

  @IsOptional()
  @IsBoolean()
  enabled?: boolean
}

export class UpdateAdminLlmModelDto implements Partial<AdminLlmModelInput> {
  @IsOptional()
  @trim
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  wireName?: string

  @IsOptional()
  @trim
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  displayName?: string

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(TOKENS_MAX)
  contextWindowTokens?: number

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(TOKENS_MAX)
  maxOutputTokens?: number

  /** null 表示清空（不发）；是否属于该模型家族在 service 里查。 */
  @IsOptional()
  @IsIn([...REASONING_EFFORTS])
  reasoningEffort?: ReasoningEffort | null

  @IsOptional()
  @IsBoolean()
  visible?: boolean

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean

  @IsOptional()
  @IsInt()
  @Min(-TOKENS_MAX)
  @Max(TOKENS_MAX)
  sortOrder?: number
}

export class TestAdminLlmModelsDto extends PreviewAdminLlmModelsDto implements AdminLlmTestModelsRequest {
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  @MaxLength(200, { each: true })
  wireNames!: string[]
}

export class ProbeAdminLlmModelsDto implements AdminLlmProbeModelsRequest {
  @IsArray()
  @ArrayMaxSize(200)
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  @MaxLength(128, { each: true })
  modelIds!: string[]
}

export class ImportAdminLlmModelsDto implements AdminLlmImportModelsRequest {
  @IsArray()
  @ArrayMaxSize(500)
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  @MaxLength(200, { each: true })
  wireNames!: string[]

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => AdminLlmModelTestResultDto)
  testResults?: AdminLlmModelTestResultDto[]
}

/** 编辑服务商时的拉取 / 测试：密钥用库里的，地址可用表单里还没保存的那个。 */
export class ProviderBaseUrlOverrideDto {
  @IsOptional()
  @trim
  @IsString()
  @Matches(BASE_URL_PATTERN, { message: 'baseUrl 须以 http:// 或 https:// 开头' })
  @MaxLength(512)
  baseUrl?: string
}

export class TestProviderModelsDto extends ProviderBaseUrlOverrideDto {
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  @MaxLength(200, { each: true })
  wireNames!: string[]
}
