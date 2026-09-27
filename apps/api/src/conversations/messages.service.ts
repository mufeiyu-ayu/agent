import type { ConversationMessage } from '@agent/contracts'
import type { Message } from '../generated/prisma/client.js'
import { Inject, Injectable } from '@nestjs/common'

import { PrismaService } from '../prisma/prisma.service.js'
import { ConversationsService } from './conversations.service.js'

@Injectable()
export class MessagesService {
  constructor(
    @Inject(PrismaService)
    private readonly prismaService: PrismaService,
    @Inject(ConversationsService)
    private readonly conversationsService: ConversationsService,
  ) {}

  async listMessages(userId: string, conversationId: string): Promise<ConversationMessage[]> {
    await this.conversationsService.assertOwnConversation(userId, conversationId)

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
