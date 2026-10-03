import type { WorkspaceToolDisplay } from '@agent/contracts'
import { MAX_URL_LENGTH } from './web-fetch.tool.js'
import { MAX_QUERY_LENGTH } from './web-search.tool.js'

/**
 * 界面显示的工具参数（#208 tool_started；#212 刷新后还原同样用它）：只用于展示，
 * 解析失败或不是字符串就不带，按 web_search / web_fetch 自己的参数上限截断。
 */
export function toToolProgressArguments(argumentsJson: string, toolName?: string): { query?: string, url?: string, workspace?: WorkspaceToolDisplay } {
  let args: unknown

  try {
    args = JSON.parse(argumentsJson)
  }
  catch {
    return {}
  }

  const { query, url, path, command, title, content, edits } = typeof args === 'object' && args !== null ? args as Record<string, unknown> : {}
  const operation = ['read', 'write', 'edit', 'bash'].includes(toolName ?? '') ? toolName as 'read' | 'write' | 'edit' | 'bash' : undefined

  return {
    ...(operation
      ? { workspace: {
          operation,
          title: typeof title === 'string' ? title.slice(0, 120) : operation,
          ...(typeof path === 'string' ? { path: path.slice(0, 500) } : {}),
          ...(typeof command === 'string' ? { command: command.slice(0, 32_000) } : {}),
          ...(typeof content === 'string' ? { preview: content.slice(0, 24_000) } : Array.isArray(edits) ? { preview: JSON.stringify(edits).slice(0, 24_000) } : {}),
        } }
      : {}),
    ...(typeof query === 'string' ? { query: query.slice(0, MAX_QUERY_LENGTH) } : {}),
    ...(typeof url === 'string' ? { url: url.slice(0, MAX_URL_LENGTH) } : {}),
  }
}
