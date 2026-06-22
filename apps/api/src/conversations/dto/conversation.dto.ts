import type { CreateConversationRequest } from '@agent/contracts'
import {
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator'

export class CreateConversationDto implements CreateConversationRequest {
  @IsOptional()
  @IsString()
  @MaxLength(80)
  title?: string
}

export class ConversationIdParamDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  conversationId!: string
}
