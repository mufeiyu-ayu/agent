/** 当前工具输入需要的最小 JSON Schema 子集。 */
export type JsonSchemaProperty
  = | { type: 'boolean', description?: string }
    | { type: 'integer', description?: string }
    | { type: 'string', description?: string }
    | { type: 'array', items: { type: 'string' }, description?: string }

export interface JsonObjectSchema {
  type: 'object'
  properties: Record<string, JsonSchemaProperty>
  required: string[]
  additionalProperties: false
}

/** Provider-neutral 的模型可见工具说明，不包含任何服务端执行能力。 */
export interface ModelToolSpec {
  name: string
  description: string
  inputSchema: JsonObjectSchema
}
