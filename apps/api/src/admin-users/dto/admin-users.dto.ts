import type {
  CreateAdminUserRequest,
  ResetAdminUserPasswordRequest,
  UpdateAdminUserRequest,
  UserRole,
} from '@agent/contracts'
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, USER_ROLES } from '@agent/contracts'
import { Transform } from 'class-transformer'
import { IsBoolean, IsEmail, IsIn, IsNotEmpty, IsOptional, IsString, MaxLength, MinLength } from 'class-validator'

import { normalizeEmail } from '../../auth/dto/auth.dto.js'

export class CreateAdminUserDto implements CreateAdminUserRequest {
  @Transform(normalizeEmail)
  @IsEmail()
  @MaxLength(254)
  email!: string

  @IsString()
  @MinLength(PASSWORD_MIN_LENGTH)
  @MaxLength(PASSWORD_MAX_LENGTH)
  password!: string

  @IsIn([...USER_ROLES])
  role!: UserRole
}

export class UpdateAdminUserDto implements UpdateAdminUserRequest {
  @IsOptional()
  @IsBoolean()
  disabled?: boolean

  @IsOptional()
  @IsIn([...USER_ROLES])
  role?: UserRole
}

export class ResetAdminUserPasswordDto implements ResetAdminUserPasswordRequest {
  @IsString()
  @MinLength(PASSWORD_MIN_LENGTH)
  @MaxLength(PASSWORD_MAX_LENGTH)
  password!: string
}

export class AdminUserIdParamDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  userId!: string
}
