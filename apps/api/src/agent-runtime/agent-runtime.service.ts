import type { AgentRuntimeEvent } from '@agent/agent'
import type { RunTurnStreamInput } from './agent-runtime.types.js'
import { AgentRuntime } from '@agent/agent'
import { Inject, Injectable, Logger, Optional } from '@nestjs/common'
import { WORKSPACE_TOOL_NAMES } from '../chat/prompts/workspace-development.prompt.js'
import { LLMService } from '../llm/llm.service.js'
import { PrismaService } from '../prisma/prisma.service.js'
import { ToolInvocationService } from '../tools/core/tool-invocation.service.js'
import { TOOL_DEFINITIONS } from '../tools/tool-definitions.js'
import { WorkspaceService } from '../workspaces/workspace.service.js'
import { createRuntimeHost, runtimeConfig, runtimeModel } from './agent-runtime-host.js'
import { ContextCompactionService } from './context/context-compaction.service.js'
import { AgentRunRecorderService } from './lifecycle/agent-run-recorder.service.js'

/** Nest 宿主门面；循环与终态状态机只有 @agent/agent 一份。 */
@Injectable()
export class AgentRuntimeService {
  private readonly logger = new Logger(AgentRuntimeService.name)

  constructor(
    @Inject(LLMService) private readonly llmService: LLMService,
    @Inject(PrismaService) private readonly prismaService: PrismaService,
    @Inject(AgentRunRecorderService) private readonly agentRunRecorderService: AgentRunRecorderService,
    @Inject(ToolInvocationService) private readonly toolInvocationService: ToolInvocationService,
    @Inject(ContextCompactionService) private readonly contextCompactionService: ContextCompactionService,
    @Optional() @Inject(WorkspaceService) private readonly workspaces?: WorkspaceService,
  ) {}

  async* runTurnStream(input: RunTurnStreamInput): AsyncGenerator<AgentRuntimeEvent> {
    const host = createRuntimeHost(input, {
      llm: this.llmService,
      prisma: this.prismaService,
      recorder: this.agentRunRecorderService,
      tools: this.toolInvocationService,
      compaction: this.contextCompactionService,
      logger: this.logger,
      ...(this.workspaces ? { workspaces: this.workspaces } : {}),
    })
    yield* new AgentRuntime(host).runTurnStream({
      conversationId: input.conversationId,
      userContent: input.userContent,
      model: runtimeModel(input.model),
      runtimeConfig: runtimeConfig(input.runtimeConfig),
      tools: TOOL_DEFINITIONS
        .filter(definition => !this.workspaces || this.workspaces.cloud.configured || !WORKSPACE_TOOL_NAMES.includes(definition.name))
        .map(definition => ({ name: definition.name, description: definition.description, inputSchema: definition.input.schema })),
      instructions: input.instructions,
      ...(input.reasoningEffort === undefined ? {} : { reasoningEffort: input.reasoningEffort }),
      ...(input.signal ? { signal: input.signal } : {}),
    })
  }
}
