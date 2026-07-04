import { Module } from '@nestjs/common'

import { PrismaModule } from '../prisma/prisma.module.js'
import { AgentRunRecorderService } from './agent-run-recorder.service.js'

@Module({
  imports: [PrismaModule],
  providers: [AgentRunRecorderService],
  exports: [AgentRunRecorderService],
})
export class AgentRuntimeModule {}
