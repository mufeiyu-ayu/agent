import type { ConversationMessage } from '@agent/contracts'
import type { Message, MessageGrounding } from '../generated/prisma/client.js'
import { Inject, Injectable, NotFoundException } from '@nestjs/common'

import { toMessageGroundingV1 } from '../agent-runtime/grounding/message-grounding.projector.js'
import { PrismaService } from '../prisma/prisma.service.js'

type MessageWithGrounding = Message & {
  grounding: MessageGrounding | null
}

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
      include: {
        grounding: true,
      },
    })

    return messages.map(toConversationMessageResponse)
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

export function toConversationMessageResponse(
  message: MessageWithGrounding,
): ConversationMessage {
  return {
    id: message.id,
    conversationId: message.conversationId,
    role: message.role,
    content: message.content,
    status: message.status,
    createdAt: message.createdAt.toISOString(),
    updatedAt: message.updatedAt.toISOString(),
    // 与 done.grounding 共用同一个 projector：页面重载得到的是同一份事实；
    // legacy Message 没有 Grounding 行，损坏数据在投影层 fail closed，都返回 null。
    grounding: toMessageGroundingV1(message.grounding),
  }
}
