import type { SearchArticlesTool } from './articles/search-articles.tool.js'

import assert from 'node:assert/strict'
// 项目本轮使用 Node 原生测试运行器，不引入额外测试框架。
// eslint-disable-next-line test/no-import-node-test
import { describe, it, mock } from 'node:test'
import { searchArticlesDefinition } from './articles/search-articles.tool.js'
import { ToolRegistryService } from './core/tool-registry.service.js'
import { TOOL_DEFINITIONS } from './tool-definitions.js'
import { ToolsModule } from './tools.module.js'

describe('ToolsModule', () => {
  it('只注册 search_articles，与共用清单一致', () => {
    const registry = new ToolRegistryService()
    const register = mock.method(registry, 'register')
    const toolsModule = new ToolsModule(registry, {} as SearchArticlesTool)

    assert.ok(toolsModule, 'toolsModule')
    assert.deepEqual(
      register.mock.calls.map(call => call.arguments[0].definition),
      [searchArticlesDefinition],
    )
    // 共用清单里的每个定义都必须被模块注册，否则 Run allowlist 会暴露一个 Registry 里没有的工具。
    assert.deepEqual(TOOL_DEFINITIONS, [searchArticlesDefinition])
    assert.equal(registry.get('search_articles')?.definition, searchArticlesDefinition)
  })
})
