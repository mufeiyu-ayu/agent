import type { ChatStreamEvent, SeoChatResponse } from '@agent/contracts'
import type { RunTurnStreamInput } from '../agent-runtime/agent-runtime.types.js'
import type { SeoChatDto } from './dto/seo-chat.dto.js'
import {
  Inject,
  Injectable,
  InternalServerErrorException,
  RequestTimeoutException,
  ServiceUnavailableException,
} from '@nestjs/common'

import { AgentRuntimeService } from '../agent-runtime/agent-runtime.service.js'
import { toChatStreamEvent } from './seo-chat-stream-event.mapper.js'
import { SeoContextBuilder } from './seo-context-builder.service.js'

const CHAT_HISTORY_LIMIT = 12

interface SeoChatStreamOptions {
  signal?: AbortSignal
}

@Injectable()
export class SeoService {
  constructor(
    @Inject(AgentRuntimeService)
    private readonly agentRuntimeService: AgentRuntimeService,

    @Inject(SeoContextBuilder)
    private readonly seoContextBuilder: SeoContextBuilder,
  ) {}

  async chat(input: SeoChatDto): Promise<SeoChatResponse> {
    const runtimeEvents = this.agentRuntimeService.runTurnStream(
      this.buildRunTurnInput(input),
    )

    for await (const event of runtimeEvents) {
      switch (event.type) {
        case 'run_completed':
          return {
            reply: event.content,
            generatedAt: event.generatedAt,
          }

        case 'run_failed':
          throw new ServiceUnavailableException(
            '模型服务暂时没有返回结果，请稍后重试。',
          )

        case 'run_aborted':
          throw new RequestTimeoutException('请求已中止，请重新发起。')

        case 'run_started':
        case 'assistant_delta':
          break
      }
    }

    throw new InternalServerErrorException('请求未能完成，请稍后重试。')
  }

  async* chatStream(
    input: SeoChatDto,
    options: SeoChatStreamOptions = {},
  ): AsyncGenerator<ChatStreamEvent> {
    const runtimeEvents = this.agentRuntimeService.runTurnStream(
      this.buildRunTurnInput(input, options.signal),
    )

    for await (const event of runtimeEvents)
      yield toChatStreamEvent(event)
  }

  private buildRunTurnInput(
    input: SeoChatDto,
    signal?: AbortSignal,
  ): RunTurnStreamInput {
    return {
      conversationId: input.conversationId,
      userContent: input.message,
      ...(input.model ? { model: input.model } : {}),
      ...(signal ? { signal } : {}),
      historyLimit: CHAT_HISTORY_LIMIT,
      temperature: 0.4,
      maxTokens: 1200,
      buildModelMessages: historyMessages =>
        this.seoContextBuilder.buildModelMessages({ historyMessages }),
    }
  }
}
