import type { ChatStreamEvent, SeoChatResponse } from '@agent/contracts'
import type {
  Message,
  MessageRole as PrismaMessageRole,
  MessageStatus as PrismaMessageStatus,
} from '../generated/prisma/client.js'
import type { ChatMessage } from '../llm/llm.types.js'
import type { SeoChatDto } from './dto/seo-chat.dto.js'
import { Inject, Injectable, NotFoundException } from '@nestjs/common'

import { AgentRuntimeService } from '../agent-runtime/agent-runtime.service.js'
import { MessageRole, MessageStatus } from '../generated/prisma/client.js'
import { LLMService } from '../llm/llm.service.js'
import { PrismaService } from '../prisma/prisma.service.js'
import { toChatStreamEvent } from './seo-chat-stream-event.mapper.js'
import { SeoContextBuilder } from './seo-context-builder.service.js'

const CHAT_HISTORY_LIMIT = 12

interface SeoChatStreamOptions {
  signal?: AbortSignal
}

@Injectable()
export class SeoService {
  constructor(
    @Inject(LLMService)
    private readonly llmService: LLMService,

    @Inject(PrismaService)
    private readonly prismaService: PrismaService,

    @Inject(AgentRuntimeService)
    private readonly agentRuntimeService: AgentRuntimeService,

    @Inject(SeoContextBuilder)
    private readonly seoContextBuilder: SeoContextBuilder,
  ) {}

  async chat(input: SeoChatDto): Promise<SeoChatResponse> {
    await this.assertConversationExists(input.conversationId)

    await this.createMessageAndTouchConversation(
      input.conversationId,
      MessageRole.USER,
      input.message.trim(),
    )

    const historyMessages = await this.listRecentChatMessages(input.conversationId)
    const llmMessages = this.seoContextBuilder.buildModelMessages({
      historyMessages: historyMessages.map(message => this.toLlmMessage(message)),
    })

    let reply: string

    try {
      reply = await this.llmService.chat(llmMessages, {
        ...(input.model ? { model: input.model } : {}),
        temperature: 0.4,
        maxTokens: 1200,
      })
    }
    catch (error) {
      await this.createMessageAndTouchConversation(
        input.conversationId,
        MessageRole.ASSISTANT,
        '模型服务暂时没有返回结果，请稍后重试。',
        MessageStatus.FAILED,
      )

      throw error
    }

    const assistantMessage = await this.createMessageAndTouchConversation(
      input.conversationId,
      MessageRole.ASSISTANT,
      reply,
    )

    return {
      reply,
      generatedAt: assistantMessage.createdAt.toISOString(),
    }
  }

  async* chatStream(
    input: SeoChatDto,
    options: SeoChatStreamOptions = {},
  ): AsyncGenerator<ChatStreamEvent> {
    const runtimeEvents = this.agentRuntimeService.runTurnStream({
      conversationId: input.conversationId,
      userContent: input.message,
      ...(input.model ? { model: input.model } : {}),
      ...(options.signal ? { signal: options.signal } : {}),
      historyLimit: CHAT_HISTORY_LIMIT,
      temperature: 0.4,
      maxTokens: 1200,
      buildModelMessages: historyMessages =>
        this.seoContextBuilder.buildModelMessages({ historyMessages }),
    })

    for await (const event of runtimeEvents) {
      yield toChatStreamEvent(event)
    }
  }

  private async listRecentChatMessages(conversationId: string): Promise<Message[]> {
    const messages = await this.prismaService.message.findMany({
      where: {
        conversationId,
      },
      orderBy: {
        createdAt: 'desc',
      },
      take: CHAT_HISTORY_LIMIT,
    })

    return messages.reverse()
  }

  private async createMessageAndTouchConversation(
    conversationId: string,
    role: PrismaMessageRole,
    content: string,
    status: PrismaMessageStatus = MessageStatus.COMPLETED,
  ): Promise<Message> {
    return this.prismaService.$transaction(async (prisma) => {
      const message = await prisma.message.create({
        data: {
          conversationId,
          role,
          content,
          status,
        },
      })

      await prisma.conversation.update({
        where: {
          id: conversationId,
        },
        data: {
          updatedAt: new Date(),
        },
      })

      return message
    })
  }

  private toLlmMessage(message: Message): ChatMessage {
    return {
      role: this.toLlmRole(message.role),
      content: message.content,
    }
  }

  private toLlmRole(role: PrismaMessageRole): ChatMessage['role'] {
    switch (role) {
      case MessageRole.USER:
        return 'user'
      case MessageRole.ASSISTANT:
        return 'assistant'
    }
  }

  private async assertConversationExists(conversationId: string): Promise<void> {
    const conversation = await this.prismaService.conversation.findUnique({
      where: {
        id: conversationId,
      },
      select: {
        id: true,
      },
    })

    if (!conversation) {
      throw new NotFoundException('会话不存在或已被删除')
    }
  }
}
