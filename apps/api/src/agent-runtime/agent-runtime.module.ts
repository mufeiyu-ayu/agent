import { Module } from '@nestjs/common'

import { PrismaModule } from '../prisma/prisma.module.js'
import { ToolsModule } from '../tools/tools.module.js'
import { AgentRuntimeService } from './agent-runtime.service.js'
import { AgentRuntimePolicyService } from './configuration/agent-runtime.policy.js'
import { DeepSeekV4TokenEstimator } from './context/deepseek-v4-token-estimator.js'
import { InitialContextSelectionService } from './context/initial-context-selection.js'
import { SamplingContextPlanner } from './context/sampling-context-planner.js'
import { AgentRunRecorderService } from './lifecycle/agent-run-recorder.service.js'

@Module({
  imports: [PrismaModule, ToolsModule],
  providers: [
    AgentRuntimePolicyService,
    DeepSeekV4TokenEstimator,
    InitialContextSelectionService,
    SamplingContextPlanner,
    AgentRunRecorderService,
    AgentRuntimeService,
  ],
  exports: [AgentRunRecorderService, AgentRuntimeService],
})
export class AgentRuntimeModule {}
