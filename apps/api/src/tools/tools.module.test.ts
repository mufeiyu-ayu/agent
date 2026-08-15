import assert from 'node:assert/strict'
import process from 'node:process'

// 项目本轮使用 Node 原生测试运行器，不引入额外测试框架。
// eslint-disable-next-line test/no-import-node-test
import { describe, it } from 'node:test'

import { PrismaModule } from '../prisma/prisma.module.js'
import { HybridArticleRetrievalRuntime } from '../retrieval/hybrid-article-retrieval.runtime.js'
import { PrismaArticleRetriever } from '../retrieval/prisma-article-retriever.js'
import { GetArticleDetailTool } from './articles/get-article-detail.tool.js'
import { SearchArticlesTool } from './articles/search-articles.tool.js'
import { ToolInvocationService } from './core/tool-invocation.service.js'
import { ToolRegistryService } from './core/tool-registry.service.js'
import { RetrieveArticleContextTool } from './retrieval/retrieve-article-context.tool.js'
import { ToolsModule } from './tools.module.js'

describe('ToolsModule', () => {
  it('ToolsModule 提供并导出 Registry 与 InvocationService', () => {
    const imports = Reflect.getMetadata('imports', ToolsModule)
    const providers = Reflect.getMetadata('providers', ToolsModule)
    const exports = Reflect.getMetadata('exports', ToolsModule)
    const registry = new ToolRegistryService()
    const searchArticlesTool = {} as SearchArticlesTool
    const getArticleDetailTool = {} as GetArticleDetailTool
    const retrieveArticleContextTool = {} as RetrieveArticleContextTool
    const toolsModule = new ToolsModule(
      registry,
      searchArticlesTool,
      getArticleDetailTool,
      retrieveArticleContextTool,
    )

    assert.ok(toolsModule)
    assert.deepEqual(imports, [PrismaModule])
    assert.deepEqual(providers, [
      ToolRegistryService,
      ToolInvocationService,
      PrismaArticleRetriever,
      HybridArticleRetrievalRuntime,
      SearchArticlesTool,
      GetArticleDetailTool,
      RetrieveArticleContextTool,
    ])
    assert.deepEqual(exports, [ToolRegistryService, ToolInvocationService])
    assert.deepEqual(
      registry.listDefinitions().map(definition => definition.name),
      ['get_article_detail', 'retrieve_article_context', 'search_articles'],
    )
    assert.equal(registry.require('search_articles').executor, searchArticlesTool)
    assert.equal(registry.require('get_article_detail').executor, getArticleDetailTool)
    assert.equal(
      registry.require('retrieve_article_context').executor,
      retrieveArticleContextTool,
    )
  })

  it('模块装配不依赖 Embedding 配置，未调用检索时不解析 GEMINI_API_KEY', () => {
    const originalApiKey = process.env.GEMINI_API_KEY

    delete process.env.GEMINI_API_KEY

    try {
      const registry = new ToolRegistryService()
      const runtime = new HybridArticleRetrievalRuntime()
      const toolsModule = new ToolsModule(
        registry,
        {} as SearchArticlesTool,
        {} as GetArticleDetailTool,
        new RetrieveArticleContextTool(runtime),
      )

      assert.ok(toolsModule)
      assert.equal(registry.listDefinitions().length, 3)
    }
    finally {
      if (originalApiKey === undefined)
        delete process.env.GEMINI_API_KEY
      else
        process.env.GEMINI_API_KEY = originalApiKey
    }
  })
})
