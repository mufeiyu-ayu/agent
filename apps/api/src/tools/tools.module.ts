import { Inject, Module } from '@nestjs/common'

import { PrismaModule } from '../prisma/prisma.module.js'
import { searchArticlesDefinition, SearchArticlesTool } from './search-articles.tool.js'
import { ToolInvocationService } from './tool-invocation.service.js'
import { ToolRegistryService } from './tool-registry.service.js'

@Module({
  imports: [PrismaModule],
  providers: [ToolRegistryService, ToolInvocationService, SearchArticlesTool],
  exports: [ToolRegistryService, ToolInvocationService],
})
export class ToolsModule {
  constructor(
    @Inject(ToolRegistryService)
    registry: ToolRegistryService,

    @Inject(SearchArticlesTool)
    searchArticlesTool: SearchArticlesTool,
  ) {
    registry.register({
      definition: searchArticlesDefinition,
      executor: searchArticlesTool,
    })
  }
}
