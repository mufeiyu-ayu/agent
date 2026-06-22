import type { Conversation } from '../generated/prisma/client.js'
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
}

function normalizeConversationTitle(title: string | undefined): string {
  const nextTitle = title?.trim()

  return nextTitle || DEFAULT_CONVERSATION_TITLE
}
