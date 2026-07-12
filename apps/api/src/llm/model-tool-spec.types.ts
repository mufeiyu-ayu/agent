import type { JsonObjectSchema } from '../tools/tool.types.js'

/** Provider-neutral 的模型可见工具说明，不包含任何服务端执行能力。 */
export interface ModelToolSpec {
  name: string
  description: string
  inputSchema: JsonObjectSchema
}
