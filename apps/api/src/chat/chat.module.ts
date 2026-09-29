import { Module } from '@nestjs/common'

import { AgentRuntimeModule } from '../agent-runtime/agent-runtime.module.js'
import { ConversationsModule } from '../conversations/conversations.module.js'
import { RuntimeConfigModule } from '../runtime-config/runtime-config.module.js'
import { ChatController } from './chat.controller.js'
import { ChatService } from './chat.service.js'

@Module({
  imports: [AgentRuntimeModule, ConversationsModule, RuntimeConfigModule],
  controllers: [ChatController],
  providers: [ChatService],
})
export class ChatModule {}
