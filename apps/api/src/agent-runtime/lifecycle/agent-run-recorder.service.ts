import type { MessageGroundingV1 } from '@agent/contracts'
import type { AgentRun, AgentStep, Message, Prisma } from '../../generated/prisma/client.js'
import type {
  DatabaseOperationDeadline,
  DeadlineTransaction,
} from '../../prisma/prisma.service.js'
import { Inject, Injectable } from '@nestjs/common'

import {
  AgentRunStatus,
  AgentStepStatus,
  MessageRole,
  MessageStatus,
} from '../../generated/prisma/client.js'
import { PrismaService } from '../../prisma/prisma.service.js'

export const AGENT_STEP_TYPES = {
  receiveUserMessage: 'receive_user_message',
  loadConversationHistory: 'load_conversation_history',
  modelSampling: 'model_sampling',
  toolExecution: 'tool_execution',
  groundedFinalization: 'grounded_finalization',
  assistantOutput: 'assistant_output',
} as const

export type AgentStepType = typeof AGENT_STEP_TYPES[keyof typeof AGENT_STEP_TYPES]

const AGENT_STEP_TITLES: Record<AgentStepType, string> = {
  receive_user_message: '接收用户消息',
  load_conversation_history: '加载会话上下文',
  model_sampling: '模型采样',
  tool_execution: '执行工具',
  grounded_finalization: '校验回答引用',
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

interface CompleteAgentRunInput {
  runId: string
  conversationId: string
  assistantMessageId: string
  assistantOutputStepId: string
  content: string
  output?: Prisma.InputJsonValue
  /**
   * Evidence-backed 回答的引用事实。
   *
   * 只能与 COMPLETED assistant Message 在同一事务提交：Message 内容、Grounding、
   * Step 与 Run 终态要么一起生效，要么一起回滚，不允许出现半完成 Grounding。
   */
  grounding?: MessageGroundingV1
  /**
   * grounded finalization Step。
   *
   * 它必须和 assistant_output Step、Message、Grounding、Run 在同一事务里终态化：
   * 否则 replay 期间 Abort 或最终事务回滚后，数据库会留下一个 COMPLETED 的
   * finalization Step，而 Run / Message 却是 ABORTED / FAILED 且没有 Grounding。
   */
  finalizationStep?: {
    id: string
    output?: Prisma.InputJsonValue
  }
}

interface CloseAssistantMessageInput {
  id: string
  conversationId: string
  content: string
}

interface CloseAgentStepInput {
  id: string
  errorMessage: string
  output?: Prisma.InputJsonValue
}

/**
 * 收口失败 / 中断 Run 时仍需保留 output 的 Step。
 *
 * 用于 grounded finalization：模型调用一旦发生，attempt 与 usage 就是既成事实，
 * 不能因为后续 replay 被中断或终态事务回滚而从审计里消失。
 */
interface CloseAgentStepMetadata {
  id: string
  output: Prisma.InputJsonValue
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

  async createAssistantMessage(
    runId: string,
    conversationId: string,
    deadline: DatabaseOperationDeadline,
  ): Promise<Message> {
    return await this.prismaService.withDeadlineTransaction(deadline, async (transaction) => {
      const run = await this.assertRunningRunLocked(transaction, runId)

      if (run.conversationId !== conversationId || run.assistantMessageId !== null) {
        throw new RecorderInvariantError(
          `AgentRun ${runId} 的会话不匹配或已关联助手消息`,
        )
      }

      const message = await transaction.execute(prisma => prisma.message.create({
        data: {
          conversationId,
          role: MessageRole.ASSISTANT,
          content: '',
          status: MessageStatus.STREAMING,
        },
      }))
      const result = await transaction.execute(prisma => prisma.agentRun.updateMany({
        where: {
          id: runId,
          status: AgentRunStatus.RUNNING,
        },
        data: {
          assistantMessageId: message.id,
        },
      }))

      this.assertSingleUpdate(result.count, `AgentRun ${runId} 无法关联助手消息`)

      await transaction.execute(prisma => prisma.conversation.update({
        where: { id: conversationId },
        data: { updatedAt: new Date() },
      }))

      return message
    })
  }

  async startStep(
    input: StartAgentStepInput,
    deadline: DatabaseOperationDeadline,
  ): Promise<AgentStep> {
    return await this.prismaService.withDeadlineTransaction(deadline, async (transaction) => {
      await this.assertRunningRunLocked(transaction, input.runId)
      const sequence = await this.nextStepSequence(transaction, input.runId)
      const now = new Date()

      return await transaction.execute(prisma => prisma.agentStep.create({
        data: {
          runId: input.runId,
          sequence,
          type: input.type,
          title: AGENT_STEP_TITLES[input.type],
          status: AgentStepStatus.RUNNING,
          ...(input.input === undefined ? {} : { input: input.input }),
          startedAt: now,
        },
      }))
    })
  }

  async completeStep(
    stepId: string,
    deadline: DatabaseOperationDeadline,
    input: CompleteAgentStepInput = {},
  ): Promise<void> {
    await this.transitionStep(stepId, AgentStepStatus.COMPLETED, deadline, input)
  }

  async failStep(
    stepId: string,
    deadline: DatabaseOperationDeadline,
    input: FailAgentStepInput,
  ): Promise<void> {
    await this.transitionStep(stepId, AgentStepStatus.FAILED, deadline, input)
  }

  async abortStep(
    stepId: string,
    deadline: DatabaseOperationDeadline,
    input: AbortAgentStepInput = {},
  ): Promise<void> {
    await this.transitionStep(stepId, AgentStepStatus.ABORTED, deadline, input)
  }

  async completeRun(
    input: CompleteAgentRunInput,
    deadline: DatabaseOperationDeadline,
    onCommitOwned: () => void = () => {},
  ): Promise<Message> {
    return await this.prismaService.withDeadlineTransaction(deadline, async (transaction) => {
      const run = await this.assertRunningRunLocked(transaction, input.runId)

      if (
        run.conversationId !== input.conversationId
        || run.assistantMessageId !== input.assistantMessageId
      ) {
        throw new RecorderInvariantError(
          `AgentRun ${input.runId} 的会话或助手消息不匹配`,
        )
      }

      const messageResult = await transaction.execute(prisma => prisma.message.updateMany({
        where: {
          id: input.assistantMessageId,
          conversationId: input.conversationId,
          role: MessageRole.ASSISTANT,
          status: {
            in: [MessageStatus.PENDING, MessageStatus.STREAMING],
          },
        },
        data: {
          content: input.content,
          status: MessageStatus.COMPLETED,
        },
      }))

      this.assertSingleUpdate(
        messageResult.count,
        `Message ${input.assistantMessageId} 已进入终态或不存在`,
      )

      if (input.grounding) {
        // 与 Message 转 COMPLETED 处于同一事务：回滚后不会留下孤立 Grounding。
        await transaction.execute(prisma => prisma.messageGrounding.create({
          data: {
            messageId: input.assistantMessageId,
            schemaVersion: input.grounding!.schemaVersion,
            evidenceAvailability: input.grounding!.evidenceAvailability,
            outcome: input.grounding!.outcome,
            citationIntegrity: input.grounding!.citationIntegrity,
            faithfulnessStatus: input.grounding!.faithfulnessStatus,
            citations: input.grounding!
              .citations as unknown as Prisma.InputJsonValue,
          },
        }))
      }

      await transaction.execute(prisma => prisma.conversation.update({
        where: { id: input.conversationId },
        data: { updatedAt: new Date() },
      }))

      const now = new Date()
      const stepResult = await transaction.execute(prisma => prisma.agentStep.updateMany({
        where: {
          id: input.assistantOutputStepId,
          runId: input.runId,
          type: AGENT_STEP_TYPES.assistantOutput,
          status: AgentStepStatus.RUNNING,
        },
        data: {
          status: AgentStepStatus.COMPLETED,
          ...(input.output === undefined ? {} : { output: input.output }),
          endedAt: now,
        },
      }))

      this.assertSingleUpdate(
        stepResult.count,
        `AgentStep ${input.assistantOutputStepId} 已进入终态或尚未开始`,
      )

      const finalizationStep = input.finalizationStep

      if (finalizationStep) {
        // finalization Step 在 delta replay 期间一直保持 RUNNING，只有走到这里
        // 才与 Message / Grounding / Run 一起进入终态。
        const finalizationResult = await transaction.execute(
          prisma => prisma.agentStep.updateMany({
            where: {
              id: finalizationStep.id,
              runId: input.runId,
              type: AGENT_STEP_TYPES.groundedFinalization,
              status: AgentStepStatus.RUNNING,
            },
            data: {
              status: AgentStepStatus.COMPLETED,
              ...(finalizationStep.output === undefined
                ? {}
                : { output: finalizationStep.output }),
              endedAt: now,
            },
          }),
        )

        this.assertSingleUpdate(
          finalizationResult.count,
          `AgentStep ${finalizationStep.id} 已进入终态或尚未开始`,
        )
      }

      const unfinishedStepCount = await transaction.execute(prisma => prisma.agentStep.count({
        where: {
          runId: input.runId,
          status: {
            in: UNFINISHED_STEP_STATUSES,
          },
        },
      }))

      if (unfinishedStepCount > 0) {
        throw new RecorderInvariantError(
          `AgentRun ${input.runId} 仍有 ${unfinishedStepCount} 条非终态 Step，不能完成`,
        )
      }

      const message = await transaction.execute(prisma => prisma.message.findUniqueOrThrow({
        where: { id: input.assistantMessageId },
      }))

      await this.transitionRun(
        transaction,
        input.runId,
        AgentRunStatus.COMPLETED,
        now,
      )

      return message
    }, onCommitOwned)
  }

  async failRun(
    runId: string,
    errorMessage: string,
    deadline: DatabaseOperationDeadline,
    assistantMessage?: CloseAssistantMessageInput,
    failedStep?: CloseAgentStepInput,
    metadataStep?: CloseAgentStepMetadata,
  ): Promise<void> {
    await this.closeRunAndUnfinishedSteps(
      runId,
      AgentRunStatus.FAILED,
      AgentStepStatus.FAILED,
      MessageStatus.FAILED,
      deadline,
      errorMessage,
      assistantMessage,
      failedStep,
      metadataStep,
    )
  }

  async abortRun(
    runId: string,
    deadline: DatabaseOperationDeadline,
    assistantMessage?: CloseAssistantMessageInput,
    abortedStep?: CloseAgentStepInput,
    metadataStep?: CloseAgentStepMetadata,
  ): Promise<void> {
    await this.closeRunAndUnfinishedSteps(
      runId,
      AgentRunStatus.ABORTED,
      AgentStepStatus.ABORTED,
      MessageStatus.ABORTED,
      deadline,
      undefined,
      assistantMessage,
      abortedStep,
      metadataStep,
    )
  }

  private async transitionStep(
    stepId: string,
    status: typeof AgentStepStatus.COMPLETED | typeof AgentStepStatus.FAILED | typeof AgentStepStatus.ABORTED,
    deadline: DatabaseOperationDeadline,
    input: CompleteAgentStepInput & { errorMessage?: string },
  ): Promise<void> {
    await this.prismaService.withDeadlineTransaction(deadline, async (transaction) => {
      const step = await transaction.execute(prisma => prisma.agentStep.findUnique({
        where: { id: stepId },
        select: { runId: true },
      }))

      if (!step)
        throw new RecorderInvariantError(`AgentStep ${stepId} 不存在`)

      await this.assertRunningRunLocked(transaction, step.runId)
      const result = await transaction.execute(prisma => prisma.agentStep.updateMany({
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
      }))

      this.assertSingleUpdate(result.count, `AgentStep ${stepId} 已进入终态或尚未开始`)
    })
  }

  private async closeRunAndUnfinishedSteps(
    runId: string,
    runStatus: typeof AgentRunStatus.FAILED | typeof AgentRunStatus.ABORTED,
    stepStatus: typeof AgentStepStatus.FAILED | typeof AgentStepStatus.ABORTED,
    messageStatus: typeof MessageStatus.FAILED | typeof MessageStatus.ABORTED,
    deadline: DatabaseOperationDeadline,
    errorMessage?: string,
    assistantMessage?: CloseAssistantMessageInput,
    failedStep?: CloseAgentStepInput,
    metadataStep?: CloseAgentStepMetadata,
  ): Promise<void> {
    await this.prismaService.withDeadlineTransaction(deadline, async (transaction) => {
      const run = await this.assertRunningRunLocked(transaction, runId)
      const now = new Date()

      const assistantMessageId = assistantMessage?.id ?? run.assistantMessageId

      if (assistantMessageId) {
        if (
          (
            assistantMessage
            && run.conversationId !== assistantMessage.conversationId
          )
          || (
            run.assistantMessageId !== null
            && run.assistantMessageId !== assistantMessageId
          )
        ) {
          throw new RecorderInvariantError(
            `AgentRun ${runId} 的会话或助手消息不匹配`,
          )
        }

        const messageResult = await transaction.execute(prisma => prisma.message.updateMany({
          where: {
            id: assistantMessageId,
            conversationId: run.conversationId,
            role: MessageRole.ASSISTANT,
            status: {
              in: [MessageStatus.PENDING, MessageStatus.STREAMING],
            },
          },
          data: {
            content: assistantMessage?.content ?? errorMessage ?? '',
            status: messageStatus,
          },
        }))

        this.assertSingleUpdate(
          messageResult.count,
          `Message ${assistantMessageId} 已进入终态或不存在`,
        )

        await transaction.execute(prisma => prisma.conversation.update({
          where: { id: run.conversationId },
          data: { updatedAt: now },
        }))
      }

      if (failedStep) {
        const existingStep = await transaction.execute(prisma => prisma.agentStep.findUnique({
          where: { id: failedStep.id },
          select: { runId: true, status: true },
        }))

        if (!existingStep || existingStep.runId !== runId) {
          throw new RecorderInvariantError(
            `AgentStep ${failedStep.id} 不属于 AgentRun ${runId}`,
          )
        }

        if (
          existingStep.status === AgentStepStatus.PENDING
          || existingStep.status === AgentStepStatus.RUNNING
        ) {
          const failedStepResult = await transaction.execute(prisma => prisma.agentStep.updateMany({
            where: {
              id: failedStep.id,
              runId,
              status: {
                in: UNFINISHED_STEP_STATUSES,
              },
            },
            data: {
              status: stepStatus,
              errorMessage: failedStep.errorMessage,
              ...(failedStep.output === undefined ? {} : { output: failedStep.output }),
              endedAt: now,
            },
          }))

          this.assertSingleUpdate(
            failedStepResult.count,
            `AgentStep ${failedStep.id} 已并发进入终态`,
          )
        }
      }

      // 先带 output 收口需要保留审计元数据的 Step；下面的批量收口只写状态。
      if (metadataStep && metadataStep.id !== failedStep?.id) {
        await transaction.execute(prisma => prisma.agentStep.updateMany({
          where: {
            id: metadataStep.id,
            runId,
            status: {
              in: UNFINISHED_STEP_STATUSES,
            },
          },
          data: {
            status: stepStatus,
            output: metadataStep.output,
            ...(errorMessage === undefined ? {} : { errorMessage }),
            endedAt: now,
          },
        }))
      }

      await transaction.execute(prisma => prisma.agentStep.updateMany({
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
      }))

      await this.transitionRun(
        transaction,
        runId,
        runStatus,
        now,
        assistantMessage?.id,
      )
    })
  }

  private async transitionRun(
    transaction: DeadlineTransaction,
    runId: string,
    status: typeof AgentRunStatus.COMPLETED | typeof AgentRunStatus.FAILED | typeof AgentRunStatus.ABORTED,
    endedAt = new Date(),
    assistantMessageId?: string,
  ): Promise<void> {
    const result = await transaction.execute(prisma => prisma.agentRun.updateMany({
      where: {
        id: runId,
        status: AgentRunStatus.RUNNING,
      },
      data: {
        status,
        endedAt,
        ...(assistantMessageId === undefined ? {} : { assistantMessageId }),
      },
    }))

    this.assertSingleUpdate(result.count, `AgentRun ${runId} 已进入终态或不存在`)
  }

  private async assertRunningRunLocked(
    transaction: DeadlineTransaction,
    runId: string,
  ): Promise<Pick<AgentRun, 'id' | 'status' | 'conversationId' | 'assistantMessageId'>> {
    const runs = await transaction.execute(prisma => prisma.$queryRaw<Array<Pick<
      AgentRun,
      'id' | 'status' | 'conversationId' | 'assistantMessageId'
    >>>`
      SELECT "id", "status", "conversationId", "assistantMessageId"
      FROM "AgentRun"
      WHERE "id" = ${runId}
      FOR UPDATE
    `)

    if (runs[0]?.status !== AgentRunStatus.RUNNING)
      throw new RecorderInvariantError(`AgentRun ${runId} 已进入终态或不存在`)

    return runs[0]
  }

  private async nextStepSequence(
    transaction: DeadlineTransaction,
    runId: string,
  ): Promise<number> {
    const result = await transaction.execute(prisma => prisma.agentStep.aggregate({
      where: { runId },
      _max: { sequence: true },
    }))

    return (result._max.sequence ?? 0) + 1
  }

  private assertSingleUpdate(count: number, message: string): void {
    if (count !== 1)
      throw new RecorderInvariantError(message)
  }
}
