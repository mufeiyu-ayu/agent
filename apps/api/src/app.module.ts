import type { MiddlewareConsumer, NestModule } from '@nestjs/common'
import { Module } from '@nestjs/common'

import { AdminConversationsModule } from './admin-conversations/admin-conversations.module.js'
import { AdminLlmModule } from './admin-llm/admin-llm.module.js'
import { AdminOverviewModule } from './admin-overview/admin-overview.module.js'
import { AdminRunsModule } from './admin-runs/admin-runs.module.js'
import { AdminUsersModule } from './admin-users/admin-users.module.js'
import { AppController } from './app.controller.js'
import { AttachmentsModule } from './attachments/attachments.module.js'
import { AuthModule } from './auth/auth.module.js'
import { ChatModule } from './chat/chat.module.js'
import { RequestIdMiddleware } from './common/middleware/request-id.middleware.js'
import { ConversationsModule } from './conversations/conversations.module.js'
import { LlmModule } from './llm/llm.module.js'
import { RuntimeConfigModule } from './runtime-config/runtime-config.module.js'
import { ToolsModule } from './tools/tools.module.js'

@Module({
  imports: [
    AdminConversationsModule,
    AdminLlmModule,
    AdminOverviewModule,
    AdminRunsModule,
    AdminUsersModule,
    AttachmentsModule,
    AuthModule,
    LlmModule,
    ChatModule,
    ConversationsModule,
    RuntimeConfigModule,
    ToolsModule,
  ],
  controllers: [AppController],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware).forRoutes('*')
  }
}
