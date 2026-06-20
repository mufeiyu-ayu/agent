import {
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator'

import { SUPPORTED_DEEPSEEK_MODELS } from '../../llm/llm.types.js'

export class SeoChatDto {
  @IsString()
  @MaxLength(2000)
  message!: string

  @IsOptional()
  @IsString()
  @IsIn([...SUPPORTED_DEEPSEEK_MODELS])
  model?: string
}
