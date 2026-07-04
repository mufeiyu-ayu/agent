import type {
  Message,
  MessageRole as PrismaMessageRole,
  MessageStatus as PrismaMessageStatus,
} from '../generated/prisma/client.js'
import type { ChatMessage } from '../llm/llm.types.js'
import type { AgentStepType } from './agent-run-recorder.service.js'
import type {
  AgentRuntimeEvent,
  RunTurnStreamInput,
} from './agent-runtime.types.js'
import { Inject, Injectable, NotFoundException } from '@nestjs/common'

import { MessageRole, MessageStatus } from '../generated/prisma/client.js'
import { LLMService } from '../llm/llm.service.js'
import { PrismaService } from '../prisma/prisma.service.js'
import {
  AGENT_STEP_TYPES,
  AgentRunRecorderService,
} from './agent-run-recorder.service.js'

@Injectable()
export class AgentRuntimeService {
  constructor(
    @Inject(LLMService)
    private readonly llmService: LLMService,

    @Inject(PrismaService)
    private readonly prismaService: PrismaService,

    @Inject(AgentRunRecorderService)
    private readonly agentRunRecorderService: AgentRunRecorderService,
  ) {}

  async* runTurnStream(input: RunTurnStreamInput): AsyncGenerator<AgentRuntimeEvent> {
    let assistantMessage: Message | undefined
    let agentRunId: string | undefined
    let activeAgentStepType: AgentStepType | undefined
    let content = ''
    let hasFinalMessageStatus = false

    try {
      await this.assertConversationExists(input.conversationId)

      const normalizedMessage = input.userContent.trim()
      const userMessage = await this.createMessageAndTouchConversation(
        input.conversationId,
        MessageRole.USER,
        normalizedMessage,
      )

      const agentRun = await this.agentRunRecorderService.createRunWithInitialSteps({
        conversationId: input.conversationId,
        userMessageId: userMessage.id,
        userMessageLength: normalizedMessage.length,
      })
      const currentAgentRunId = agentRun.id

      agentRunId = currentAgentRunId
      activeAgentStepType = AGENT_STEP_TYPES.loadConversationHistory
      await this.agentRunRecorderService.startStep(
        currentAgentRunId,
        AGENT_STEP_TYPES.loadConversationHistory,
        {
          input: {
            limit: input.historyLimit,
          },
        },
      )

      const historyMessages = await this.listRecentChatMessages(
        input.conversationId,
        input.historyLimit,
      )
      await this.agentRunRecorderService.completeStep(
        currentAgentRunId,
        AGENT_STEP_TYPES.loadConversationHistory,
        {
          output: {
            messageCount: historyMessages.length,
          },
        },
      )

      const llmMessages = input.buildModelMessages(
        historyMessages.map(message => this.toLlmMessage(message)),
      )

      assistantMessage = await this.createMessageAndTouchConversation(
        input.conversationId,
        MessageRole.ASSISTANT,
        '',
        MessageStatus.STREAMING,
      )
      const assistantMessageId = assistantMessage.id

      await this.agentRunRecorderService.attachAssistantMessage(
        currentAgentRunId,
        assistantMessageId,
      )

      yield {
        type: 'run_started',
        runId: currentAgentRunId,
        conversationId: input.conversationId,
        userMessageId: userMessage.id,
        assistantMessageId,
      }

      activeAgentStepType = AGENT_STEP_TYPES.callLlm
      await this.agentRunRecorderService.startStep(
        currentAgentRunId,
        AGENT_STEP_TYPES.callLlm,
        {
          input: {
            messageCount: llmMessages.length,
            model: input.model ?? null,
          },
        },
      )

      let hasStartedAssistantReplyStep = false
      const startAssistantReplyStep = async (): Promise<void> => {
        if (hasStartedAssistantReplyStep)
          return

        await this.agentRunRecorderService.completeStep(
          currentAgentRunId,
          AGENT_STEP_TYPES.callLlm,
        )
        activeAgentStepType = AGENT_STEP_TYPES.streamAssistantReply
        await this.agentRunRecorderService.startStep(
          currentAgentRunId,
          AGENT_STEP_TYPES.streamAssistantReply,
          {
            input: {
              assistantMessageId,
            },
          },
        )
        hasStartedAssistantReplyStep = true
      }

      for await (const contentDelta of this.llmService.chatStream(llmMessages, {
        ...(input.model ? { model: input.model } : {}),
        temperature: input.temperature,
        maxTokens: input.maxTokens,
        ...(input.signal ? { signal: input.signal } : {}),
      })) {
        await startAssistantReplyStep()
        content += contentDelta

        yield {
          type: 'assistant_delta',
          runId: currentAgentRunId,
          conversationId: input.conversationId,
          assistantMessageId,
          contentDelta,
        }
      }

      if (this.isAbortSignalTriggered(input.signal)) {
        await this.updateMessageAndTouchConversation(
          assistantMessageId,
          input.conversationId,
          content,
          MessageStatus.ABORTED,
        )
        await this.agentRunRecorderService.abortRun(currentAgentRunId)
        hasFinalMessageStatus = true

        yield {
          type: 'run_aborted',
          runId: currentAgentRunId,
          conversationId: input.conversationId,
          assistantMessageId,
          content,
        }

        return
      }

      await startAssistantReplyStep()
      const completedMessage = await this.updateMessageAndTouchConversation(
        assistantMessageId,
        input.conversationId,
        content,
        MessageStatus.COMPLETED,
      )
      await this.agentRunRecorderService.completeStep(
        currentAgentRunId,
        AGENT_STEP_TYPES.streamAssistantReply,
        {
          output: {
            contentLength: content.length,
          },
        },
      )
      await this.agentRunRecorderService.completeRun(currentAgentRunId)
      hasFinalMessageStatus = true

      yield {
        type: 'run_completed',
        runId: currentAgentRunId,
        conversationId: input.conversationId,
        assistantMessageId,
        content,
        generatedAt: completedMessage.updatedAt.toISOString(),
      }
    }
    catch (error) {
      if (this.isAbortSignalTriggered(input.signal)) {
        if (assistantMessage) {
          await this.updateMessageAndTouchConversation(
            assistantMessage.id,
            input.conversationId,
            content,
            MessageStatus.ABORTED,
          )
          hasFinalMessageStatus = true
        }

        if (agentRunId) {
          await this.agentRunRecorderService.abortRun(agentRunId)
        }

        if (assistantMessage) {
          yield {
            type: 'run_aborted',
            ...(agentRunId ? { runId: agentRunId } : {}),
            conversationId: input.conversationId,
            assistantMessageId: assistantMessage.id,
            content,
          }
        }

        return
      }

      const errorMessage = this.toChatStreamErrorMessage(error)

      if (assistantMessage) {
        await this.updateMessageAndTouchConversation(
          assistantMessage.id,
          input.conversationId,
          content || errorMessage,
          MessageStatus.FAILED,
        )
        hasFinalMessageStatus = true
      }

      if (agentRunId) {
        await this.agentRunRecorderService.failRun(
          agentRunId,
          errorMessage,
          activeAgentStepType,
        )
      }

      yield {
        type: 'run_failed',
        ...(agentRunId ? { runId: agentRunId } : {}),
        conversationId: input.conversationId,
        ...(assistantMessage ? { assistantMessageId: assistantMessage.id } : {}),
        message: errorMessage,
      }
    }
    finally {
      if (
        assistantMessage
        && !hasFinalMessageStatus
        && this.isAbortSignalTriggered(input.signal)
      ) {
        await this.updateMessageAndTouchConversation(
          assistantMessage.id,
          input.conversationId,
          content,
          MessageStatus.ABORTED,
        )

        if (agentRunId) {
          await this.agentRunRecorderService.abortRun(agentRunId)
        }
      }
    }
  }

