import type { AuthUser } from '@agent/contracts'
import type { ExecutionContext } from '@nestjs/common'
import type { HttpRequestLike } from '../common/utils/http-request.util.js'
import { createParamDecorator, SetMetadata } from '@nestjs/common'

export interface AuthContext {
  user: AuthUser
  sessionId: string
}

export type AuthRequest = HttpRequestLike & {
  method: string
  ip?: string
  secure?: boolean
  auth?: AuthContext
}

export const PUBLIC_ROUTE = 'auth:public'
export const ALLOW_PENDING_PASSWORD_CHANGE = 'auth:allow-pending-password-change'

/** 不需要登录的接口。全局 AuthGuard 默认拦截一切，只有显式标了它的才放行。 */
export const Public = () => SetMetadata(PUBLIC_ROUTE, true)

/** 必须先改初始密码时仍可访问的接口（me、change-password、logout）。 */
export const AllowPendingPasswordChange = () => SetMetadata(ALLOW_PENDING_PASSWORD_CHANGE, true)

/** 取 AuthGuard 挂在请求上的当前用户与 Session；只用在受保护接口上。 */
export const CurrentAuth = createParamDecorator(
  (_data: unknown, context: ExecutionContext) => context.switchToHttp().getRequest<AuthRequest>().auth,
)
