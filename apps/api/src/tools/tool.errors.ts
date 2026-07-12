export type ToolRegistryErrorCode
  = | 'duplicate_tool'
    | 'invalid_tool_name'
    | 'unknown_tool'

export class ToolRegistryError extends Error {
  constructor(
    readonly code: ToolRegistryErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'ToolRegistryError'
  }
}
