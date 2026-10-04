import type { AuthContext } from '../auth/auth.decorators.js'
import { Controller, Get, HttpCode, Inject, Param, Post, Query } from '@nestjs/common'
import { Type } from 'class-transformer'
import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator'
import { CurrentAuth } from '../auth/auth.decorators.js'
import { topuplistTraffic } from '../tools/workspace/topuplist-traffic.tool.js'
import { WorkspaceMonitoringService } from './workspace-monitoring.service.js'
import { WorkspaceService } from './workspace.service.js'

class WorkspaceFileQuery {
  @IsString() @MaxLength(500)
  path!: string

  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(2_147_483_647)
  revision?: number
}

@Controller('conversations/:conversationId/workspace')
export class WorkspaceController {
  constructor(@Inject(WorkspaceService) private readonly workspaces: WorkspaceService) {}

  @Get()
  snapshot(@CurrentAuth() auth: AuthContext, @Param('conversationId') conversationId: string) {
    return this.workspaces.snapshot(auth.user.id, conversationId)
  }

  @Get('file')
  async file(@CurrentAuth() auth: AuthContext, @Param('conversationId') conversationId: string, @Query() query: WorkspaceFileQuery) {
    const content = await this.workspaces.savedFile(auth.user.id, conversationId, query.path, query.revision)
    return { path: query.path, encoding: 'base64', content: content.toString('base64') }
  }

  @Get('traffic')
  async traffic(@CurrentAuth() auth: AuthContext, @Param('conversationId') conversationId: string) {
    await this.workspaces.snapshot(auth.user.id, conversationId)
    return topuplistTraffic()
  }
}

class WorkspaceMonitorQuery {
  @Type(() => Number) @IsInt() @Min(1)
  page = 1

  @Type(() => Number) @IsInt() @Min(1) @Max(50)
  pageSize = 20
}

@Controller('admin/workspaces')
export class AdminWorkspacesController {
  constructor(@Inject(WorkspaceMonitoringService) private readonly monitoring: WorkspaceMonitoringService) {}

  @Get()
  list(@Query() query: WorkspaceMonitorQuery) { return this.monitoring.overview(query.page, query.pageSize) }

  @Get(':conversationId/history')
  history(@Param('conversationId') conversationId: string, @Query() query: WorkspaceMonitorQuery) { return this.monitoring.history(conversationId, query.page, query.pageSize) }

  @Post('refresh')
  @HttpCode(200)
  refresh(@Query() query: WorkspaceMonitorQuery) { return this.monitoring.refresh(query.page, query.pageSize) }
}
