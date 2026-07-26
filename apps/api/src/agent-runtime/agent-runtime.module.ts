import { Module } from '@nestjs/common'

import { PrismaModule } from '../prisma/prisma.module.js'
import { ToolsModule } from '../tools/tools.module.js'
import { AgentRunRecorderService } from './agent-run-recorder.service.js'
import { AgentRuntimePolicyService } from './agent-runtime.policy.js'
import { AgentRuntimeService } from './agent-runtime.service.js'

@Module({
  imports: [PrismaModule, ToolsModule],
  providers: [
    AgentRuntimePolicyService,
    AgentRunRecorderService,
    AgentRuntimeService,
  ],
  exports: [AgentRunRecorderService, AgentRuntimeService],
})
export class AgentRuntimeModule {}
