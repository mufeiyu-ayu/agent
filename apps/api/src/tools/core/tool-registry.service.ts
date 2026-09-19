import type { RegisteredTool } from './tool.types.js'
import { Injectable } from '@nestjs/common'

@Injectable()
export class ToolRegistryService {
  private readonly tools = new Map<string, unknown>()

  register<TInput>(tool: RegisteredTool<TInput>): void {
    const { name } = tool.definition

    if (this.tools.has(name))
      throw new Error(`工具已注册：${name}`)

    this.tools.set(name, tool)
  }

  get(name: string): RegisteredTool | undefined {
    return this.tools.get(name) as RegisteredTool | undefined
  }
}
