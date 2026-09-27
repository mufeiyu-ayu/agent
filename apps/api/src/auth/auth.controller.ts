import type { AuthUser } from '@agent/contracts'
import type { AuthContext, AuthRequest } from './auth.decorators.js'
import { Body, Controller, Get, HttpCode, HttpStatus, Inject, Post, Req, Res } from '@nestjs/common'

import { AllowPendingPasswordChange, CurrentAuth, Public } from './auth.decorators.js'
import { AuthService } from './auth.service.js'
// DTO classes are required at runtime for Nest decorator metadata.
// eslint-disable-next-line ts/consistent-type-imports
import { ChangePasswordDto, LoginDto } from './dto/auth.dto.js'
import { serializeClearedSessionCookie, serializeSessionCookie } from './session-cookie.js'

interface CookieResponse {
  setHeader: (name: string, value: string) => void
}

@Controller('auth')
export class AuthController {
  constructor(
    @Inject(AuthService)
    private readonly authService: AuthService,
  ) {}

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() body: LoginDto,
    @Req() request: AuthRequest,
    @Res({ passthrough: true }) response: CookieResponse,
  ): Promise<AuthUser> {
    const { user, token } = await this.authService.login(body, request.ip ?? 'unknown')

    response.setHeader('Set-Cookie', serializeSessionCookie(token, request.secure === true))
    return user
  }

  @AllowPendingPasswordChange()
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(
    @CurrentAuth() auth: AuthContext,
    @Req() request: AuthRequest,
    @Res({ passthrough: true }) response: CookieResponse,
  ): Promise<{ ok: true }> {
    await this.authService.logout(auth.sessionId)
    response.setHeader('Set-Cookie', serializeClearedSessionCookie(request.secure === true))
    return { ok: true }
  }

  @AllowPendingPasswordChange()
  @Get('me')
  me(@CurrentAuth() auth: AuthContext): AuthUser {
    return auth.user
  }

  @AllowPendingPasswordChange()
  @Post('change-password')
  @HttpCode(HttpStatus.OK)
  changePassword(
    @CurrentAuth() auth: AuthContext,
    @Body() body: ChangePasswordDto,
  ): Promise<AuthUser> {
    return this.authService.changePassword(auth, body)
  }
}
