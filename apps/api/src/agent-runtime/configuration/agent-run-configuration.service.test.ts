import type { LLMService } from '../../llm/llm.service.js'
import type { ToolRegistryService } from '../../tools/core/tool-registry.service.js'
import type { ToolDefinition } from '../../tools/core/tool.types.js'
import type { AgentRuntimePolicy, AgentRuntimePolicyService } from './agent-runtime.policy.js'
import assert from 'node:assert/strict'
// 项目本轮使用 Node 原生测试运行器，不引入 Vitest。
// eslint-disable-next-line test/no-import-node-test
import { describe, it } from 'node:test'

import { AgentRunConfigurationService } from './agent-run-configuration.service.js'
import { DEFAULT_AGENT_RUNTIME_POLICY } from './agent-runtime.policy.js'

function createToolDefinition(name: string): ToolDefinition {
  return {
    name,
    version: '1',
    description: `${name} 测试定义`,
    input: {
      schema: {
        type: 'object',
        properties: {},
        required: [],
        additionalProperties: false,
      },
      parse: () => ({}),
    },
    timeoutMs: 1_000,
    maxObservationChars: 1_000,
    requiresApproval: false,
    idempotent: true,
    risk: {
      level: 'low',
      sideEffect: 'none',
      network: 'none',
    },
    evidencePolicy: 'discovery_only',
  }
}

function createService(input: {
  policy?: Partial<AgentRuntimePolicy>
  registeredToolNames?: string[]
} = {}) {
  const resolveCalls: Array<Record<string, unknown> | undefined> = []
  const llmService = {
    resolveChatRequestConfig: (options?: {
      model?: string
      reasoningEffort?: 'low' | 'high' | 'max'
      maxTokens?: number
    }) => {
      resolveCalls.push(options)

      return {
        model: options?.model ?? 'deepseek-v4-flash',
        contextWindowTokens: 1_000_000,
        maxOutputTokens: options?.maxTokens ?? 65_536,
        reasoningEffort: options?.reasoningEffort ?? 'high',
      }
    },
  } as unknown as LLMService
  const registeredToolNames = input.registeredToolNames
    ?? [
      'hidden_admin_tool',
      'get_article_detail',
      'retrieve_article_context',
      'search_articles',
    ]
  const registry = {
    get: (name: string) => (
      registeredToolNames.includes(name)
        ? { definition: createToolDefinition(name) }
        : undefined
    ),
  } as unknown as ToolRegistryService
  const service = new AgentRunConfigurationService(
    {
      value: { ...DEFAULT_AGENT_RUNTIME_POLICY, ...input.policy },
    } as AgentRuntimePolicyService,
    llmService,
    registry,
  )

  return { service, resolveCalls }
}

describe('AgentRunConfigurationService', () => {
  it('组合 resolved 请求配置与 allowlist 内 Tool，排除未列入的工具', () => {
    const { service } = createService()

    const configuration = service.resolve({ reasoningEffort: 'max' })

    assert.deepEqual(service.policy, DEFAULT_AGENT_RUNTIME_POLICY)
    assert.deepEqual(
      configuration.toolDefinitions.map(definition => definition.name),
      ['search_articles', 'get_article_detail', 'retrieve_article_context'],
    )
    assert.deepEqual(
      configuration.modelTools.map(tool => tool.name),
      ['search_articles', 'get_article_detail', 'retrieve_article_context'],
    )
    assert.deepEqual(configuration.request, {
      model: 'deepseek-v4-flash',
      contextWindowTokens: 1_000_000,
      maxOutputTokens: 65_536,
      reasoningEffort: 'max',
    })
  })

  it('maxToolCalls=0 时不向模型暴露任何 Tool，但保留服务端定义', () => {
    const { service } = createService({ policy: { maxToolCalls: 0 } })

    const configuration = service.resolve({})

    assert.deepEqual(configuration.modelTools, [])
    assert.equal(configuration.toolDefinitions.length, 3)
  })

  it('Registry 缺少 allowlisted Tool 时跳过，不伪造定义', () => {
    const { service } = createService({
      registeredToolNames: ['search_articles'],
    })

    const configuration = service.resolve({})

    assert.deepEqual(
      configuration.toolDefinitions.map(definition => definition.name),
      ['search_articles'],
    )
    assert.deepEqual(
      configuration.modelTools.map(tool => tool.name),
      ['search_articles'],
    )
  })

  it('请求级覆盖透传给 LLM 解析边界；空字符串 model 回落默认', () => {
    const { service, resolveCalls } = createService()

    const configuration = service.resolve({
      model: 'deepseek-v4-pro',
      reasoningEffort: 'low',
      maxTokens: 4_096,
    })

    assert.deepEqual(resolveCalls[0], {
      model: 'deepseek-v4-pro',
      reasoningEffort: 'low',
      maxTokens: 4_096,
    })
    assert.equal(configuration.request.model, 'deepseek-v4-pro')
    assert.equal(configuration.request.maxOutputTokens, 4_096)

    // 空字符串回落默认模型是重构前 runTurnStream 的既有语义，这里锁定现状。
    service.resolve({ model: '' })
    assert.deepEqual(resolveCalls[1], {})
  })
})
