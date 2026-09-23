import type {
  AdminRunDetail,
  AdminRunListResponse,
  AgentRunStatus,
} from '@agent/contracts'
import type { Prisma } from '../generated/prisma/client.js'
import type { ListAdminRunsQueryDto } from './dto/admin-runs.dto.js'
import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common'

import { AGENT_STEP_TYPES } from '../agent-runtime/lifecycle/agent-run-recorder.service.js'
import { PrismaService } from '../prisma/prisma.service.js'
import {
  projectAdminRunDetail,
  projectAdminRunListItem,
} from './projection/admin-run.projector.js'

const DEFAULT_PAGE = 1
const DEFAULT_PAGE_SIZE = 20

/** 列表页读取的列；projector 的输入类型直接由它派生。 */
export const ADMIN_RUN_LIST_SELECT = {
  id: true,
  conversationId: true,
  status: true,
  errorCode: true,
  startedAt: true,
  endedAt: true,
  createdAt: true,
  userMessage: {
    select: {
      content: true,
    },
  },
  steps: {
    where: {
      type: {
        // grounded finalization 也是真实模型调用，必须喂给 projector，
        // 否则 Grounded Run 在列表页会系统性少算采样次数与 Token。
        in: [
          AGENT_STEP_TYPES.modelSampling,
          AGENT_STEP_TYPES.toolExecution,
          AGENT_STEP_TYPES.groundedFinalization,
        ],
      },
    },
    select: {
      sequence: true,
      type: true,
      status: true,
      input: true,
      output: true,
    },
  },
} as const satisfies Prisma.AgentRunSelect

export const ADMIN_RUN_DETAIL_SELECT = {
  id: true,
  conversationId: true,
  assistantMessageId: true,
  status: true,
  errorCode: true,
  startedAt: true,
  endedAt: true,
  createdAt: true,
  updatedAt: true,
  userMessage: {
    select: {
      id: true,
      role: true,
      status: true,
      content: true,
      createdAt: true,
      updatedAt: true,
    },
  },
  assistantMessage: {
    select: {
      id: true,
      role: true,
      status: true,
      content: true,
      createdAt: true,
      updatedAt: true,
      // MessageGrounding 整行读取：projector 只消费 `toOwnedMessageGroundingV1`
      // 需要的字段，归属与合法性仍在投影时复核；这里不再逐列列举 Message 持久化
      // 契约的字段名，Admin 读模型不承载它们。
      grounding: true,
    },
  },
  steps: {
    select: {
      id: true,
      sequence: true,
      type: true,
      title: true,
      status: true,
      input: true,
      output: true,
      errorMessage: true,
      startedAt: true,
      endedAt: true,
    },
  },
} as const satisfies Prisma.AgentRunSelect

@Injectable()
export class AdminRunsService {
  constructor(
    @Inject(PrismaService)
    private readonly prismaService: PrismaService,
  ) {}

  async list(input: ListAdminRunsQueryDto): Promise<AdminRunListResponse> {
    const page = input.page ?? DEFAULT_PAGE
    const pageSize = input.pageSize ?? DEFAULT_PAGE_SIZE
    const where = createRunWhere(input)

    const [runs, statusGroups] = await Promise.all([
      this.prismaService.agentRun.findMany({
        where,
        orderBy: [
          { createdAt: 'desc' },
          { id: 'desc' },
        ],
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: ADMIN_RUN_LIST_SELECT,
      }),
      this.prismaService.agentRun.groupBy({
        by: ['status'],
        where,
        _count: {
          _all: true,
        },
      }),
    ])
    const statusCounts: Record<AgentRunStatus, number> = {
      RUNNING: 0,
      COMPLETED: 0,
      FAILED: 0,
      ABORTED: 0,
    }

    for (const group of statusGroups)
      statusCounts[group.status] = group._count._all

    const totalItems = Object.values(statusCounts).reduce(
      (total, count) => total + count,
      0,
    )

    return {
      items: runs.map(projectAdminRunListItem),
      pagination: {
        page,
        pageSize,
        totalItems,
        totalPages: totalItems === 0 ? 0 : Math.ceil(totalItems / pageSize),
      },
      summary: {
        totalRuns: totalItems,
        statusCounts,
      },
    }
  }

  async getDetail(runId: string): Promise<AdminRunDetail> {
    const run = await this.prismaService.agentRun.findUnique({
      where: {
        id: runId,
      },
      select: ADMIN_RUN_DETAIL_SELECT,
    })

    if (!run)
      throw new NotFoundException('Agent Run 不存在或已被删除')

    return projectAdminRunDetail(run)
  }
}

function createRunWhere(input: ListAdminRunsQueryDto): Prisma.AgentRunWhereInput {
  const query = input.query?.trim()
  const dateFrom = input.dateFrom ? new Date(input.dateFrom) : undefined
  const dateTo = input.dateTo ? new Date(input.dateTo) : undefined

  if (dateFrom && dateTo && dateFrom > dateTo)
    throw new BadRequestException('dateFrom 不能晚于 dateTo')

  return {
    ...(input.status ? { status: input.status } : {}),
    ...(input.conversationId ? { conversationId: input.conversationId } : {}),
    ...(query
      ? {
          OR: [
            {
              id: {
                contains: query,
                mode: 'insensitive',
              },
            },
            {
              userMessage: {
                is: {
                  content: {
                    contains: query,
                    mode: 'insensitive',
                  },
                },
              },
            },
          ],
        }
      : {}),
    ...(dateFrom || dateTo
      ? {
          createdAt: {
            ...(dateFrom ? { gte: dateFrom } : {}),
            ...(dateTo ? { lte: dateTo } : {}),
          },
        }
      : {}),
  }
}
