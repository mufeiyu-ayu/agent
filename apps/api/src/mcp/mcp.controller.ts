import type { AuthContext } from '../auth/auth.decorators.js'
import { Body, Controller, Delete, Get, Inject, Param, Patch, Post, Query, Res } from '@nestjs/common'
import { IsString, MaxLength } from 'class-validator'
import { CurrentAuth } from '../auth/auth.decorators.js'
import { readAppOrigins } from '../auth/auth.guard.js'
import { parseMcpImport } from './mcp-config.js'
// Nest 的请求校验依赖 DTO 运行时元数据。
// eslint-disable-next-line ts/consistent-type-imports
import { McpConnectDto, McpEnabledDto, McpPluginDto } from './mcp.dto.js'
import { McpService } from './mcp.service.js'

class ImportMcpDto {
  @IsString() @MaxLength(32_000) json!: string
}

@Controller('mcp')
export class McpController {
  constructor(@Inject(McpService) private readonly mcp: McpService) {}

  @Get() list(@CurrentAuth() auth: AuthContext) {
    return this.mcp.list(auth.user.id)
  }

  @Get('config') config() {
    return { callbackUrl: this.mcp.callbackUrl }
  }

  @Post('import') importConfig(@Body() body: ImportMcpDto) {
    return parseMcpImport(body.json)
  }

  @Post() create(@CurrentAuth() auth: AuthContext, @Body() body: McpPluginDto) {
    return this.mcp.save(auth.user.id, body)
  }

  @Get('oauth/callback')
  async callback(
    @CurrentAuth() auth: AuthContext,
    @Query() query: Record<string, string>,
    @Res() response: { redirect: (code: number, url: string) => void },
  ) {
    let result = 'connected'
    try {
      await this.mcp.callback(auth.user.id, new URLSearchParams(query))
    }
    catch {
      result = 'failed'
    }
    response.redirect(303, `${readAppOrigins()[0]}/plugins?oauth=${result}`)
  }

  @Get(':id') detail(@CurrentAuth() auth: AuthContext, @Param('id') id: string) {
    return this.mcp.detail(auth.user.id, id)
  }

  @Patch(':id') update(@CurrentAuth() auth: AuthContext, @Param('id') id: string, @Body() body: McpPluginDto) {
    return this.mcp.save(auth.user.id, body, id)
  }

  @Delete(':id') remove(@CurrentAuth() auth: AuthContext, @Param('id') id: string) {
    return this.mcp.remove(auth.user.id, id)
  }

  @Post(':id/connect') connect(@CurrentAuth() auth: AuthContext, @Param('id') id: string, @Body() body: McpConnectDto) {
    return this.mcp.connect(auth.user.id, id, body.headers, false, body.configRevision)
  }

  @Post(':id/enabled') enabled(@CurrentAuth() auth: AuthContext, @Param('id') id: string, @Body() body: McpEnabledDto) {
    return this.mcp.setEnabled(auth.user.id, id, body.enabled)
  }

  @Post(':id/disconnect') disconnect(@CurrentAuth() auth: AuthContext, @Param('id') id: string) {
    return this.mcp.disconnect(auth.user.id, id)
  }
}

@Controller('admin/mcp')
export class AdminMcpController {
  constructor(@Inject(McpService) private readonly mcp: McpService) {}

  @Get() list(@CurrentAuth() auth: AuthContext) {
    return this.mcp.list(auth.user.id, true)
  }

  @Post() create(@CurrentAuth() auth: AuthContext, @Body() body: McpPluginDto) {
    return this.mcp.save(auth.user.id, body, undefined, true)
  }

  @Patch(':id') update(@CurrentAuth() auth: AuthContext, @Param('id') id: string, @Body() body: McpPluginDto) {
    return this.mcp.save(auth.user.id, body, id, true)
  }

  @Delete(':id') remove(@CurrentAuth() auth: AuthContext, @Param('id') id: string) {
    return this.mcp.remove(auth.user.id, id, true)
  }

  @Post(':id/enabled') enabled(@CurrentAuth() auth: AuthContext, @Param('id') id: string, @Body() body: McpEnabledDto) {
    return this.mcp.toggleSystem(auth.user.id, id, body.enabled)
  }

  @Post(':id/test') test(@CurrentAuth() auth: AuthContext, @Param('id') id: string, @Body() body: McpConnectDto) {
    return this.mcp.connect(auth.user.id, id, body.headers, true, body.configRevision)
  }
}
