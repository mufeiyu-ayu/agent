import { Transform } from 'class-transformer'
import {
  IsNotEmpty,
  IsString,
  MaxLength,
} from 'class-validator'

export class CreateMessageDto {
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @IsString()
  @IsNotEmpty()
  @MaxLength(12000)
  content!: string
}
