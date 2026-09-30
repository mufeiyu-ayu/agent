import type { AdminRuntimeConfigInput } from '@agent/contracts'
import { RUNTIME_CONFIG_LIMITS } from '@agent/contracts'
import { Transform } from 'class-transformer'
import { IsBoolean, IsInt, IsOptional, IsString, Max, MaxLength, Min, ValidateIf } from 'class-validator'

/**
 * 数值与开关按请求里的原值校验：全局管道开了隐式转换，`"false"` 会变成 true、`""` 会变成 0，
 * 这里取回原值交给 IsInt / IsBoolean 拒掉。只有省略才算不改，`null` 同样 400（列都是 NOT NULL）。
 */
const raw = Transform(({ obj, key }) => (obj as Record<string, unknown>)[key])
const unlessOmitted = ValidateIf((_object, value) => value !== undefined)
const rawTrimmed = Transform(({ obj, key }) => {
  const value = (obj as Record<string, unknown>)[key]

  return typeof value === 'string' ? value.trim() : value
})
const { runDeadlineMs } = RUNTIME_CONFIG_LIMITS

export class UpdateRuntimeConfigDto implements Partial<AdminRuntimeConfigInput> {
  @unlessOmitted
  @raw
  @IsInt()
  @Min(runDeadlineMs.min)
  @Max(runDeadlineMs.max)
  runDeadlineMs?: number

  @unlessOmitted
  @raw
  @IsBoolean()
  debugCaptureModelIo?: boolean

  /** 省略或空串表示不改密钥；按原值校验，`true` / 数字不会被隐式转换成字符串存进去。 */
  @IsOptional()
  @rawTrimmed
  @IsString()
  @MaxLength(512)
  serperApiKey?: string
}
