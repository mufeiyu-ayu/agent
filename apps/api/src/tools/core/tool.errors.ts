export type ToolRegistryErrorCode
  = | 'duplicate_tool'
    | 'invalid_tool_name'

export class ToolRegistryError extends Error {
  constructor(
    readonly code: ToolRegistryErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'ToolRegistryError'
  }
}
