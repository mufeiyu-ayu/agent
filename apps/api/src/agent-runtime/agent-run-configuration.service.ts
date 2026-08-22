import type { ResolvedChatRequestConfig } from '../llm/llm-runtime-config.js'
import type { ModelToolSpec } from '../llm/model-tool-spec.types.js'
import type { ToolDefinition } from '../tools/core/tool.types.js'
import type { AgentRuntimePolicy } from './agent-runtime.policy.js'

import { Inject, Injectable, Logger } from '@nestjs/common'

import { LLMService } from '../llm/llm.service.js'
import { toModelToolSpec } from '../tools/core/model-tool-spec.mapper.js'
import { ToolRegistryService } from '../tools/core/tool-registry.service.js'
import { AgentRuntimePolicyService } from './agent-runtime.policy.js'

/** 单次 Agent Run 允许暴露给模型的 Tool allowlist；顺序即暴露顺序。 */
const AGENT_RUN_TOOL_NAMES = [
  'search_articles',
  'get_article_detail',
  'retrieve_article_context',
] as const

/** 请求级配置覆盖，来自单轮用户输入。 */
export interface AgentRunRequestOverrides {
  model?: string
  temperature?: number
  maxTokens?: number
}

/**
 * 一次 Agent Run 的完整已解析配置。
 *
 * 只包含单次 Run 编排所需的事实：resolved 模型请求配置、allowlist 内的
 * Tool 定义与模型可见 Tool 说明。运行策略经 `policy` getter 单独读取
 * （deadline 时序要求），不在返回值中重复暴露。数据库、Embedding、
 * Admin 等应用级配置不属于这里。
 */
export interface ResolvedAgentRunConfiguration {
  request: ResolvedChatRequestConfig
  toolDefinitions: ToolDefinition[]
  modelTools: ModelToolSpec[]
}

/**
 * 单次 Agent Run 配置解析入口。
 *
 * 各领域配置仍由各自边界定义与校验（Policy 环境解析、LLM 请求校验、
 * Tool Definition 自带 policy）；本服务只负责把它们组合成一份
 * ResolvedAgentRunConfiguration，让 AgentRuntimeService 不再自行
 * 读取 Policy、筛选 Tool 或穿透 LLM 边界补查 Model Profile。
 */
@Injectable()
export class AgentRunConfigurationService {
  private readonly logger = new Logger(AgentRunConfigurationService.name)

  constructor(
    @Inject(AgentRuntimePolicyService)
    private readonly runtimePolicyService: AgentRuntimePolicyService,

    @Inject(LLMService)
    private readonly llmService: LLMService,

    @Inject(ToolRegistryService)
    private readonly toolRegistryService: ToolRegistryService,
  ) {}

  /**
   * 运行策略单独暴露：Run deadline 必须在请求级配置解析（可能抛
   * LLMConfigError）之前生效，Policy 本身是启动期已校验的非抛错读取。
   */
  get policy(): AgentRuntimePolicy {
    return this.runtimePolicyService.value
  }

  /**
   * 解析一次 Run 的完整配置。
   *
   * 请求级 model / maxTokens 非法时抛 LLMConfigError；调用时机由
   * Runtime 控制，以保持配置错误发生时既有的 Run 终态化语义。
   * Registry 缺失 allowlisted Tool 时按现状跳过，不伪造定义。
   */
  resolve(overrides: AgentRunRequestOverrides): ResolvedAgentRunConfiguration {
    const toolDefinitions = AGENT_RUN_TOOL_NAMES.flatMap((name) => {
      const definition = this.toolRegistryService.get(name)?.definition

      if (!definition) {
        this.logger.warn(`allowlist 工具 ${name} 未在 Registry 注册，本次 Run 不暴露该工具`)

        return []
      }

      return [definition]
    })
    const modelTools = this.policy.maxToolCalls === 0
      ? []
      : toolDefinitions.map(toModelToolSpec)
    const request = this.llmService.resolveChatRequestConfig({
      ...(overrides.model ? { model: overrides.model } : {}),
      ...(overrides.temperature === undefined
        ? {}
        : { temperature: overrides.temperature }),
      ...(overrides.maxTokens === undefined
        ? {}
        : { maxTokens: overrides.maxTokens }),
    })

    return {
      request,
      toolDefinitions,
      modelTools,
    }
  }
}
