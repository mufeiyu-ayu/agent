import { Module } from '@nestjs/common'
import { APP_GUARD } from '@nestjs/core'

import { PrismaModule } from '../prisma/prisma.module.js'
import { AuthController } from './auth.controller.js'
import { AuthGuard } from './auth.guard.js'
import { AuthService } from './auth.service.js'
import { GoogleAuthController } from './google-auth.controller.js'
import { GoogleAuthService } from './google-auth.service.js'

@Module({
  imports: [PrismaModule],
  controllers: [AuthController, GoogleAuthController],
  providers: [
    AuthService,
    GoogleAuthService,
    // 全局 Guard：所有 /api 默认要求登录，公开接口用 @Public() 显式标记。
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
})
export class AuthModule {}
