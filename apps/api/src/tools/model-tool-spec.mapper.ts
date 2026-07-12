import type { ModelToolSpec } from '../llm/model-tool-spec.types.js'
import type { ToolDefinition } from './tool.types.js'

export function toModelToolSpec(definition: ToolDefinition): ModelToolSpec {
  return {
    name: definition.name,
    description: definition.description,
    inputSchema: definition.input.schema,
  }
}
