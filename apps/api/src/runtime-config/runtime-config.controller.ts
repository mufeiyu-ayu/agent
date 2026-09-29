import { Body, Controller, Get, Inject, Patch } from '@nestjs/common'

// DTO classes are required at runtime for Nest decorator metadata.
// eslint-disable-next-line ts/consistent-type-imports
import { UpdateRuntimeConfigDto } from './dto/update-runtime-config.dto.js'
import { RuntimeConfigService } from './runtime-config.service.js'

/** 管理台「运行配置」；`admin/*` 由全局 Guard 要求 ADMIN。Serper Key 只回显尾四位。 */
@Controller('admin/runtime-config')
export class RuntimeConfigController {
  constructor(
    @Inject(RuntimeConfigService)
    private readonly runtimeConfigService: RuntimeConfigService,
  ) {}

  @Get()
  get() {
    return this.runtimeConfigService.getForAdmin()
  }

  @Patch()
  update(@Body() body: UpdateRuntimeConfigDto) {
    return this.runtimeConfigService.update(body)
  }
}
