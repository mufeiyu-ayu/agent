import type { AuthContext } from '../auth/auth.decorators.js'
import { Body, Controller, Delete, Get, Inject, Param, Patch, Post, Put, Query } from '@nestjs/common'
import { IsArray, IsBoolean, IsString, MaxLength } from 'class-validator'
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
class CreateSkillDraftDto {
  // 保留原始文件对象，避免隐式类型转换把数组元素转成数组；内容由技能包校验器检查。
  @IsArray()
  files!: unknown
}
class SaveSkillDraftDto extends CreateSkillDraftDto {
  @IsString() @MaxLength(128)
  expectedFingerprint!: string
}

@Controller('skills')
export class SkillsController {
  constructor(@Inject(SkillsService) private readonly skills: SkillsService) {}

  @Get()
  list(@CurrentAuth() auth: AuthContext) { return this.skills.list(auth.user.id) }

  @Post()
  create(@CurrentAuth() auth: AuthContext, @Body() body: CreateSkillDraftDto) {
    return this.skills.createManualSkill(auth.user.id, body.files)
  }

  @Get(':id')
  preview(@CurrentAuth() auth: AuthContext, @Param('id') id: string, @Query('draft') draft?: string) {
    return this.skills.preview(auth.user.id, id, draft === 'true')
  }

  @Put(':id/draft')
  saveDraft(@CurrentAuth() auth: AuthContext, @Param('id') id: string, @Body() body: SaveSkillDraftDto) {
    return this.skills.saveManualDraft(auth.user.id, id, body.files, body.expectedFingerprint)
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
