import type { CanActivate, ExecutionContext } from '@nestjs/common'
import type { AuthRequest } from './auth.decorators.js'
import process from 'node:process'
import { PASSWORD_CHANGE_REQUIRED } from '@agent/contracts'
import { ForbiddenException, Inject, Injectable, UnauthorizedException } from '@nestjs/common'
import { PATH_METADATA } from '@nestjs/common/constants.js'
import { Reflector } from '@nestjs/core'

import { getRequestHeader } from '../common/utils/http-request.util.js'
import { ALLOW_PENDING_PASSWORD_CHANGE, PUBLIC_ROUTE } from './auth.decorators.js'
import { AuthService } from './auth.service.js'
import { readSessionToken } from './session-cookie.js'

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])
const DEFAULT_APP_ORIGINS = 'http://localhost:5173,http://localhost:5174'

/**
 * 全局默认拦截：写请求先校验 Origin，再要求登录；`admin/*` Controller 还要求 ADMIN。
 * 公开接口用 `@Public()` 显式标记，新加的接口不标就受保护。
 */
@Injectable()
export class AuthGuard implements CanActivate {
  private readonly allowedOrigins = new Set(
    (process.env.APP_ORIGINS?.trim() || DEFAULT_APP_ORIGINS)
      .split(',')
      .map(origin => origin.trim().replace(/\/+$/, ''))
      .filter(Boolean),
  )

  constructor(
    @Inject(Reflector)
    private readonly reflector: Reflector,
    @Inject(AuthService)
    private readonly authService: AuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthRequest>()

    // SameSite=Lax 之外再挡一层 CSRF：写请求的 Origin 必须是自家前台 / 管理台。
    if (!SAFE_METHODS.has(request.method) && !this.allowedOrigins.has(getRequestHeader(request, 'origin') ?? ''))
      throw new ForbiddenException('请求来源不被允许')

    const targets = [context.getHandler(), context.getClass()]

    if (this.reflector.getAllAndOverride<boolean>(PUBLIC_ROUTE, targets))
      return true

    const token = readSessionToken(request)
    const auth = token ? await this.authService.authenticate(token) : null

    if (!auth)
      throw new UnauthorizedException('请先登录')

    request.auth = auth

    if (auth.user.mustChangePassword && !this.reflector.getAllAndOverride<boolean>(ALLOW_PENDING_PASSWORD_CHANGE, targets))
      throw new ForbiddenException({ message: '请先修改初始密码', error: PASSWORD_CHANGE_REQUIRED })

    if (isAdminController(this.reflector.get<string | string[]>(PATH_METADATA, context.getClass())) && auth.user.role !== 'ADMIN')
      throw new ForbiddenException('需要管理员权限')

    return true
  }
}

function isAdminController(path: string | string[] | undefined): boolean {
  return [path ?? []].flat().some(segment => /^\/?admin(?:\/|$)/.test(segment))
}
