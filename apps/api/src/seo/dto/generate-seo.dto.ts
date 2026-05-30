import {
  ArrayMaxSize,
  IsArray,
  IsNotEmpty,
  IsString,
  MaxLength,
} from 'class-validator'

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
}
