import type { OnModuleInit } from '@nestjs/common'
import { Inject, Module } from '@nestjs/common'
import { ModuleRef } from '@nestjs/core'

import { PrismaModule } from '../prisma/prisma.module.js'
import { ToolInvocationService } from './core/tool-invocation.service.js'
import { ToolRegistryService } from './core/tool-registry.service.js'
import { TOOLS } from './tool-definitions.js'

@Module({
  imports: [PrismaModule],
  providers: [
    ToolRegistryService,
    ToolInvocationService,
    ...TOOLS.map(tool => tool.executor),
  ],
  exports: [ToolInvocationService],
})
export class ToolsModule implements OnModuleInit {
  constructor(
    @Inject(ToolRegistryService)
    private readonly registry: ToolRegistryService,

    @Inject(ModuleRef)
    private readonly moduleRef: ModuleRef,
  ) {}

  // 放在 onModuleInit：构造函数执行时执行器可能还没构造，ModuleRef 取到的只是 Nest 的占位对象。
  onModuleInit(): void {
    for (const { definition, executor } of TOOLS)
      this.registry.register({ definition, executor: this.moduleRef.get(executor) })
  }
}
