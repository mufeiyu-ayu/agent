import type { RegisteredTool } from './tool.types.js'
import { Injectable } from '@nestjs/common'

import { ToolRegistryError } from './tool.errors.js'

const TOOL_NAME_PATTERN = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/

@Injectable()
export class ToolRegistryService {
  private readonly tools = new Map<string, unknown>()

  register<TInput, TOutput>(tool: RegisteredTool<TInput, TOutput>): void {
    const { name } = tool.definition

    if (!TOOL_NAME_PATTERN.test(name))
      throw new ToolRegistryError('invalid_tool_name', `非法工具名：${name}`)

    if (this.tools.has(name))
      throw new ToolRegistryError('duplicate_tool', `工具已注册：${name}`)

    this.tools.set(name, tool)
  }

  get(name: string): RegisteredTool | undefined {
    return this.tools.get(name) as RegisteredTool | undefined
  }
}
