import { Module } from '@nestjs/common'
import { AttachmentsModule } from '../attachments/attachments.module.js'
import { PrismaModule } from '../prisma/prisma.module.js'

import { ToolsModule } from '../tools/tools.module.js'
import { WorkspacesModule } from '../workspaces/workspaces.module.js'
import { AgentRuntimeService } from './agent-runtime.service.js'
import { ContextCompactionService } from './context/context-compaction.service.js'
import { AgentRunRecorderService } from './lifecycle/agent-run-recorder.service.js'

@Module({
  imports: [PrismaModule, ToolsModule, WorkspacesModule, AttachmentsModule],
  providers: [
    ContextCompactionService,
    AgentRunRecorderService,
    AgentRuntimeService,
  ],
  exports: [AgentRuntimeService],
})
export class AgentRuntimeModule {}
