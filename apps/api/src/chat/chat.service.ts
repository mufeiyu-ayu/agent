import type { ChatStreamEvent } from '@agent/contracts'
import type { ChatDto } from './dto/chat.dto.js'
import { Inject, Injectable } from '@nestjs/common'

import { AgentRuntimeService } from '../agent-runtime/agent-runtime.service.js'
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
  ) {}

  async* chatStream(
    input: ChatDto,
    options: ChatStreamOptions = {},
  ): AsyncGenerator<ChatStreamEvent> {
    const runtimeEvents = this.agentRuntimeService.runTurnStream({
      conversationId: input.conversationId,
      userContent: input.message,
      ...(input.model ? { model: input.model } : {}),
      ...(input.reasoningEffort
        ? { reasoningEffort: input.reasoningEffort }
        : {}),
      ...(options.signal ? { signal: options.signal } : {}),
      /** 系统提示词 */
      instructions: AGENT_INSTRUCTIONS,
    })

    for await (const event of runtimeEvents)
      yield toChatStreamEvent(event)
  }
}
