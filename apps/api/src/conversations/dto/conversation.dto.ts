import type {
  CreateConversationRequest,
  ListConversationsRequest,
  UpdateConversationRequest,
} from '@agent/contracts'
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

export class ListConversationsQueryDto implements ListConversationsRequest {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  cursor?: string
}

export class CreateConversationDto implements CreateConversationRequest {
  @IsOptional()
  @IsString()
  @MaxLength(80)
  title?: string
}

export class UpdateConversationDto implements UpdateConversationRequest {
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  title!: string
}

export class ConversationIdParamDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  conversationId!: string
}
