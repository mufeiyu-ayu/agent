import type { ChangePasswordRequest, LoginRequest } from '@agent/contracts'
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '@agent/contracts'
import { Transform } from 'class-transformer'
import { IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator'

/** 邮箱统一去空白、转小写后再比对与入库。 */
export function normalizeEmail({ value }: { value: unknown }): unknown {
  return typeof value === 'string' ? value.trim().toLowerCase() : value
}

export class LoginDto implements LoginRequest {
  // 登录不校验邮箱格式：格式不对与账号不存在都该是同一个「邮箱或密码错误」。
  @Transform(normalizeEmail)
  @IsString()
  @IsNotEmpty()
  @MaxLength(254)
  email!: string

  @IsString()
  @IsNotEmpty()
  @MaxLength(PASSWORD_MAX_LENGTH)
  password!: string
}

export class ChangePasswordDto implements ChangePasswordRequest {
  @IsString()
  @IsNotEmpty()
  @MaxLength(PASSWORD_MAX_LENGTH)
  currentPassword!: string

  @IsString()
  @MinLength(PASSWORD_MIN_LENGTH)
  @MaxLength(PASSWORD_MAX_LENGTH)
  newPassword!: string
}
