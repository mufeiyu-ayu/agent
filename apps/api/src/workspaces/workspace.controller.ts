import type { ServerResponse } from 'node:http'
import type { AuthContext } from '../auth/auth.decorators.js'
import { Controller, Get, HttpCode, Inject, Param, Post, Query, Res } from '@nestjs/common'
import { Type } from 'class-transformer'
import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator'
import { CurrentAuth, Public } from '../auth/auth.decorators.js'
import { topuplistTraffic } from '../tools/workspace/topuplist-traffic.tool.js'
import { WorkspaceMonitoringService } from './workspace-monitoring.service.js'
import { WorkspacePreviewService } from './workspace-preview.service.js'
import { WorkspaceService } from './workspace.service.js'

class WorkspaceFileQuery {
  @IsString() @MaxLength(500)
  path!: string

  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(2_147_483_647)
  revision?: number
}

class WorkspaceArchiveQuery {
  @Type(() => Number) @IsInt() @Min(0) @Max(2_147_483_647)
  revision!: number
}

@Controller('conversations/:conversationId/workspace')
export class WorkspaceController {
  constructor(
    @Inject(WorkspaceService) private readonly workspaces: WorkspaceService,
    @Inject(WorkspacePreviewService) private readonly previews: WorkspacePreviewService,
  ) {}

  @Get()
  snapshot(@CurrentAuth() auth: AuthContext, @Param('conversationId') conversationId: string) {
    return this.workspaces.snapshot(auth.user.id, conversationId)
  }

  @Get('file')
  async file(@CurrentAuth() auth: AuthContext, @Param('conversationId') conversationId: string, @Query() query: WorkspaceFileQuery, @Res({ passthrough: true }) response: ServerResponse) {
    const content = await this.workspaces.savedFile(auth.user.id, conversationId, query.path, query.revision, responseSignal(response))
    return { path: query.path, encoding: 'base64', content: content.toString('base64') }
  }

  @Get('archive')
  async archive(@CurrentAuth() auth: AuthContext, @Param('conversationId') conversationId: string, @Query() query: WorkspaceArchiveQuery, @Res({ passthrough: true }) response: ServerResponse) {
    const content = await this.workspaces.archive(auth.user.id, conversationId, query.revision, responseSignal(response))
    return { revision: query.revision, encoding: 'base64', content: content.toString('base64') }
  }

  @Get('artifacts/:artifactId/preview')
  preview(@CurrentAuth() auth: AuthContext, @Param('conversationId') conversationId: string, @Param('artifactId') artifactId: string, @Query('origin') origin: string) {
    return this.previews.open(auth.user.id, conversationId, artifactId, origin)
  }

  @Get('traffic')
  async traffic(@CurrentAuth() auth: AuthContext, @Param('conversationId') conversationId: string) {
    await this.workspaces.snapshot(auth.user.id, conversationId)
    return topuplistTraffic()
  }
}

function responseSignal(response: ServerResponse): AbortSignal {
  const controller = new AbortController()
  response.once('close', () => controller.abort())
  return AbortSignal.any([controller.signal, AbortSignal.timeout(30_000)])
}

/** 能力只读接口；所有原始产物直接导航均下载、不执行。只有可信包装器创建 opaque srcdoc。 */
@Public()
@Controller('workspace-preview')
export class WorkspacePreviewController {
  constructor(@Inject(WorkspacePreviewService) private readonly previews: WorkspacePreviewService) {}

  @Get(':token/document')
  async document(@Param('token') token: string, @Query('path') path: string | undefined, @Res() response: ServerResponse) {
    response.setHeader('Content-Security-Policy', 'sandbox allow-scripts; default-src \'none\'')
    response.setHeader('Referrer-Policy', 'no-referrer')
    response.setHeader('Cache-Control', 'no-store')
    response.setHeader('X-Content-Type-Options', 'nosniff')
    response.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()')
    const { content, csp } = await this.previews.document(token, responseSignal(response), path)
    response.setHeader('Content-Security-Policy', csp)
    response.setHeader('Content-Type', 'text/html; charset=utf-8')
    response.end(content)
  }

  @Get(':token/files/*path')
  async resource(@Param('token') token: string, @Param('path') path: string | string[], @Res() response: ServerResponse) {
    response.setHeader('Content-Security-Policy', 'sandbox; default-src \'none\'; base-uri \'none\'; form-action \'none\'')
    response.setHeader('Content-Disposition', 'attachment')
    response.setHeader('X-Content-Type-Options', 'nosniff')
    response.setHeader('Cache-Control', 'no-store')
    response.setHeader('Access-Control-Allow-Origin', 'null')
    response.setHeader('Cross-Origin-Resource-Policy', 'cross-origin')
    response.setHeader('Referrer-Policy', 'no-referrer')
    const { content, mime } = await this.previews.resource(token, Array.isArray(path) ? path.join('/') : path, responseSignal(response))
    response.setHeader('Content-Type', mime === 'text/html' ? 'application/octet-stream' : mime)
    response.end(content)
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
