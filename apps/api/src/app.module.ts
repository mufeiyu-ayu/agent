import type { MiddlewareConsumer, NestModule } from '@nestjs/common'
import { Module } from '@nestjs/common'

import { AdminConversationsModule } from './admin-conversations/admin-conversations.module.js'
import { AdminRunsModule } from './admin-runs/admin-runs.module.js'
import { AppController } from './app.controller.js'
import { RequestIdMiddleware } from './common/middleware/request-id.middleware.js'
import { ConversationsModule } from './conversations/conversations.module.js'
import { LlmModule } from './llm/llm.module.js'
import { SeoModule } from './seo/seo.module.js'
import { ToolsModule } from './tools/tools.module.js'

@Module({
  imports: [
    AdminConversationsModule,
    AdminRunsModule,
    LlmModule,
    SeoModule,
    ConversationsModule,
    ToolsModule,
  ],
  controllers: [AppController],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware).forRoutes('*')
  }
}
