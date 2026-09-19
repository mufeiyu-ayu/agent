import { Module } from '@nestjs/common'

import { AgentRuntimeModule } from '../agent-runtime/agent-runtime.module.js'
import { ChatController } from './chat.controller.js'
import { ChatService } from './chat.service.js'

@Module({
  imports: [AgentRuntimeModule],
  controllers: [ChatController],
  providers: [ChatService],
})
export class ChatModule {}
