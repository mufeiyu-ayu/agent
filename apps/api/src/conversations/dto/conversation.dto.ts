import {
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator'

export class CreateConversationDto {
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
