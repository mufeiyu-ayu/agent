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

  async listMessages(conversationId: string): Promise<Message[]> {
    await this.assertConversationExists(conversationId)

    return this.prismaService.message.findMany({
      where: {
        conversationId,
      },
      orderBy: {
        createdAt: 'asc',
      },
    })
  }

  async createUserMessage(
    conversationId: string,
    input: CreateMessageDto,
  ): Promise<Message> {
    return this.createMessage(conversationId, MessageRole.USER, input)
  }

  async createAssistantMessage(
    conversationId: string,
    input: CreateMessageDto,
  ): Promise<Message> {
    return this.createMessage(conversationId, MessageRole.ASSISTANT, input)
  }

  private async createMessage(
    conversationId: string,
    role: PrismaMessageRole,
    input: CreateMessageDto,
  ): Promise<Message> {
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

      return message
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
