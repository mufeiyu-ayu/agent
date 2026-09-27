import type {
  AdminConversationDetail,
  AdminConversationListResponse,
} from '@agent/contracts'
import type { Prisma } from '../generated/prisma/client.js'
import type { ListAdminConversationsQueryDto } from './dto/admin-conversations.dto.js'
import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common'

import { PrismaService } from '../prisma/prisma.service.js'

const DEFAULT_PAGE = 1
const DEFAULT_PAGE_SIZE = 20
const USER_SELECT = { select: { id: true, email: true, name: true, avatarUrl: true } } as const

@Injectable()
export class AdminConversationsService {
  constructor(
    @Inject(PrismaService)
    private readonly prismaService: PrismaService,
  ) {}

  async list(input: ListAdminConversationsQueryDto): Promise<AdminConversationListResponse> {
    const page = input.page ?? DEFAULT_PAGE
    const pageSize = input.pageSize ?? DEFAULT_PAGE_SIZE
    const where = createConversationWhere(input)

    const [conversations, totalItems] = await Promise.all([
      this.prismaService.conversation.findMany({
        where,
        orderBy: [
          { updatedAt: 'desc' },
          { id: 'desc' },
        ],
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          title: true,
          createdAt: true,
          updatedAt: true,
          user: USER_SELECT,
          _count: {
            select: {
              messages: true,
              agentRuns: true,
            },
          },
        },
      }),
      this.prismaService.conversation.count({ where }),
    ])

    return {
      items: conversations.map(conversation => ({
        id: conversation.id,
        title: conversation.title,
        user: conversation.user,
        messageCount: conversation._count.messages,
        runCount: conversation._count.agentRuns,
        createdAt: conversation.createdAt.toISOString(),
        updatedAt: conversation.updatedAt.toISOString(),
      })),
      pagination: {
        page,
        pageSize,
        totalItems,
        totalPages: totalItems === 0 ? 0 : Math.ceil(totalItems / pageSize),
      },
    }
  }

  async getDetail(conversationId: string): Promise<AdminConversationDetail> {
    // 会话级 transcript 只投影用户可见 Message 字段（完整 content），
    // 不触碰 AgentStep / prompt / 工具数据；run 级 500 字 preview 投影保持不变。
    // ponytail: 一次性返回全部消息，学习阶段单人使用；消息量大了再做分页。
    const conversation = await this.prismaService.conversation.findUnique({
      where: {
        id: conversationId,
      },
      select: {
        id: true,
        title: true,
        createdAt: true,
        updatedAt: true,
        user: USER_SELECT,
        messages: {
          // 同毫秒消息用 id 兜底，保证 transcript 顺序确定。
          orderBy: [
            { createdAt: 'asc' },
            { id: 'asc' },
          ],
          select: {
            id: true,
            role: true,
            status: true,
            content: true,
            createdAt: true,
          },
        },
        _count: {
          select: {
            agentRuns: true,
          },
        },
      },
    })

    if (!conversation)
      throw new NotFoundException('会话不存在或已被删除')

    return {
      id: conversation.id,
      title: conversation.title,
      user: conversation.user,
      runCount: conversation._count.agentRuns,
      createdAt: conversation.createdAt.toISOString(),
      updatedAt: conversation.updatedAt.toISOString(),
      messages: conversation.messages.map(message => ({
        id: message.id,
        role: message.role,
        status: message.status,
        content: message.content,
        createdAt: message.createdAt.toISOString(),
      })),
    }
  }
}

/** 不存在的 userId 不报错，按条件查出空列表。 */
function createConversationWhere(input: ListAdminConversationsQueryDto): Prisma.ConversationWhereInput {
  const dateFrom = input.dateFrom ? new Date(input.dateFrom) : undefined
  const dateTo = input.dateTo ? new Date(input.dateTo) : undefined

  if (dateFrom && dateTo && dateFrom > dateTo)
    throw new BadRequestException('dateFrom 不能晚于 dateTo')

  return {
    ...(input.userId ? { userId: input.userId } : {}),
    ...(dateFrom || dateTo
      ? {
          updatedAt: {
            ...(dateFrom ? { gte: dateFrom } : {}),
            ...(dateTo ? { lte: dateTo } : {}),
          },
        }
      : {}),
  }
}
