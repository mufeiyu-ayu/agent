import { Module } from '@nestjs/common'

import { PrismaModule } from '../prisma/prisma.module.js'
import { ToolsModule } from '../tools/tools.module.js'
import { AgentRunRecorderService } from './agent-run-recorder.service.js'
import { AgentRuntimePolicyService } from './agent-runtime.policy.js'
import { AgentRuntimeService } from './agent-runtime.service.js'
import {
  DeepSeekV4TokenEstimator,
  TokenEstimator,
} from './deepseek-v4-token-estimator.js'
import { InitialContextSelectionService } from './initial-context-selection.js'
import { SamplingContextPlanner } from './sampling-context-planner.js'

@Module({
  imports: [PrismaModule, ToolsModule],
  providers: [
    AgentRuntimePolicyService,
    DeepSeekV4TokenEstimator,
    {
      provide: TokenEstimator,
      useExisting: DeepSeekV4TokenEstimator,
    },
    InitialContextSelectionService,
    SamplingContextPlanner,
    AgentRunRecorderService,
    AgentRuntimeService,
  ],
  exports: [AgentRunRecorderService, AgentRuntimeService],
})
export class AgentRuntimeModule {}
