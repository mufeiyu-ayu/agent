import type { Conversation, Message, MessageRole as PrismaMessageRole } from '../generated/prisma/client.js'
import type { CreateConversationDto } from './dto/conversation.dto.js'
import type { CreateMessageDto } from './dto/message.dto.js'
import { Inject, Injectable, NotFoundException } from '@nestjs/common'

import { MessageRole } from '../generated/prisma/client.js'
import { PrismaService } from '../prisma/prisma.service.js'

const DEFAULT_CONVERSATION_TITLE = '新的 SEO 会话'

@Injectable()
export class ConversationsService {
  constructor(
    @Inject(PrismaService)
    private readonly prismaService: PrismaService,
  ) {}

  async create(input: CreateConversationDto): Promise<Conversation> {
    const title = normalizeConversationTitle(input.title)

    return this.prismaService.conversation.create({
      data: {
        title,
      },
    })
  }

  async list(): Promise<Conversation[]> {
    return this.prismaService.conversation.findMany({
      orderBy: {
        updatedAt: 'desc',
      },
    })
  }

  async delete(conversationId: string): Promise<{ deleted: true, id: string }> {
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

    await this.prismaService.conversation.delete({
      where: {
        id: conversationId,
      },
    })

    return {
      deleted: true,
      id: conversationId,
    }
  }

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

function normalizeConversationTitle(title: string | undefined): string {
  const nextTitle = title?.trim()

  return nextTitle || DEFAULT_CONVERSATION_TITLE
}
