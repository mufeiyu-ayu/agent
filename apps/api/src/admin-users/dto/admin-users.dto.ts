import type {
  CreateAdminUserRequest,
  ResetAdminUserPasswordRequest,
  UpdateAdminUserRequest,
  UserRole,
  UserStatus,
} from '@agent/contracts'
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, USER_ROLES } from '@agent/contracts'
import { Transform } from 'class-transformer'
import { IsEmail, IsIn, IsNotEmpty, IsOptional, IsString, MaxLength, MinLength } from 'class-validator'

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
  // 只能启用或停用；待审核只由 Google 首登产生，不能改回去。
  @IsOptional()
  @IsIn(['ACTIVE', 'DISABLED'])
  status?: Exclude<UserStatus, 'PENDING'>

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
