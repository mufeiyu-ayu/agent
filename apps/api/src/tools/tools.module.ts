import { Inject, Module } from '@nestjs/common'

import { PrismaModule } from '../prisma/prisma.module.js'
import {
  getArticleDetailDefinition,
  GetArticleDetailTool,
} from './articles/get-article-detail.tool.js'
import {
  searchArticlesDefinition,
  SearchArticlesTool,
} from './articles/search-articles.tool.js'
import { ToolInvocationService } from './core/tool-invocation.service.js'
import { ToolRegistryService } from './core/tool-registry.service.js'

@Module({
  imports: [PrismaModule],
  providers: [
    ToolRegistryService,
    ToolInvocationService,
    SearchArticlesTool,
    GetArticleDetailTool,
  ],
  exports: [ToolRegistryService, ToolInvocationService],
})
export class ToolsModule {
  constructor(
    @Inject(ToolRegistryService)
    registry: ToolRegistryService,

    @Inject(SearchArticlesTool)
    searchArticlesTool: SearchArticlesTool,

    @Inject(GetArticleDetailTool)
    getArticleDetailTool: GetArticleDetailTool,
  ) {
    registry.register({
      definition: searchArticlesDefinition,
      executor: searchArticlesTool,
    })
    registry.register({
      definition: getArticleDetailDefinition,
      executor: getArticleDetailTool,
    })
  }
}
