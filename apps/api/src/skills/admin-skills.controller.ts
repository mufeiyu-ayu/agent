import { Body, Controller, Delete, Get, Inject, Param, Patch, Post } from '@nestjs/common'
import { IsBoolean } from 'class-validator'
// DTO 必须保留运行时值，供 Nest 生成请求体验证元数据。
// eslint-disable-next-line ts/consistent-type-imports
import { CreateSkillDraftDto, SaveSkillDraftDto } from './skill-write.dto.js'
import { SkillsService } from './skills.service.js'

class ToggleSystemSkillDto {
  @IsBoolean()
  enabled!: boolean
}

// /api/admin/* 由全局 AuthGuard 强制管理员身份；null 归属只由此入口指定。
@Controller('admin/skills')
export class AdminSkillsController {
  constructor(@Inject(SkillsService) private readonly skills: SkillsService) {}

  @Get()
  list() { return this.skills.list(null) }

  @Get(':id')
  preview(@Param('id') id: string) { return this.skills.preview(null, id) }

  @Post()
  create(@Body() body: CreateSkillDraftDto) { return this.skills.createManualSkill(null, body.files) }

  @Patch(':id')
  update(@Param('id') id: string, @Body() body: SaveSkillDraftDto) {
    return this.skills.saveSystemSkill(id, body.files, body.expectedFingerprint)
  }

  @Post(':id/toggle')
  async toggle(@Param('id') id: string, @Body() body: ToggleSystemSkillDto) {
    await this.skills.setEnabled(null, id, body.enabled)
    return { id, enabled: body.enabled }
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    await this.skills.remove(null, id)
    return { id }
  }
}
