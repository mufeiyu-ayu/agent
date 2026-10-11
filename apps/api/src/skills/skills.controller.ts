import type { AuthContext } from '../auth/auth.decorators.js'
import { Body, Controller, Delete, Get, Inject, Param, Patch, Post, Query } from '@nestjs/common'
import { IsBoolean, IsString, MaxLength } from 'class-validator'
import { CurrentAuth } from '../auth/auth.decorators.js'
import { SkillsService } from './skills.service.js'

class PublishSkillDto {
  @IsString() @MaxLength(128)
  fingerprint!: string
}
class EnabledSkillDto {
  @IsBoolean()
  enabled!: boolean
}

@Controller('skills')
export class SkillsController {
  constructor(@Inject(SkillsService) private readonly skills: SkillsService) {}

  @Get()
  list(@CurrentAuth() auth: AuthContext) { return this.skills.list(auth.user.id) }

  @Get(':id')
  preview(@CurrentAuth() auth: AuthContext, @Param('id') id: string, @Query('draft') draft?: string) {
    return this.skills.preview(auth.user.id, id, draft === 'true')
  }

  @Post(':id/publish')
  publish(@CurrentAuth() auth: AuthContext, @Param('id') id: string, @Body() body: PublishSkillDto) {
    return this.skills.publish(auth.user.id, id, body.fingerprint)
  }

  @Patch(':id')
  async enabled(@CurrentAuth() auth: AuthContext, @Param('id') id: string, @Body() body: EnabledSkillDto) {
    await this.skills.setEnabled(auth.user.id, id, body.enabled)
    return { id, enabled: body.enabled }
  }

  @Delete(':id')
  async remove(@CurrentAuth() auth: AuthContext, @Param('id') id: string) {
    await this.skills.remove(auth.user.id, id)
    return { id }
  }
}
