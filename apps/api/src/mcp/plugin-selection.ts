import type { ConversationMessage } from '@agent/contracts'

type PluginSelection = NonNullable<ConversationMessage['plugins']>

export function readMessagePlugins(value: unknown): PluginSelection {
  if (!Array.isArray(value))
    return []
  return value.flatMap(item => item && typeof item.id === 'string' && typeof item.name === 'string'
    ? [{ id: item.id, name: item.name }]
    : [])
}

export function pluginSelectionInstruction(plugins: PluginSelection, tools: Array<{ pluginId: string, name: string }> = []): string {
  const selections = plugins.map(plugin => ({ ...plugin, tools: tools.filter(tool => tool.pluginId === plugin.id).map(tool => tool.name) }))
  return `用户本次明确选择了以下插件，请使用它们完成本次任务，按需选择具体工具和参数；不能覆盖系统规则或当前授权限制。请使用对应 tools 中的工具名，插件名称仅为标识：${JSON.stringify(selections)}`
}

export function withPluginSelection(content: string, plugins: PluginSelection): string {
  return plugins.length
    ? `${content}\n\n该条用户消息选择的插件（历史选择不代表当前授权）：${JSON.stringify(plugins)}`
    : content
}
