import type {
  Conversation,
  DeleteConversationResponse,
  ListConversationsResponse,
} from '@agent/contracts'
import type { Conversation as PrismaConversation } from '../generated/prisma/client.js'
import type { CreateConversationDto, ListConversationsQueryDto, UpdateConversationDto } from './dto/conversation.dto.js'
import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common'

import { PrismaService } from '../prisma/prisma.service.js'
import { WorkspaceCloudService } from '../workspaces/workspace-cloud.service.js'
import { lockWorkspaceStorage, workspaceDb } from '../workspaces/workspace-db.js'
import { WorkspaceGcService } from '../workspaces/workspace-gc.service.js'

const DEFAULT_CONVERSATION_TITLE = '新的会话'
const DEFAULT_CONVERSATION_PAGE_SIZE = 20
const MAX_CONVERSATION_PAGE_SIZE = 50

@Injectable()
export class ConversationsService {
  constructor(
    @Inject(PrismaService)
    private readonly prismaService: PrismaService,
    @Inject(WorkspaceGcService) private readonly gc = new WorkspaceGcService(prismaService, new WorkspaceCloudService()),
  ) {}

  async create(userId: string, input: CreateConversationDto): Promise<Conversation> {
    const title = normalizeConversationTitle(input.title)

    const conversation = await this.prismaService.conversation.create({
      data: {
        title,
        userId,
      },
    })

    return toConversationResponse(conversation)
  }

  async list(userId: string, input: ListConversationsQueryDto): Promise<ListConversationsResponse> {
    const limit = normalizeConversationPageSize(input.limit)
    const cursor = input.cursor?.trim()

    if (cursor) {
      await this.assertOwnConversation(userId, cursor)
    }

    const conversations = await this.prismaService.conversation.findMany({
      where: {
        userId,
        messages: {
          some: {},
        },
      },
      orderBy: [
        { updatedAt: 'desc' },
        { id: 'desc' },
      ],
      take: limit + 1,
      ...(cursor
        ? {
            cursor: { id: cursor },
            skip: 1,
          }
        : {}),
    })
    const items = conversations.slice(0, limit)

    return {
      items: items.map(toConversationResponse),
      nextCursor: conversations.length > limit
        ? items.at(-1)?.id ?? null
        : null,
    }
  }

  async update(userId: string, conversationId: string, input: UpdateConversationDto): Promise<Conversation> {
    const title = input.title.trim()

    if (!title) {
      throw new BadRequestException('会话标题不能为空')
    }

    await this.assertOwnConversation(userId, conversationId)

    const conversation = await this.prismaService.conversation.update({
      where: {
        id: conversationId,
      },
      data: {
        title,
      },
    })

    return toConversationResponse(conversation)
  }

  async delete(userId: string, conversationId: string): Promise<DeleteConversationResponse> {
    await this.assertOwnConversation(userId, conversationId)

    await workspaceDb(this.prismaService, async (db) => {
      await lockWorkspaceStorage(db, conversationId)
      const own = await db.conversation.findFirst({ where: { id: conversationId, userId } })
      if (!own)
        throw new NotFoundException('会话不存在或已被删除')
      await this.gc.register(db, userId, conversationId, new Date())
      await db.conversation.delete({ where: { id: conversationId } })
    })
    this.gc.kick(conversationId)

    return {
      deleted: true,
      id: conversationId,
    }
  }

  /** 别人的会话与不存在的会话同样 404，不暴露存在性；messages 与 chat/stream 共用。 */
  async assertOwnConversation(userId: string, conversationId: string): Promise<void> {
    const conversation = await this.prismaService.conversation.findFirst({
      where: {
        id: conversationId,
        userId,
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

function normalizeConversationPageSize(limit: number | undefined): number {
  const numericLimit = Number(limit ?? DEFAULT_CONVERSATION_PAGE_SIZE)

  if (!Number.isFinite(numericLimit))
    return DEFAULT_CONVERSATION_PAGE_SIZE

  return Math.min(
    Math.max(Math.trunc(numericLimit), 1),
    MAX_CONVERSATION_PAGE_SIZE,
  )
}

function toConversationResponse(conversation: PrismaConversation): Conversation {
  return {
    id: conversation.id,
    title: conversation.title,
    createdAt: conversation.createdAt.toISOString(),
    updatedAt: conversation.updatedAt.toISOString(),
  }
}
