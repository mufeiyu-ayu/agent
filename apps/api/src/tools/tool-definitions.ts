import type { Type } from '@nestjs/common'
import type { ToolDefinition, ToolExecutor } from './core/tool.types.js'
import { searchArticlesDefinition, SearchArticlesTool } from './articles/search-articles.tool.js'

/**
 * 唯一的工具清单，顺序即暴露给模型的顺序：新增工具在这里加一行，就完成注册与暴露。
 * 执行器依赖的 Nest 模块与系统提示词里的用法说明另见 `tools/README.md`。
 */
export const TOOLS = [
  toolEntry(searchArticlesDefinition, SearchArticlesTool),
]

/** 由清单派生：Run 暴露给模型的工具与 Admin 概览的工具名都读它。 */
export const TOOL_DEFINITIONS = TOOLS.map(tool => tool.definition)

/**
 * 定义与执行器类必须是同一个输入类型，在这里做编译期检查；各工具输入类型不同，进了清单就放宽，
 * 才能放进同一个数组：定义按 unknown，执行器只能按 any（与 Pi 的 `AgentTool<any>[]` 同理）。
 */
function toolEntry<TInput>(
  definition: ToolDefinition<TInput>,
  executor: Type<ToolExecutor<TInput>>,
): { definition: ToolDefinition, executor: Type<ToolExecutor<any>> } {
  return { definition, executor }
}
