import type {
  Conversation,
  DeleteConversationResponse,
} from '@agent/contracts'
import type { Conversation as PrismaConversation } from '../generated/prisma/client.js'
import type { CreateConversationDto } from './dto/conversation.dto.js'
import { Inject, Injectable, NotFoundException } from '@nestjs/common'

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

    const conversation = await this.prismaService.conversation.create({
      data: {
        title,
      },
    })

    return toConversationResponse(conversation)
  }

  async list(): Promise<Conversation[]> {
    const conversations = await this.prismaService.conversation.findMany({
      orderBy: {
        updatedAt: 'desc',
      },
    })

    return conversations.map(toConversationResponse)
  }

  async delete(conversationId: string): Promise<DeleteConversationResponse> {
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
}

function normalizeConversationTitle(title: string | undefined): string {
  const nextTitle = title?.trim()

  return nextTitle || DEFAULT_CONVERSATION_TITLE
}

function toConversationResponse(conversation: PrismaConversation): Conversation {
  return {
    id: conversation.id,
    title: conversation.title,
    createdAt: conversation.createdAt.toISOString(),
    updatedAt: conversation.updatedAt.toISOString(),
  }
}
