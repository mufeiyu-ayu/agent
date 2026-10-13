import { Module } from '@nestjs/common'
import { PrismaModule } from '../prisma/prisma.module.js'
import { AdminMcpController, McpController } from './mcp.controller.js'
import { McpService } from './mcp.service.js'

@Module({
  imports: [PrismaModule],
  controllers: [McpController, AdminMcpController],
  providers: [McpService],
  exports: [McpService],
})
export class McpModule {}
