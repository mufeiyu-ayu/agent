import type {
  AdminRunDetail,
  AdminRunListResponse,
  AgentRunStatus,
} from '@agent/contracts'
import type { ListAdminRunsQueryDto } from './dto/admin-runs.dto.js'
import type { AdminRunListStepRecord } from './projection/admin-run.projector.js'
import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common'

import { AGENT_STEP_TYPES } from '../agent-runtime/lifecycle/agent-run-recorder.service.js'
import { Prisma } from '../generated/prisma/client.js'
import { PrismaService } from '../prisma/prisma.service.js'
import { resolveAdminModelRefs } from './admin-model-refs.js'
import {
  projectAdminRunDetail,
  projectAdminRunListItem,
  readRunModelKey,
} from './projection/admin-run.projector.js'

const DEFAULT_PAGE = 1
const DEFAULT_PAGE_SIZE = 20

/** 列表页读取的 Run 列；Step 另由 `loadListSteps` 只取需要的 JSON 路径。 */
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
} as const satisfies Prisma.AgentRunSelect

/** 列表统计需要的 Step 类型；grounded finalization 的 attempt 也是真实模型调用。 */
const LIST_STEP_TYPES = [
  AGENT_STEP_TYPES.modelSampling,
  AGENT_STEP_TYPES.toolExecution,
  AGENT_STEP_TYPES.groundedFinalization,
]

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

    const [runRows, statusGroups] = await Promise.all([
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
    const stepsByRun = await this.loadListSteps(runRows.map(run => run.id))
    const runs = runRows.map(run => ({ ...run, steps: stepsByRun.get(run.id) ?? [] }))
    const models = await resolveAdminModelRefs(
      this.prismaService,
      runs.map(run => readRunModelKey(run.steps)),
    )

    return {
      items: runs.map((run, index) => projectAdminRunListItem(run, models[index] ?? null)),
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

    const [model] = await resolveAdminModelRefs(this.prismaService, [readRunModelKey(run.steps)])

    return projectAdminRunDetail(run, model ?? null)
  }

  /**
   * 列表页的 Step 行：采样 Step 只取 usage / errorCode 与模型快照，finalization 只取 attempts，
   * 另带失败 / 中断 Run 在终态事务里收口的 Step（取失败文案）；不读整列 output，
   * debug 捕获（单条可达数十 KB）不出数据库。
   */
  private async loadListSteps(
    runIds: string[],
  ): Promise<Map<string, AdminRunListStepRecord[]>> {
    if (runIds.length === 0)
      return new Map()

    const rows = await this.prismaService.$queryRaw<Array<AdminRunListStepRecord & { runId: string }>>(Prisma.sql`
      SELECT
        s."runId",
        s."sequence",
        s."type",
        s."status"::text AS "status",
        s."errorMessage",
        s."endedAt",
        CASE WHEN s."type" = ${AGENT_STEP_TYPES.modelSampling}
          THEN jsonb_build_object('initialContext', s."input" -> 'initialContext')
        END AS "input",
        CASE s."type"
          WHEN ${AGENT_STEP_TYPES.modelSampling}
            THEN jsonb_build_object('usage', s."output" -> 'usage', 'errorCode', s."output" -> 'errorCode')
          WHEN ${AGENT_STEP_TYPES.groundedFinalization}
            THEN jsonb_build_object('attempts', s."output" -> 'attempts')
        END AS "output"
      FROM "AgentStep" s
      JOIN "AgentRun" r ON r."id" = s."runId"
      WHERE s."runId" = ANY(${runIds})
        AND (
          s."type" IN (${Prisma.join(LIST_STEP_TYPES)})
          OR (s."errorMessage" IS NOT NULL AND r."status" IN ('FAILED', 'ABORTED') AND s."endedAt" = r."endedAt")
        )
    `)
    const stepsByRun = new Map<string, AdminRunListStepRecord[]>()

    for (const { runId, ...step } of rows) {
      const steps = stepsByRun.get(runId) ?? []
      steps.push(step)
      stepsByRun.set(runId, steps)
    }

    return stepsByRun
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
    ...(input.errorCode ? { errorCode: input.errorCode } : {}),
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
