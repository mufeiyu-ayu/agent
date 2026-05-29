import type { MiddlewareConsumer, NestModule } from '@nestjs/common'
import { Module } from '@nestjs/common'

import { AppController } from './app.controller.js'
import { RequestIdMiddleware } from './common/middleware/request-id.middleware.js'

@Module({
  controllers: [AppController],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware).forRoutes('*')
  }
}
