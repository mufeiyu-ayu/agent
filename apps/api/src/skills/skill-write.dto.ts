import { IsArray, IsString, MaxLength } from 'class-validator'

export class CreateSkillDraftDto {
  // 保留原始文件对象，避免隐式类型转换把数组元素转成数组；内容由技能包校验器检查。
  @IsArray()
  files!: unknown
}
export class SaveSkillDraftDto extends CreateSkillDraftDto {
  @IsString() @MaxLength(128)
  expectedFingerprint!: string
}
