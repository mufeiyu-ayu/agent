import { Module } from '@nestjs/common'

import { PrismaModule } from '../prisma/prisma.module.js'
import { ToolsModule } from '../tools/tools.module.js'
import { AgentRuntimeService } from './agent-runtime.service.js'
import { ContextCompactionService } from './context/context-compaction.service.js'
import { AgentRunRecorderService } from './lifecycle/agent-run-recorder.service.js'

@Module({
  imports: [PrismaModule, ToolsModule],
  providers: [
    ContextCompactionService,
    AgentRunRecorderService,
    AgentRuntimeService,
  ],
  exports: [AgentRuntimeService],
})
export class AgentRuntimeModule {}
