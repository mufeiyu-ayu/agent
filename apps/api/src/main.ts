import process from 'node:process'

import { NestFactory } from '@nestjs/core'
import { AppModule } from './app.module.js'

import { registerAppGlobals } from './common/bootstrap/register-app-globals.js'
import 'reflect-metadata'

async function bootstrap() {
  const app = await NestFactory.create(AppModule)
  const port = process.env.PORT ?? 3000

  registerAppGlobals(app)
  app.enableCors()
  await app.listen(port)
}

void bootstrap()
