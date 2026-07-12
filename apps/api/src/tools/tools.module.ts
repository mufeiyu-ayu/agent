import { Module } from '@nestjs/common'

import { ToolInvocationService } from './tool-invocation.service.js'
import { ToolRegistryService } from './tool-registry.service.js'

@Module({
  providers: [ToolRegistryService, ToolInvocationService],
  exports: [ToolRegistryService, ToolInvocationService],
})
export class ToolsModule {}
