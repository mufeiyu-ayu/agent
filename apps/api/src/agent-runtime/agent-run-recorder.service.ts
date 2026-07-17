import type { AgentRun, AgentStep, Prisma } from '../generated/prisma/client.js'
import { Inject, Injectable } from '@nestjs/common'

import { AgentRunStatus, AgentStepStatus } from '../generated/prisma/client.js'
import { PrismaService } from '../prisma/prisma.service.js'

export const AGENT_STEP_TYPES = {
  receiveUserMessage: 'receive_user_message',
  loadConversationHistory: 'load_conversation_history',
  modelSampling: 'model_sampling',
  toolExecution: 'tool_execution',
  assistantOutput: 'assistant_output',
} as const

export type AgentStepType = typeof AGENT_STEP_TYPES[keyof typeof AGENT_STEP_TYPES]

const AGENT_STEP_TITLES: Record<AgentStepType, string> = {
  receive_user_message: '接收用户消息',
  load_conversation_history: '加载会话上下文',
  model_sampling: '模型采样',
  tool_execution: '执行工具',
  assistant_output: '生成助手回复',
}

const UNFINISHED_STEP_STATUSES = [
  AgentStepStatus.PENDING,
  AgentStepStatus.RUNNING,
]

interface CreateAgentRunInput {
  conversationId: string
  userMessageId: string
}

interface StartAgentStepInput {
  runId: string
  type: AgentStepType
  input?: Prisma.InputJsonValue
}

interface CompleteAgentStepInput {
  output?: Prisma.InputJsonValue
}

interface FailAgentStepInput extends CompleteAgentStepInput {
  errorMessage: string
}

interface AbortAgentStepInput extends CompleteAgentStepInput {
  errorMessage?: string
}

export class RecorderInvariantError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RecorderInvariantError'
  }
}

@Injectable()
export class AgentRunRecorderService {
  constructor(
    @Inject(PrismaService)
    private readonly prismaService: PrismaService,
  ) {}

  async createRun(input: CreateAgentRunInput): Promise<AgentRun> {
    const now = new Date()

    return await this.prismaService.agentRun.create({
      data: {
        conversationId: input.conversationId,
        userMessageId: input.userMessageId,
        status: AgentRunStatus.RUNNING,
        startedAt: now,
      },
    })
  }

  async attachAssistantMessage(runId: string, assistantMessageId: string): Promise<void> {
    const result = await this.prismaService.agentRun.updateMany({
      where: {
        id: runId,
        status: AgentRunStatus.RUNNING,
      },
      data: {
        assistantMessageId,
      },
    })

    this.assertSingleUpdate(result.count, `AgentRun ${runId} 无法关联助手消息`)
  }

  async startStep(input: StartAgentStepInput): Promise<AgentStep> {
    return await this.prismaService.$transaction(async (prisma) => {
      await this.assertRunningRunLocked(prisma, input.runId)
      const sequence = await this.nextStepSequence(prisma, input.runId)
      const now = new Date()

      return await prisma.agentStep.create({
        data: {
          runId: input.runId,
          sequence,
          type: input.type,
          title: AGENT_STEP_TITLES[input.type],
          status: AgentStepStatus.RUNNING,
          ...(input.input === undefined ? {} : { input: input.input }),
          startedAt: now,
        },
      })
    })
  }

  async completeStep(
    stepId: string,
    input: CompleteAgentStepInput = {},
  ): Promise<void> {
    await this.transitionStep(stepId, AgentStepStatus.COMPLETED, input)
  }

  async failStep(stepId: string, input: FailAgentStepInput): Promise<void> {
    await this.transitionStep(stepId, AgentStepStatus.FAILED, input)
  }

  async abortStep(
    stepId: string,
    input: AbortAgentStepInput = {},
  ): Promise<void> {
    await this.transitionStep(stepId, AgentStepStatus.ABORTED, input)
  }

  async completeRun(runId: string): Promise<void> {
    await this.prismaService.$transaction(async (prisma) => {
      await this.assertRunningRunLocked(prisma, runId)
      const unfinishedStepCount = await prisma.agentStep.count({
        where: {
          runId,
          status: {
            in: UNFINISHED_STEP_STATUSES,
          },
        },
      })

      if (unfinishedStepCount > 0) {
        throw new RecorderInvariantError(
          `AgentRun ${runId} 仍有 ${unfinishedStepCount} 条非终态 Step，不能完成`,
        )
      }

      await this.transitionRun(prisma, runId, AgentRunStatus.COMPLETED)
    })
  }

