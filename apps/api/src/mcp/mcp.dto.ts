import type { McpAuthType, McpPluginInput } from '@agent/contracts'
import { MCP_AUTH_TYPES } from '@agent/contracts'
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator'

export class McpPluginDto implements McpPluginInput {
  @IsString() @MaxLength(80) name!: string
  @IsString() @MaxLength(1000) description!: string
  @IsString() @MaxLength(2048) url!: string
  @IsIn(MCP_AUTH_TYPES) authType!: McpAuthType
  @IsOptional() @IsString() @MaxLength(90_000) icon?: string | null
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  @MaxLength(64, { each: true })
  headerNames!: string[]

  @IsOptional() @IsString() @MaxLength(1000) oauthClientId?: string
  @IsOptional() @IsString() @MaxLength(4000) oauthClientSecret?: string
  @IsOptional() @IsString() @MaxLength(2000) oauthScopes?: string
  @IsOptional() @IsObject() headers?: Record<string, string>
}

export class McpConnectDto {
  @IsString() @Matches(/^[a-f0-9]{64}$/) configRevision!: string
  @IsOptional() @IsObject() headers?: Record<string, string>
}

export class McpEnabledDto {
  @IsBoolean() enabled!: boolean
}
