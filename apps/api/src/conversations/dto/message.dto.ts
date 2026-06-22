import type { CreateConversationMessageRequest } from '@agent/contracts'
import { Transform } from 'class-transformer'
import {
  IsNotEmpty,
  IsString,
  MaxLength,
} from 'class-validator'

export class CreateMessageDto implements CreateConversationMessageRequest {
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @IsString()
  @IsNotEmpty()
  @MaxLength(12000)
  content!: string
}
