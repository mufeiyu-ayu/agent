import type { AgentRun, Prisma } from '../generated/prisma/client.js'
import { Inject, Injectable, Logger } from '@nestjs/common'

import { AgentRunStatus, AgentStepStatus } from '../generated/prisma/client.js'
import { PrismaService } from '../prisma/prisma.service.js'

export const AGENT_STEP_TYPES = {
  receiveUserMessage: 'receive_user_message',
  loadConversationHistory: 'load_conversation_history',
  callLlm: 'call_llm',
  streamAssistantReply: 'stream_assistant_reply',
} as const

export type AgentStepType = typeof AGENT_STEP_TYPES[keyof typeof AGENT_STEP_TYPES]

const AGENT_STEP_TITLES: Record<AgentStepType, string> = {
  receive_user_message: '接收用户消息',
  load_conversation_history: '加载会话上下文',
  call_llm: '调用语言模型',
  stream_assistant_reply: '流式生成回复',
}

const UNFINISHED_STEP_STATUSES = [
  AgentStepStatus.PENDING,
  AgentStepStatus.RUNNING,
]

interface CreateAgentRunInput {
  conversationId: string
  userMessageId: string
  userMessageLength: number
}

interface StepUpdatePayload {
  input?: Prisma.InputJsonValue
  output?: Prisma.InputJsonValue
}

@Injectable()
export class AgentRunRecorderService {
  private readonly logger = new Logger(AgentRunRecorderService.name)

  constructor(
    @Inject(PrismaService)
    private readonly prismaService: PrismaService,
  ) {}

  async createRunWithInitialSteps(input: CreateAgentRunInput): Promise<AgentRun> {
    const now = new Date()

    return this.prismaService.$transaction(async (prisma) => {
      const run = await prisma.agentRun.create({
        data: {
          conversationId: input.conversationId,
          userMessageId: input.userMessageId,
          status: AgentRunStatus.RUNNING,
          startedAt: now,
        },
      })

      await prisma.agentStep.createMany({
        data: [
          {
            runId: run.id,
            type: AGENT_STEP_TYPES.receiveUserMessage,
            title: AGENT_STEP_TITLES.receive_user_message,
            status: AgentStepStatus.COMPLETED,
            input: {
              messageId: input.userMessageId,
              messageLength: input.userMessageLength,
            },
            startedAt: now,
            endedAt: now,
          },
          this.createPendingStep(run.id, AGENT_STEP_TYPES.loadConversationHistory),
          this.createPendingStep(run.id, AGENT_STEP_TYPES.callLlm),
          this.createPendingStep(run.id, AGENT_STEP_TYPES.streamAssistantReply),
        ],
      })

      return run
    })
  }

  async attachAssistantMessage(runId: string, assistantMessageId: string): Promise<void> {
    await this.prismaService.agentRun.update({
      where: {
        id: runId,
      },
      data: {
        assistantMessageId,
      },
    })
  }

  async startStep(
    runId: string,
    type: AgentStepType,
    payload: Pick<StepUpdatePayload, 'input'> = {},
  ): Promise<void> {
    await this.prismaService.agentStep.updateMany({
      where: {
        runId,
        type,
        status: AgentStepStatus.PENDING,
      },
      data: {
        status: AgentStepStatus.RUNNING,
        startedAt: new Date(),
        ...(payload.input === undefined ? {} : { input: payload.input }),
      },
    })
  }

  async completeStep(
    runId: string,
    type: AgentStepType,
    payload: Pick<StepUpdatePayload, 'output'> = {},
  ): Promise<void> {
    await this.prismaService.agentStep.updateMany({
      where: {
        runId,
        type,
        status: {
          in: UNFINISHED_STEP_STATUSES,
        },
      },
      data: {
        status: AgentStepStatus.COMPLETED,
        endedAt: new Date(),
        ...(payload.output === undefined ? {} : { output: payload.output }),
      },
    })
  }

  async completeRun(runId: string): Promise<void> {
    const now = new Date()

    const unfinishedStepCount = await this.prismaService.$transaction(async (prisma) => {
      const count = await prisma.agentStep.count({
        where: {
          runId,
          status: {
            in: UNFINISHED_STEP_STATUSES,
          },
        },
      })

      await prisma.agentRun.update({
        where: {
          id: runId,
        },
        data: {
          status: AgentRunStatus.COMPLETED,
          endedAt: now,
        },
      })

      return count
    })

    if (unfinishedStepCount > 0) {
      this.logger.warn(
        `AgentRun ${runId} completed with ${unfinishedStepCount} unfinished step(s). Check step state transitions.`,
      )
    }
  }

  async failRun(
    runId: string,
    errorMessage: string,
    currentStepType?: AgentStepType,
  ): Promise<void> {
    const now = new Date()

    await this.prismaService.$transaction(async (prisma) => {
      if (currentStepType) {
        await prisma.agentStep.updateMany({
          where: {
            runId,
            type: currentStepType,
            status: {
              in: UNFINISHED_STEP_STATUSES,
            },
          },
          data: {
            status: AgentStepStatus.FAILED,
            errorMessage,
            endedAt: now,
          },
        })
      }

      await prisma.agentStep.updateMany({
        where: {
          runId,
          status: {
            in: UNFINISHED_STEP_STATUSES,
          },
          ...(currentStepType ? { NOT: { type: currentStepType } } : {}),
        },
        data: {
          status: AgentStepStatus.FAILED,
          endedAt: now,
        },
      })

      await prisma.agentRun.update({
        where: {
          id: runId,
        },
        data: {
          status: AgentRunStatus.FAILED,
          endedAt: now,
        },
      })
    })
  }

  async abortRun(runId: string): Promise<void> {
    const now = new Date()

    await this.prismaService.$transaction(async (prisma) => {
      await prisma.agentStep.updateMany({
        where: {
          runId,
          status: {
            in: UNFINISHED_STEP_STATUSES,
          },
        },
        data: {
          status: AgentStepStatus.ABORTED,
          endedAt: now,
        },
      })

      await prisma.agentRun.update({
        where: {
          id: runId,
        },
        data: {
          status: AgentRunStatus.ABORTED,
          endedAt: now,
        },
      })
    })
  }

  private createPendingStep(runId: string, type: AgentStepType) {
    return {
      runId,
      type,
      title: AGENT_STEP_TITLES[type],
      status: AgentStepStatus.PENDING,
    }
  }
}
