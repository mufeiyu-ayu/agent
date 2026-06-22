import type { MiddlewareConsumer, NestModule } from '@nestjs/common'
import { Module } from '@nestjs/common'

import { AppController } from './app.controller.js'
import { RequestIdMiddleware } from './common/middleware/request-id.middleware.js'
import { ConversationsModule } from './conversations/conversations.module.js'
import { LlmModule } from './llm/llm.module.js'
import { SeoModule } from './seo/seo.module.js'

@Module({
  imports: [LlmModule, SeoModule, ConversationsModule],
  controllers: [AppController],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware).forRoutes('*')
  }
}