  private async listRecentChatMessages(
    conversationId: string,
    limit: number,
  ): Promise<Message[]> {
    const messages = await this.prismaService.message.findMany({
      where: {
        conversationId,
      },
      orderBy: {
        createdAt: 'desc',
      },
      take: limit,
    })

    return messages.reverse()
  }

  private async createMessageAndTouchConversation(
    conversationId: string,
    role: PrismaMessageRole,
    content: string,
    status: PrismaMessageStatus = MessageStatus.COMPLETED,
  ): Promise<Message> {
    return this.prismaService.$transaction(async (prisma) => {
      const message = await prisma.message.create({
        data: {
          conversationId,
          role,
          content,
          status,
        },
      })

      await prisma.conversation.update({
        where: {
          id: conversationId,
        },
        data: {
          updatedAt: new Date(),
        },
      })

      return message
    })
  }

  private async updateMessageAndTouchConversation(
    messageId: string,
    conversationId: string,
    content: string,
    status: PrismaMessageStatus,
  ): Promise<Message> {
    return this.prismaService.$transaction(async (prisma) => {
      const message = await prisma.message.update({
        where: {
          id: messageId,
        },
        data: {
          content,
          status,
        },
      })

      await prisma.conversation.update({
        where: {
          id: conversationId,
        },
        data: {
          updatedAt: new Date(),
        },
      })

      return message
    })
  }

  private toLlmMessage(message: Message): ChatMessage {
    return {
      role: this.toLlmRole(message.role),
      content: message.content,
    }
  }

  private toLlmRole(role: PrismaMessageRole): ChatMessage['role'] {
    switch (role) {
      case MessageRole.USER:
        return 'user'
      case MessageRole.ASSISTANT:
        return 'assistant'
    }
  }

  private async assertConversationExists(conversationId: string): Promise<void> {
    const conversation = await this.prismaService.conversation.findUnique({
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

  private toChatStreamErrorMessage(error: unknown): string {
    if (error instanceof NotFoundException)
      return error.message

    return '模型服务暂时没有返回结果，请稍后重试。'
  }

  private isAbortSignalTriggered(signal: AbortSignal | undefined): boolean {
    return signal?.aborted ?? false
  }
}
