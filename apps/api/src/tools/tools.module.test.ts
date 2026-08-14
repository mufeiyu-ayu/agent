import assert from 'node:assert/strict'
// 项目本轮使用 Node 原生测试运行器，不引入额外测试框架。
// eslint-disable-next-line test/no-import-node-test
import { describe, it } from 'node:test'

import { PrismaModule } from '../prisma/prisma.module.js'
import { PrismaArticleRetriever } from '../retrieval/prisma-article-retriever.js'
import { GetArticleDetailTool } from './articles/get-article-detail.tool.js'
import { SearchArticlesTool } from './articles/search-articles.tool.js'
import { ToolInvocationService } from './core/tool-invocation.service.js'
import { ToolRegistryService } from './core/tool-registry.service.js'
import { ToolsModule } from './tools.module.js'

describe('ToolsModule', () => {
  it('ToolsModule 提供并导出 Registry 与 InvocationService', () => {
    const imports = Reflect.getMetadata('imports', ToolsModule)
    const providers = Reflect.getMetadata('providers', ToolsModule)
    const exports = Reflect.getMetadata('exports', ToolsModule)
    const registry = new ToolRegistryService()
    const searchArticlesTool = {} as SearchArticlesTool
    const getArticleDetailTool = {} as GetArticleDetailTool
    const toolsModule = new ToolsModule(
      registry,
      searchArticlesTool,
      getArticleDetailTool,
    )

    assert.ok(toolsModule)
    assert.deepEqual(imports, [PrismaModule])
    assert.deepEqual(providers, [
      ToolRegistryService,
      ToolInvocationService,
      PrismaArticleRetriever,
      SearchArticlesTool,
      GetArticleDetailTool,
    ])
    assert.deepEqual(exports, [ToolRegistryService, ToolInvocationService])
    assert.deepEqual(
      registry.listDefinitions().map(definition => definition.name),
      ['get_article_detail', 'search_articles'],
    )
    assert.equal(registry.require('search_articles').executor, searchArticlesTool)
    assert.equal(registry.require('get_article_detail').executor, getArticleDetailTool)
  })
})
