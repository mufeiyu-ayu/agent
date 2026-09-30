import { Module } from '@nestjs/common'

import { PrismaModule } from '../prisma/prisma.module.js'
import { ToolsModule } from '../tools/tools.module.js'
import { AgentRuntimeService } from './agent-runtime.service.js'
import { SamplingContextPlanner } from './context/sampling-context-planner.js'
import { RoughTokenEstimator } from './context/token-estimate.js'
import { AgentRunRecorderService } from './lifecycle/agent-run-recorder.service.js'

@Module({
  imports: [PrismaModule, ToolsModule],
  providers: [
    RoughTokenEstimator,
    SamplingContextPlanner,
    AgentRunRecorderService,
    AgentRuntimeService,
  ],
  exports: [AgentRuntimeService],
})
export class AgentRuntimeModule {}
