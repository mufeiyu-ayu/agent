export const USER_ROLES = ['ADMIN', 'MEMBER'] as const
export type UserRole = typeof USER_ROLES[number]

/** 账号状态三态互斥：陌生 Google 账号登录后为待审核，管理员通过 → 启用，拒绝 → 停用。 */
export const USER_STATUSES = ['ACTIVE', 'PENDING', 'DISABLED'] as const
export type UserStatus = typeof USER_STATUSES[number]

/** 密码最短长度；前后端共用同一条规则。 */
export const PASSWORD_MIN_LENGTH = 8
/** 密码最长长度：挡住超长输入拖慢 scrypt。 */
export const PASSWORD_MAX_LENGTH = 128

/** 需要先改初始密码时，403 响应的 `error.error` 取这个值，前端据此跳改密码页。 */
export const PASSWORD_CHANGE_REQUIRED = 'PASSWORD_CHANGE_REQUIRED'

/** 展示用户的固定字段：昵称与头像来自 Google，密码账号两者为空。 */
export interface UserProfile {
  email: string
  name: string | null
  avatarUrl: string | null
}

/** 显示名：有昵称用昵称，没有用邮箱 `@` 前的部分。前台与管理台共用这一条规则。 */
export function userDisplayName(user: UserProfile): string {
  return user.name?.trim() || user.email.split('@')[0] || user.email
}

/** 头像占位：显示名首字母大写。 */
export function userInitial(user: UserProfile): string {
  return Array.from(userDisplayName(user))[0]?.toUpperCase() ?? '?'
}

/** 当前登录用户（`GET /api/auth/me`、登录响应）。 */
export interface AuthUser extends UserProfile {
  id: string
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

/**
 * 登录方式的公开配置（`GET /api/auth/config`）：未配置 Google 客户端时 `googleClientId` 为 null，
 * 前端据此不显示 Google 按钮、不加载 GIS。客户端 ID 不是秘密，One Tap 初始化要用。
 */
export interface AuthConfig {
  googleClientId: string | null
}

/** One Tap 的一次性 nonce（`POST /api/auth/google/one-tap/nonce`），传给 GIS 初始化。 */
export interface GoogleOneTapNonce {
  nonce: string
}

export interface GoogleOneTapRequest {
  credential: string
}

/**
 * One Tap 的结果：成功返回当前用户；陌生或待审核账号返回 pending、待审核名额已满返回 busy，都不建 Session。
 * 失败走 401，请求太频繁走 429。
 */
export type GoogleOneTapResult
  = | { status: 'ok', user: AuthUser }
    | { status: 'pending' | 'busy' }

/**
 * Google 登录没能直接进站的结果：重定向登录的回调把用户送回登录页并带上 `?google=<值>`。
 * busy 是待审核名额已满，throttled 是同一 IP 请求太频繁。
 */
export const GOOGLE_LOGIN_RESULTS = ['pending', 'failed', 'busy', 'throttled'] as const
export type GoogleLoginResult = typeof GOOGLE_LOGIN_RESULTS[number]

/** 管理台用户列表的一行。 */
export interface AdminUser extends UserProfile {
  id: string
  role: UserRole
  status: UserStatus
  mustChangePassword: boolean
  lastLoginAt: string | null
  createdAt: string
}

export interface CreateAdminUserRequest {
  email: string
  password: string
  role: UserRole
}

/** 通过待审核 = `status: 'ACTIVE'`，拒绝 = `status: 'DISABLED'`；不能改回待审核。 */
export interface UpdateAdminUserRequest {
  status?: Exclude<UserStatus, 'PENDING'>
  role?: UserRole
}

export interface ResetAdminUserPasswordRequest {
  password: string
}
