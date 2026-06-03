import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator'
import { SUPPORTED_DEEPSEEK_MODELS } from '../../llm/llm.types.js'

export class GenerateSeoDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  pageTopic!: string

  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  language!: string

  @IsArray()
  @ArrayMaxSize(8)
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  @MaxLength(50, { each: true })
  keywords!: string[]

  @IsOptional()
  @IsString()
  @IsIn([...SUPPORTED_DEEPSEEK_MODELS])
  model?: string
}
