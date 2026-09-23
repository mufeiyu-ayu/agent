/* eslint-disable perfectionist/sort-imports */
import process from 'node:process'
import 'reflect-metadata'

import { NestFactory } from '@nestjs/core'
import { AppModule } from './app.module.js'

import { registerAppGlobals } from './common/bootstrap/register-app-globals.js'

async function bootstrap() {
  const app = await NestFactory.create(AppModule)
  const port = process.env.PORT ?? 3000

  registerAppGlobals(app)
  // 前台与管理台都经各自 Vite 代理同源转发 /api，不需要 CORS；局域网访问走 `vite --host`，API 只对本机开放。
  await app.listen(port, '127.0.0.1')
}

void bootstrap()
