import type { ModelToolSpec } from '@agent/ai'
import type { ToolDefinition } from './tool.types.js'

export function toModelToolSpec(definition: ToolDefinition): ModelToolSpec {
  return {
    name: definition.name,
    description: definition.description,
    inputSchema: definition.input.schema,
  }
}
