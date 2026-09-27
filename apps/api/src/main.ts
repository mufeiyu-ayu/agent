/* eslint-disable perfectionist/sort-imports */
import process from 'node:process'
import 'reflect-metadata'

import { NestFactory } from '@nestjs/core'
import { AppModule } from './app.module.js'

import { registerAppGlobals } from './common/bootstrap/register-app-globals.js'

async function bootstrap() {
  const app = await NestFactory.create(AppModule)
  const port = process.env.PORT ?? 3000

  // 线上在 Caddy 后面：信任反代给的 X-Forwarded-For / Proto，req.ip 才是真实客户端、req.secure 才为真。
  if (process.env.TRUST_PROXY)
    app.getHttpAdapter().getInstance().set('trust proxy', process.env.TRUST_PROXY)

  registerAppGlobals(app)
  // 本地开发：前台与管理台经各自 Vite 代理同源转发 /api，不需要 CORS，API 只对本机开放。
  // 容器里设 API_HOST=0.0.0.0，只在 Docker 网络内被 Caddy 访问。
  await app.listen(port, process.env.API_HOST || '127.0.0.1')
}

void bootstrap()
