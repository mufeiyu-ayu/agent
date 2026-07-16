import type {
  Message,
  MessageRole as PrismaMessageRole,
  MessageStatus as PrismaMessageStatus,
} from '../generated/prisma/client.js'
import type { ChatMessage } from '../llm/llm.types.js'
import type { ModelInputItem } from '../llm/model-input.types.js'
import type {
  ToolResult,
  UnvalidatedToolCallEnvelope,
} from '../tools/tool.types.js'
import type { AgentStepType } from './agent-run-recorder.service.js'
import type {
  AgentRuntimeEvent,
  RunTurnStreamInput,
} from './agent-runtime.types.js'
import type { SamplingDecision } from './model-sampling-decision.js'
import { Inject, Injectable, NotFoundException } from '@nestjs/common'

import { MessageRole, MessageStatus } from '../generated/prisma/client.js'
import { LLMService } from '../llm/llm.service.js'
import { toModelInputItems } from '../llm/model-input.types.js'
import { PrismaService } from '../prisma/prisma.service.js'
import { toModelToolSpec } from '../tools/model-tool-spec.mapper.js'
import { ToolInvocationService } from '../tools/tool-invocation.service.js'
import { ToolRegistryService } from '../tools/tool-registry.service.js'
import {
  AGENT_STEP_TYPES,
  AgentRunRecorderService,
} from './agent-run-recorder.service.js'
import { ModelSamplingIncompleteError } from './agent-runtime.errors.js'
import {
  collectModelSampling,
  ModelSamplingInterruptedError,
} from './model-sampling-decision.js'

@Injectable()
export class AgentRuntimeService {
  constructor(
    @Inject(LLMService)
    private readonly llmService: LLMService,

    @Inject(PrismaService)
    private readonly prismaService: PrismaService,

    @Inject(AgentRunRecorderService)
    private readonly agentRunRecorderService: AgentRunRecorderService,

    @Inject(ToolRegistryService)
    private readonly toolRegistryService: ToolRegistryService,

    @Inject(ToolInvocationService)
    private readonly toolInvocationService: ToolInvocationService,
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
      const modelInputItems = toModelInputItems(llmMessages)
      const modelTools = this.toolRegistryService.listDefinitions()
        .filter(definition => definition.name === 'search_articles')
        .map(toModelToolSpec)
      const runSignal = input.signal ?? new AbortController().signal

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

      const chatStreamOptions = {
        ...(input.model ? { model: input.model } : {}),
        temperature: input.temperature,
        maxTokens: input.maxTokens,
        ...(input.signal ? { signal: input.signal } : {}),
        tools: modelTools,
      }

      let finalAnswer: Extract<SamplingDecision, { type: 'final_answer' }> | undefined

      for (const samplingAttempt of [1, 2]) {
        runSignal.throwIfAborted()
        let samplingDecision: SamplingDecision

        try {
          samplingDecision = await collectModelSampling(
            this.llmService.chatStream(modelInputItems, chatStreamOptions),
            `${currentAgentRunId}:sampling-${samplingAttempt}`,
          )
        }
        catch (error) {
          if (error instanceof ModelSamplingInterruptedError) {
            if (!error.hasToolCall) {
              for (const textChunk of error.textChunks) {
                await startAssistantReplyStep()
                content += textChunk
                yield {
                  type: 'assistant_delta',
                  runId: currentAgentRunId,
                  conversationId: input.conversationId,
                  assistantMessageId,
                  contentDelta: textChunk,
                }
              }
            }

            throw error.cause
          }

          throw error
        }

        runSignal.throwIfAborted()

        if (samplingDecision.type === 'final_answer') {
          finalAnswer = samplingDecision
          break
        }

        if (samplingAttempt === 2) {
          throw new ModelSamplingIncompleteError(
            'Tool Loop 已达到最多一次工具调用、两轮 sampling 的限制。',
          )
        }

        const toolResult = await this.toolInvocationService.invoke(
          samplingDecision.call,
          {
            runId: currentAgentRunId,
            conversationId: input.conversationId,
            signal: runSignal,
            executionAttempt: 1,
          },
        )
        runSignal.throwIfAborted()
        this.appendToolObservation(
          modelInputItems,
          samplingDecision.call,
          samplingDecision.intermediateText,
          toolResult,
        )
      }

      if (!finalAnswer) {
        throw new ModelSamplingIncompleteError(
          'Tool Loop 未产生最终回答。',
        )
      }

      for (const textChunk of finalAnswer.textChunks) {
        runSignal.throwIfAborted()
        await startAssistantReplyStep()
        content += textChunk

        yield {
          type: 'assistant_delta',
          runId: currentAgentRunId,
          conversationId: input.conversationId,
          assistantMessageId,
          contentDelta: textChunk,
        }
      }

      runSignal.throwIfAborted()
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
    if (error instanceof ModelSamplingIncompleteError) {
      return error.message
    }

    return '模型服务暂时没有返回结果，请稍后重试。'
  }

  private appendToolObservation(
    modelInputItems: ModelInputItem[],
    call: UnvalidatedToolCallEnvelope,
    intermediateText: string,
    result: ToolResult,
  ): void {
    modelInputItems.push(
      {
        type: 'assistant_tool_call',
        callId: call.callId,
        name: call.toolName,
        rawArgumentsJson: call.rawArgumentsJson,
        ...(intermediateText ? { content: intermediateText } : {}),
      },
      {
        type: 'tool_result',
        callId: call.callId,
        name: call.toolName,
        content: result.modelContent,
        ok: result.ok,
      },
    )
  }

  private isAbortSignalTriggered(signal: AbortSignal | undefined): boolean {
    return signal?.aborted ?? false
  }
}
