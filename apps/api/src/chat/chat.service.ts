import type { ChatStreamEvent, ReasoningEffort } from '@agent/contracts'
import type { ChatDto } from './dto/chat.dto.js'
import { BadRequestException, Inject, Injectable } from '@nestjs/common'

import { AgentRuntimeService } from '../agent-runtime/agent-runtime.service.js'
import { LlmModelConfigService } from '../llm/llm-model-config.service.js'
import { LlmModelUnavailableError } from '../llm/llm.errors.js'
import { toChatStreamEvent } from './chat-stream-event.mapper.js'
import { AGENT_INSTRUCTIONS } from './prompts/agent.prompt.js'

interface ChatStreamOptions {
  signal?: AbortSignal
}

@Injectable()
export class ChatService {
  constructor(
    @Inject(AgentRuntimeService)
    private readonly agentRuntimeService: AgentRuntimeService,
    @Inject(LlmModelConfigService)
    private readonly llmModelConfigService: LlmModelConfigService,
  ) {}

  /**
   * 先解析模型行再返回事件流：模型不可用要在写出 NDJSON 头之前变成 400，
   * 所以这里不是 async generator，而是解析完成后再交出 generator。
   */
  async chatStream(
    input: ChatDto,
    options: ChatStreamOptions = {},
  ): Promise<AsyncGenerator<ChatStreamEvent>> {
    const model = await this.resolveModel(input.model, input.reasoningEffort)

    return this.mapRuntimeEvents(this.agentRuntimeService.runTurnStream({
      conversationId: input.conversationId,
      userContent: input.message,
      model,
      ...(input.reasoningEffort
        ? { reasoningEffort: input.reasoningEffort }
        : {}),
      ...(options.signal ? { signal: options.signal } : {}),
      /** 系统提示词 */
      instructions: AGENT_INSTRUCTIONS,
    }))
  }

  private async resolveModel(modelId: string | undefined, reasoningEffort?: ReasoningEffort) {
    try {
      return await this.llmModelConfigService.resolveModel(modelId, reasoningEffort)
    }
    catch (error) {
      if (error instanceof LlmModelUnavailableError)
        throw new BadRequestException(error.message)

      throw error
    }
  }

  private async* mapRuntimeEvents(
    runtimeEvents: AsyncGenerator<Parameters<typeof toChatStreamEvent>[0]>,
  ): AsyncGenerator<ChatStreamEvent> {
    for await (const event of runtimeEvents)
      yield toChatStreamEvent(event)
  }
}
