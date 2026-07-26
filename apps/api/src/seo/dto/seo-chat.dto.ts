import type { SeoChatRequest } from '@agent/contracts'
import { SEO_CHAT_MESSAGE_MAX_CHARS } from '@agent/contracts'
import {
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator'

import { SUPPORTED_DEEPSEEK_MODELS } from '../../llm/llm.types.js'

export class SeoChatDto implements SeoChatRequest {
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  conversationId!: string

  @IsString()
  @IsNotEmpty()
  @MaxLength(SEO_CHAT_MESSAGE_MAX_CHARS)
  message!: string

  @IsOptional()
  @IsString()
  @IsIn([...SUPPORTED_DEEPSEEK_MODELS])
  model?: string
}
