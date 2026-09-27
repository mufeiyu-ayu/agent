export const USER_ROLES = ['ADMIN', 'MEMBER'] as const
export type UserRole = typeof USER_ROLES[number]

/** 密码最短长度；前后端共用同一条规则。 */
export const PASSWORD_MIN_LENGTH = 8
/** 密码最长长度：挡住超长输入拖慢 scrypt。 */
export const PASSWORD_MAX_LENGTH = 128

/** 需要先改初始密码时，403 响应的 `error.error` 取这个值，前端据此跳改密码页。 */
export const PASSWORD_CHANGE_REQUIRED = 'PASSWORD_CHANGE_REQUIRED'

/** 当前登录用户（`GET /api/auth/me`、登录响应）。 */
export interface AuthUser {
  id: string
  email: string
  role: UserRole
  mustChangePassword: boolean
}

export interface LoginRequest {
  email: string
  password: string
}

export interface ChangePasswordRequest {
  currentPassword: string
  newPassword: string
}

/** 管理台用户列表的一行。 */
export interface AdminUser {
  id: string
  email: string
  role: UserRole
  disabled: boolean
  mustChangePassword: boolean
  lastLoginAt: string | null
  createdAt: string
}

export interface CreateAdminUserRequest {
  email: string
  password: string
  role: UserRole
}

export interface UpdateAdminUserRequest {
  disabled?: boolean
  role?: UserRole
}

export interface ResetAdminUserPasswordRequest {
  password: string
}
