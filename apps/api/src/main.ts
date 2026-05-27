import process from 'node:process'
import { NestFactory } from '@nestjs/core'

import { AppModule } from './app.module.js'

import 'reflect-metadata'

async function bootstrap() {
  const app = await NestFactory.create(AppModule)
  const port = process.env.PORT ?? 3000

  app.enableCors()
  await app.listen(port)
}

void bootstrap()
