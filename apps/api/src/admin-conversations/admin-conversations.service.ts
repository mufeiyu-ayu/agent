import type {
  AdminConversationDetail,
  AdminConversationListResponse,
} from '@agent/contracts'
import type { ListAdminConversationsQueryDto } from './dto/admin-conversations.dto.js'
import { Inject, Injectable, NotFoundException } from '@nestjs/common'

import { PrismaService } from '../prisma/prisma.service.js'

const DEFAULT_PAGE = 1
const DEFAULT_PAGE_SIZE = 20

@Injectable()
export class AdminConversationsService {
  constructor(
    @Inject(PrismaService)
    private readonly prismaService: PrismaService,
  ) {}

  async list(input: ListAdminConversationsQueryDto): Promise<AdminConversationListResponse> {
    const page = input.page ?? DEFAULT_PAGE
    const pageSize = input.pageSize ?? DEFAULT_PAGE_SIZE

    const [conversations, totalItems] = await Promise.all([
      this.prismaService.conversation.findMany({
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
          _count: {
            select: {
              messages: true,
              agentRuns: true,
            },
          },
        },
      }),
      this.prismaService.conversation.count(),
    ])

    return {
      items: conversations.map(conversation => ({
        id: conversation.id,
        title: conversation.title,
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
