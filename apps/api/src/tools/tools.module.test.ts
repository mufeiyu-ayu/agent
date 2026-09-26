import type { ModuleRef } from '@nestjs/core'

import assert from 'node:assert/strict'
import { describe, it, vi } from 'vitest'
import { ToolRegistryService } from './core/tool-registry.service.js'
import { TOOL_DEFINITIONS, TOOLS } from './tool-definitions.js'
import { ToolsModule } from './tools.module.js'

describe('ToolsModule', () => {
  it('Registry 中的工具与清单一一对应且顺序一致', () => {
    const registry = new ToolRegistryService()
    const register = vi.spyOn(registry, 'register')
    // 每个执行器类一个替身实例，ModuleRef 按类取实例。
    const executors = new Map(TOOLS.map(tool => [tool.executor, { stubFor: tool.definition.name }] as const))
    const moduleRef = { get: (type: unknown) => executors.get(type as never) } as unknown as ModuleRef

    new ToolsModule(registry, moduleRef).onModuleInit()

    const registered = register.mock.calls.map(call => call[0])
    // providers 由清单展开：执行器类不在里面，真实 Nest 里 ModuleRef 取不到实例。
    const providers = Reflect.getMetadata('providers', ToolsModule) as unknown[]

    assert.equal(registered.length, TOOLS.length)
    TOOLS.forEach((tool, index) => {
      assert.equal(providers.includes(tool.executor), true, tool.definition.name)
      assert.equal(registered[index]?.definition, tool.definition, tool.definition.name)
      assert.equal(registered[index]?.executor, executors.get(tool.executor), tool.definition.name)
      assert.equal(registry.get(tool.definition.name)?.definition, tool.definition, tool.definition.name)
    })
    // Run 暴露给模型的工具与 Admin 概览读的派生定义，和清单同序。
    assert.deepEqual(TOOL_DEFINITIONS, TOOLS.map(tool => tool.definition))
  })
})
