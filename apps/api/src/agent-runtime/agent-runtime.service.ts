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
import type {
  AgentRuntimeEvent,
  RunTurnStreamInput,
} from './agent-runtime.types.js'
import type {
  ModelSamplingSummary,
  SamplingDecision,
} from './model-sampling-decision.js'
import { Inject, Injectable, NotFoundException } from '@nestjs/common'

import { MessageRole, MessageStatus } from '../generated/prisma/client.js'
import { LLMService } from '../llm/llm.service.js'
import { toModelInputItems } from '../llm/model-input.types.js'
import { PrismaService } from '../prisma/prisma.service.js'
import { toModelToolSpec } from '../tools/model-tool-spec.mapper.js'
import { ToolInvocationService } from '../tools/tool-invocation.service.js'
import { normalizeToolObservation } from '../tools/tool-observation.js'
import { ToolRegistryService } from '../tools/tool-registry.service.js'
import {
  AGENT_STEP_TYPES,
  AgentRunRecorderService,
} from './agent-run-recorder.service.js'
import {
  MessageTerminalTransitionError,
  ModelSamplingIncompleteError,
} from './agent-runtime.errors.js'
import { streamModelSampling } from './model-sampling-decision.js'

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

      const agentRun = await this.agentRunRecorderService.createRun({
        conversationId: input.conversationId,
        userMessageId: userMessage.id,
      })
      const currentAgentRunId = agentRun.id

      agentRunId = currentAgentRunId
      const receiveUserMessageStep = await this.agentRunRecorderService.startStep({
        runId: currentAgentRunId,
        type: AGENT_STEP_TYPES.receiveUserMessage,
        input: {
          messageId: userMessage.id,
          messageLength: normalizedMessage.length,
        },
      })
      await this.agentRunRecorderService.completeStep(receiveUserMessageStep.id)

      const loadHistoryStep = await this.agentRunRecorderService.startStep({
        runId: currentAgentRunId,
        type: AGENT_STEP_TYPES.loadConversationHistory,
        input: {
          limit: input.historyLimit,
        },
      })

      const historyMessages = await this.listRecentChatMessages(
        input.conversationId,
        input.historyLimit,
      )
      await this.agentRunRecorderService.completeStep(
        loadHistoryStep.id,
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
      const toolDefinitions = this.toolRegistryService.listDefinitions()
        .filter(definition => definition.name === 'search_articles')
      const modelTools = toolDefinitions.map(toModelToolSpec)
      const runSignal = input.signal ?? new AbortController().signal

      // 模型采样前先创建空的流式助手消息，后续将增量内容和最终状态写回该记录。
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

      let assistantOutputStepId: string | undefined
      const startAssistantOutputStep = async (): Promise<void> => {
        if (assistantOutputStepId)
          return

        const step = await this.agentRunRecorderService.startStep({
          runId: currentAgentRunId,
          type: AGENT_STEP_TYPES.assistantOutput,
          input: {
            assistantMessageId,
          },
        })
        assistantOutputStepId = step.id
      }

      const chatStreamOptions = {
        ...(input.model ? { model: input.model } : {}),
        temperature: input.temperature,
        maxTokens: input.maxTokens,
        ...(input.signal ? { signal: input.signal } : {}),
        tools: modelTools,
      }

      let hasFinalAnswer = false

      for (const samplingAttempt of [1, 2]) {
        runSignal.throwIfAborted()
        const samplingAttemptId = `${currentAgentRunId}:sampling-${samplingAttempt}`
        const samplingStep = await this.agentRunRecorderService.startStep({
          runId: currentAgentRunId,
          type: AGENT_STEP_TYPES.modelSampling,
          input: {
            samplingIndex: samplingAttempt,
            samplingAttemptId,
            requestedModel: input.model ?? null,
            messageCount: modelInputItems.length,
            toolCount: modelTools.length,
          },
        })
        const samplingStartedAt = Date.now()
        let samplingDecision: SamplingDecision

        try {
          const sampling = streamModelSampling(
            this.llmService.chatStream(modelInputItems, chatStreamOptions),
            samplingAttemptId,
          )
          let samplingResult = await sampling.next()

          while (!samplingResult.done) {
            runSignal.throwIfAborted()
            await startAssistantOutputStep()
            content += samplingResult.value
            yield {
              type: 'assistant_delta',
              runId: currentAgentRunId,
              conversationId: input.conversationId,
              assistantMessageId,
              contentDelta: samplingResult.value,
            }
            samplingResult = await sampling.next()
          }
          samplingDecision = samplingResult.value

          runSignal.throwIfAborted()
          await this.agentRunRecorderService.completeStep(samplingStep.id, {
            output: this.toSamplingStepOutput(
              samplingDecision.summary,
              Date.now() - samplingStartedAt,
            ),
          })
        }
        catch (error) {
          if (!runSignal.aborted) {
            await this.agentRunRecorderService.failStep(samplingStep.id, {
              errorMessage: this.toChatStreamErrorMessage(error),
              output: this.toFailedSamplingStepOutput(
                error,
                Date.now() - samplingStartedAt,
              ),
            })
          }

          throw error
        }

        runSignal.throwIfAborted()

        if (samplingDecision.type === 'final_answer') {
          hasFinalAnswer = true
          break
        }

        if (samplingAttempt === 2) {
          throw new ModelSamplingIncompleteError(
            'Tool Loop 已达到最多一次工具调用、两轮 sampling 的限制。',
          )
        }

        const toolDefinition = toolDefinitions.find(
          definition => definition.name === samplingDecision.call.toolName,
        )
        const toolStep = await this.agentRunRecorderService.startStep({
          runId: currentAgentRunId,
          type: AGENT_STEP_TYPES.toolExecution,
          input: {
            callId: samplingDecision.call.callId,
            toolName: samplingDecision.call.toolName,
            toolVersion: toolDefinition?.version ?? null,
            samplingAttemptId: samplingDecision.call.samplingAttemptId,
            executionAttempt: 1,
            rawArgumentsChars: [...samplingDecision.call.rawArgumentsJson].length,
          },
        })
        const toolStartedAt = Date.now()
        let toolResult: ToolResult

        try {
          toolResult = await this.toolInvocationService.invoke(
            samplingDecision.call,
            {
              runId: currentAgentRunId,
              conversationId: input.conversationId,
              signal: runSignal,
              executionAttempt: 1,
            },
          )
          runSignal.throwIfAborted()
        }
        catch (error) {
          if (!runSignal.aborted) {
            await this.agentRunRecorderService.failStep(toolStep.id, {
              errorMessage: '工具执行未能安全完成。',
              output: {
                durationMs: Date.now() - toolStartedAt,
              },
            })
          }

          throw error
        }

        const observation = normalizeToolObservation(toolResult.modelContent)
        const toolStepOutput = {
          ok: toolResult.ok,
          ...(toolResult.ok
            ? {}
            : {
                code: toolResult.code,
                retryable: toolResult.retryable,
              }),
          originalChars: observation.originalChars,
          observationChars: observation.observationChars,
          truncated: observation.truncated,
          durationMs: Date.now() - toolStartedAt,
        }

        if (toolResult.ok) {
          await this.agentRunRecorderService.completeStep(toolStep.id, {
            output: toolStepOutput,
          })
        }
        else {
          await this.agentRunRecorderService.failStep(toolStep.id, {
            errorMessage: `工具 ${samplingDecision.call.toolName} 返回 ${toolResult.code}。`,
            output: toolStepOutput,
          })
        }

        runSignal.throwIfAborted()
        this.appendToolObservation(
          modelInputItems,
          samplingDecision.call,
          samplingDecision.intermediateText,
          observation.content,
          toolResult.ok,
        )
      }

      if (!hasFinalAnswer) {
        throw new ModelSamplingIncompleteError(
          'Tool Loop 未产生最终回答。',
        )
      }

      runSignal.throwIfAborted()
      await startAssistantOutputStep()
      runSignal.throwIfAborted()
      const completedMessageTransition = await this.updateMessageAndTouchConversation(
        assistantMessageId,
        input.conversationId,
        content,
        MessageStatus.COMPLETED,
        runSignal,
      )

      if (!completedMessageTransition.transitioned) {
        hasFinalMessageStatus = true
        throw new MessageTerminalTransitionError(assistantMessageId)
      }

      const completedMessage = completedMessageTransition.message

      // Message 的 COMPLETED CAS 是正常完成路径的终态所有权边界；之后到达的 abort 属于迟到信号。
      hasFinalMessageStatus = true
      await this.agentRunRecorderService.completeStep(
        assistantOutputStepId!,
        {
          output: {
            contentLength: content.length,
          },
        },
      )
      await this.agentRunRecorderService.completeRun(currentAgentRunId)

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
        if (assistantMessage && !hasFinalMessageStatus) {
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

      if (assistantMessage && !hasFinalMessageStatus) {
        await this.updateMessageAndTouchConversation(
          assistantMessage.id,
          input.conversationId,
          content || errorMessage,
          MessageStatus.FAILED,
        )
        hasFinalMessageStatus = true
      }

      if (agentRunId) {
        await this.agentRunRecorderService.failRun(agentRunId, errorMessage)
      }

      yield {
        type: 'run_failed',
        ...(agentRunId ? { runId: agentRunId } : {}),
        conversationId: input.conversationId,
        ...(assistantMessage ? { assistantMessageId: assistantMessage.id } : {}),
        ...(error instanceof NotFoundException
          ? { failureReason: 'conversation_not_found' as const }
          : {}),
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
    signal?: AbortSignal,
  ): Promise<{ message: Message, transitioned: boolean }> {
    return this.prismaService.$transaction(async (prisma) => {
      signal?.throwIfAborted()
      const result = await prisma.message.updateMany({
        where: {
          id: messageId,
          status: {
            in: [MessageStatus.PENDING, MessageStatus.STREAMING],
          },
        },
        data: {
          content,
          status,
        },
      })

      if (result.count === 1) {
        await prisma.conversation.update({
          where: {
            id: conversationId,
          },
          data: {
            updatedAt: new Date(),
          },
        })
      }

      // 在事务提交前再次仲裁；若 abort 已先到达，抛错会回滚刚才的 Message 更新。
      signal?.throwIfAborted()

      const message = await prisma.message.findUniqueOrThrow({
        where: { id: messageId },
      })

      signal?.throwIfAborted()

      return {
        message,
        transitioned: result.count === 1,
      }
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

  private toSamplingStepOutput(
    summary: ModelSamplingSummary,
    durationMs: number,
  ) {
    return {
      samplingAttemptId: summary.samplingAttemptId,
      finishReason: summary.finishReason,
      usage: summary.usage
        ? {
            ...(summary.usage.inputTokens === undefined
              ? {}
              : { inputTokens: summary.usage.inputTokens }),
            ...(summary.usage.outputTokens === undefined
              ? {}
              : { outputTokens: summary.usage.outputTokens }),
            ...(summary.usage.totalTokens === undefined
              ? {}
              : { totalTokens: summary.usage.totalTokens }),
          }
        : null,
      toolCallCount: summary.toolCallCount,
      textChars: summary.textChars,
      intermediateTextChars: summary.intermediateTextChars,
      durationMs,
    }
  }

  private toFailedSamplingStepOutput(error: unknown, durationMs: number) {
    if (error instanceof ModelSamplingIncompleteError && error.summary) {
      return this.toSamplingStepOutput(error.summary, durationMs)
    }

    return { durationMs }
  }

  private appendToolObservation(
    modelInputItems: ModelInputItem[],
    call: UnvalidatedToolCallEnvelope,
    intermediateText: string,
    content: string,
    ok: boolean,
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
        content,
        ok,
      },
    )
  }

  private isAbortSignalTriggered(signal: AbortSignal | undefined): boolean {
    return signal?.aborted ?? false
  }
}
