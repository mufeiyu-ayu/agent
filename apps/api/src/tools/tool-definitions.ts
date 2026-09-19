import { getArticleDetailDefinition } from './articles/get-article-detail.tool.js'
import { searchArticlesDefinition } from './articles/search-articles.tool.js'
import { retrieveArticleContextDefinition } from './retrieval/retrieve-article-context.tool.js'

/**
 * 全部服务端工具定义，顺序即暴露给模型的顺序。
 *
 * Run allowlist 与 Admin 投影都从这里读；`ToolsModule` 按同一顺序把它们与执行器成对注册。
 */
export const TOOL_DEFINITIONS = [
  searchArticlesDefinition,
  getArticleDetailDefinition,
  retrieveArticleContextDefinition,
]