  async failRun(runId: string, errorMessage: string): Promise<void> {
    await this.closeRunAndUnfinishedSteps(
      runId,
      AgentRunStatus.FAILED,
      AgentStepStatus.FAILED,
      errorMessage,
    )
  }

  async abortRun(runId: string): Promise<void> {
    await this.closeRunAndUnfinishedSteps(
      runId,
      AgentRunStatus.ABORTED,
      AgentStepStatus.ABORTED,
    )
  }

  private async transitionStep(
    stepId: string,
    status: typeof AgentStepStatus.COMPLETED | typeof AgentStepStatus.FAILED | typeof AgentStepStatus.ABORTED,
    input: CompleteAgentStepInput & { errorMessage?: string },
  ): Promise<void> {
    await this.prismaService.$transaction(async (prisma) => {
      const step = await prisma.agentStep.findUnique({
        where: { id: stepId },
        select: { runId: true },
      })

      if (!step)
        throw new RecorderInvariantError(`AgentStep ${stepId} 不存在`)

      await this.assertRunningRunLocked(prisma, step.runId)
      const result = await prisma.agentStep.updateMany({
        where: {
          id: stepId,
          status: AgentStepStatus.RUNNING,
        },
        data: {
          status,
          ...(input.output === undefined ? {} : { output: input.output }),
          ...(input.errorMessage === undefined ? {} : { errorMessage: input.errorMessage }),
          endedAt: new Date(),
        },
      })

      this.assertSingleUpdate(result.count, `AgentStep ${stepId} 已进入终态或尚未开始`)
    })
  }

  private async closeRunAndUnfinishedSteps(
    runId: string,
    runStatus: typeof AgentRunStatus.FAILED | typeof AgentRunStatus.ABORTED,
    stepStatus: typeof AgentStepStatus.FAILED | typeof AgentStepStatus.ABORTED,
    errorMessage?: string,
  ): Promise<void> {
    await this.prismaService.$transaction(async (prisma) => {
      await this.assertRunningRunLocked(prisma, runId)
      const now = new Date()

      await prisma.agentStep.updateMany({
        where: {
          runId,
          status: {
            in: UNFINISHED_STEP_STATUSES,
          },
        },
        data: {
          status: stepStatus,
          ...(errorMessage === undefined ? {} : { errorMessage }),
          endedAt: now,
        },
      })

      await this.transitionRun(prisma, runId, runStatus, now)
    })
  }

  private async transitionRun(
    prisma: Prisma.TransactionClient,
    runId: string,
    status: typeof AgentRunStatus.COMPLETED | typeof AgentRunStatus.FAILED | typeof AgentRunStatus.ABORTED,
    endedAt = new Date(),
  ): Promise<void> {
    const result = await prisma.agentRun.updateMany({
      where: {
        id: runId,
        status: AgentRunStatus.RUNNING,
      },
      data: {
        status,
        endedAt,
      },
    })

    this.assertSingleUpdate(result.count, `AgentRun ${runId} 已进入终态或不存在`)
  }

  private async assertRunningRunLocked(
    prisma: Prisma.TransactionClient,
    runId: string,
  ): Promise<void> {
    const runs = await prisma.$queryRaw<Array<Pick<AgentRun, 'id' | 'status'>>>`
      SELECT "id", "status"
      FROM "AgentRun"
      WHERE "id" = ${runId}
      FOR UPDATE
    `

    if (runs[0]?.status !== AgentRunStatus.RUNNING)
      throw new RecorderInvariantError(`AgentRun ${runId} 已进入终态或不存在`)
  }

  private async nextStepSequence(
    prisma: Prisma.TransactionClient,
    runId: string,
  ): Promise<number> {
    const result = await prisma.agentStep.aggregate({
      where: { runId },
      _max: { sequence: true },
    })

    return (result._max.sequence ?? 0) + 1
  }

  private assertSingleUpdate(count: number, message: string): void {
    if (count !== 1)
      throw new RecorderInvariantError(message)
  }
}
