import type { GetArticleDetailTool } from './articles/get-article-detail.tool.js'
import type { SearchArticlesTool } from './articles/search-articles.tool.js'

import assert from 'node:assert/strict'

import process from 'node:process'
// 项目本轮使用 Node 原生测试运行器，不引入额外测试框架。
// eslint-disable-next-line test/no-import-node-test
import { describe, it } from 'node:test'
import { HybridArticleRetrievalRuntime } from '../retrieval/hybrid-article-retrieval.runtime.js'
import { ToolRegistryService } from './core/tool-registry.service.js'
import { RetrieveArticleContextTool } from './retrieval/retrieve-article-context.tool.js'
import { TOOL_DEFINITIONS } from './tool-definitions.js'
import { ToolsModule } from './tools.module.js'

describe('ToolsModule', () => {
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
      // 共用清单里的每个定义都必须被模块注册，否则 Run allowlist 会暴露一个 Registry 里没有的工具。
      for (const definition of TOOL_DEFINITIONS)
        assert.equal(registry.get(definition.name)?.definition, definition)
    }
    finally {
      if (originalApiKey === undefined)
        delete process.env.GEMINI_API_KEY
      else
        process.env.GEMINI_API_KEY = originalApiKey
    }
  })
})
