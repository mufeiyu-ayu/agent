import { Inject, Module } from '@nestjs/common'

import { PrismaModule } from '../prisma/prisma.module.js'
import { HybridArticleRetrievalRuntime } from '../retrieval/hybrid-article-retrieval.runtime.js'
import { PrismaArticleRetriever } from '../retrieval/retrievers/prisma-article-retriever.js'
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
import {
  retrieveArticleContextDefinition,
  RetrieveArticleContextTool,
} from './retrieval/retrieve-article-context.tool.js'

@Module({
  imports: [PrismaModule],
  providers: [
    ToolRegistryService,
    ToolInvocationService,
    PrismaArticleRetriever,
    HybridArticleRetrievalRuntime,
    SearchArticlesTool,
    GetArticleDetailTool,
    RetrieveArticleContextTool,
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

    @Inject(RetrieveArticleContextTool)
    retrieveArticleContextTool: RetrieveArticleContextTool,
  ) {
    registry.register({
      definition: searchArticlesDefinition,
      executor: searchArticlesTool,
    })
    registry.register({
      definition: getArticleDetailDefinition,
      executor: getArticleDetailTool,
    })
    registry.register({
      definition: retrieveArticleContextDefinition,
      executor: retrieveArticleContextTool,
    })
  }
}
