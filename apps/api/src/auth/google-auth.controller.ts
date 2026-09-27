import type { AuthConfig, GoogleOneTapNonce, GoogleOneTapResult } from '@agent/contracts'
import type { AuthRequest } from './auth.decorators.js'
import { Body, Controller, Get, HttpCode, HttpStatus, Inject, Post, Query, Req, Res, UnauthorizedException } from '@nestjs/common'

import { getRequestHeader } from '../common/utils/http-request.util.js'
import { Public } from './auth.decorators.js'
// DTO classes are required at runtime for Nest decorator metadata.
// eslint-disable-next-line ts/consistent-type-imports
import { GoogleOneTapDto } from './dto/auth.dto.js'
import { GOOGLE_LOGIN_FAILED_MESSAGE, GoogleAuthService } from './google-auth.service.js'
import { GOOGLE_FLOW_COOKIE, readCookie, serializeFlowCookie, serializeSessionCookie } from './session-cookie.js'

interface RedirectResponse {
  setHeader: (name: string, value: string | string[]) => void
  redirect: (status: number, url: string) => void
}

/** Google 登录（Issue #198）。未配置客户端时除 `config` 外都 404。 */
@Controller('auth')
export class GoogleAuthController {
  constructor(
    @Inject(GoogleAuthService)
    private readonly googleAuthService: GoogleAuthService,
  ) {}

  @Public()
  @Get('config')
  config(): AuthConfig {
    return { googleClientId: this.googleAuthService.publicClientId }
  }

  @Public()
  @Get('google/start')
  start(
    @Query('redirect') redirect: unknown,
    @Req() request: AuthRequest,
    @Res() response: RedirectResponse,
  ): void {
    const { url, flowCookie } = this.googleAuthService.start(redirect, getRequestHeader(request, 'referer'))

    response.setHeader('Set-Cookie', serializeFlowCookie(flowCookie, request.secure === true))
    response.redirect(HttpStatus.FOUND, url)
  }

  @Public()
  @Get('google/callback')
  async callback(
    @Query('code') code: unknown,
    @Query('state') state: unknown,
    @Req() request: AuthRequest,
    @Res() response: RedirectResponse,
  ): Promise<void> {
    const secure = request.secure === true
    const { location, token } = await this.googleAuthService.callback(
      { code, state },
      readCookie(request, GOOGLE_FLOW_COOKIE),
      request.ip ?? 'unknown',
    )

    // 流程 Cookie 只用一次：无论成败都清掉，同一个 state 不能再回调第二次。
    response.setHeader('Set-Cookie', [
      serializeFlowCookie('', secure),
      ...(token ? [serializeSessionCookie(token, secure)] : []),
    ])
    response.redirect(HttpStatus.FOUND, location)
  }

  @Public()
  @Post('google/one-tap/nonce')
  @HttpCode(HttpStatus.OK)
  oneTapNonce(@Req() request: AuthRequest): GoogleOneTapNonce {
    return { nonce: this.googleAuthService.issueOneTapNonce(request.ip ?? 'unknown') }
  }

  @Public()
  @Post('google/one-tap')
  @HttpCode(HttpStatus.OK)
  async oneTap(
    @Body() body: GoogleOneTapDto,
    @Req() request: AuthRequest,
    @Res({ passthrough: true }) response: RedirectResponse,
  ): Promise<GoogleOneTapResult> {
    const outcome = await this.googleAuthService.oneTap(body.credential, request.ip ?? 'unknown')

    // 待审核与名额已满照常 200 返回，前端据此提示；429 只表示请求太频繁（由限流直接抛出）。
    if (outcome.status === 'pending' || outcome.status === 'busy')
      return { status: outcome.status }

    if (outcome.status !== 'ok')
      throw new UnauthorizedException(GOOGLE_LOGIN_FAILED_MESSAGE)

    response.setHeader('Set-Cookie', serializeSessionCookie(outcome.token, request.secure === true))
    return { status: 'ok', user: outcome.user }
  }
}
