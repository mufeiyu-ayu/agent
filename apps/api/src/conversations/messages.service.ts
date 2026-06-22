import type { ConversationMessage } from '@agent/contracts'
import type { Message, MessageRole as PrismaMessageRole } from '../generated/prisma/client.js'
import type { CreateMessageDto } from './dto/message.dto.js'
import { Inject, Injectable, NotFoundException } from '@nestjs/common'

import { MessageRole } from '../generated/prisma/client.js'
import { PrismaService } from '../prisma/prisma.service.js'

@Injectable()
export class MessagesService {
  constructor(
    @Inject(PrismaService)
    private readonly prismaService: PrismaService,
  ) {}

  async listMessages(conversationId: string): Promise<ConversationMessage[]> {
    await this.assertConversationExists(conversationId)

    const messages = await this.prismaService.message.findMany({
      where: {
        conversationId,
      },
      orderBy: {
        createdAt: 'asc',
      },
    })

    return messages.map(toConversationMessageResponse)
  }

  async createUserMessage(
    conversationId: string,
    input: CreateMessageDto,
  ): Promise<ConversationMessage> {
    return this.createMessage(conversationId, MessageRole.USER, input)
  }

  async createAssistantMessage(
    conversationId: string,
    input: CreateMessageDto,
  ): Promise<ConversationMessage> {
    return this.createMessage(conversationId, MessageRole.ASSISTANT, input)
  }

  private async createMessage(
    conversationId: string,
    role: PrismaMessageRole,
    input: CreateMessageDto,
  ): Promise<ConversationMessage> {
    return this.prismaService.$transaction(async (prisma) => {
      await this.assertConversationExists(conversationId, prisma)

      const message = await prisma.message.create({
        data: {
          conversationId,
          role,
          content: input.content,
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

      return toConversationMessageResponse(message)
    })
  }

  private async assertConversationExists(
    conversationId: string,
    prisma: Pick<PrismaService, 'conversation'> = this.prismaService,
  ): Promise<void> {
    const conversation = await prisma.conversation.findUnique({
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

function toConversationMessageResponse(message: Message): ConversationMessage {
  return {
    id: message.id,
    conversationId: message.conversationId,
    role: message.role,
    content: message.content,
    status: message.status,
    createdAt: message.createdAt.toISOString(),
    updatedAt: message.updatedAt.toISOString(),
  }
}
