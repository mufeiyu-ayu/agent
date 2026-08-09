import type {
  Message,
  Prisma,
  MessageRole as PrismaMessageRole,
  MessageStatus as PrismaMessageStatus,
} from '../generated/prisma/client.js'
import type { ChatMessage } from '../llm/llm.types.js'
import type { ModelInputItem } from '../llm/model-input.types.js'
import type { DatabaseOperationDeadline } from '../prisma/prisma.service.js'
import type {
  ToolResult,
  UnvalidatedToolCallEnvelope,
} from '../tools/core/tool.types.js'
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
import {
  DatabaseCommitOutcomeUnknownError,
  DatabaseOperationDeadlineExceededError,
  PrismaService,
} from '../prisma/prisma.service.js'
import { toModelToolSpec } from '../tools/core/model-tool-spec.mapper.js'
import { ToolInvocationService } from '../tools/core/tool-invocation.service.js'
import {
  normalizeToolObservation,
  TOOL_OBSERVATION_HARD_MAX_CHARS,
} from '../tools/core/tool-observation.js'
import { ToolRegistryService } from '../tools/core/tool-registry.service.js'
import {
  AGENT_STEP_TYPES,
  AgentRunRecorderService,
} from './agent-run-recorder.service.js'
import {
  AgentLoopLimitExceededError,
  AgentRunDeadlineExceededError,
  AgentRunTerminalizationError,
  ModelSamplingIncompleteError,
} from './agent-runtime.errors.js'
import { AgentRuntimePolicyService } from './agent-runtime.policy.js'
import { streamModelSampling } from './model-sampling-decision.js'

const AGENT_RUN_TOOL_NAMES = [
  'search_articles',
  'get_article_detail',
] as const

const TERMINALIZATION_DEADLINE_MS = 5_000

type RunTerminationSource = 'completed' | 'completing' | 'deadline' | 'failure' | 'user'

interface RunCancellation {
  databaseDeadline: DatabaseOperationDeadline
  reason?: unknown
  signal: AbortSignal
  source?: RunTerminationSource
  claimCompletion: () => void
  claimCompleted: () => void
  claimCompletionFailure: (source: 'deadline' | 'failure', reason: unknown) => void
  claimDeadline: (reason?: AgentRunDeadlineExceededError) => void
  claimFailure: (reason: unknown) => void
  throwIfUnavailable: () => void
  dispose: () => void
}

interface TerminalStepFailure {
  id: string
  errorMessage: string
  output?: Prisma.InputJsonValue
}

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

    @Inject(AgentRuntimePolicyService)
    private readonly runtimePolicyService: AgentRuntimePolicyService,
  ) {}

  async* runTurnStream(input: RunTurnStreamInput): AsyncGenerator<AgentRuntimeEvent> {
    let assistantMessage: Message | undefined
    let agentRunId: string | undefined
    let content = ''
    let runCancellation: RunCancellation | undefined
    let terminalStepFailure: TerminalStepFailure | undefined

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
      const runtimePolicy = this.runtimePolicyService.value

      runCancellation = createRunCancellation(
        input.signal,
        runtimePolicy.runDeadlineMs,
      )
      const runSignal = runCancellation.signal
      const databaseDeadline = runCancellation.databaseDeadline

      const receiveUserMessageStep = await this.agentRunRecorderService.startStep({
        runId: currentAgentRunId,
        type: AGENT_STEP_TYPES.receiveUserMessage,
        input: {
          messageId: userMessage.id,
          messageLength: normalizedMessage.length,
        },
      }, databaseDeadline)
      await this.agentRunRecorderService.completeStep(
        receiveUserMessageStep.id,
        databaseDeadline,
      )

      const historyLimit = input.historyLimit
        ?? runtimePolicy.historyLimit
      const loadHistoryStep = await this.agentRunRecorderService.startStep({
        runId: currentAgentRunId,
        type: AGENT_STEP_TYPES.loadConversationHistory,
        input: {
          limit: historyLimit,
        },
      }, databaseDeadline)

      const historyMessages = await this.listRecentChatMessages(
        input.conversationId,
        historyLimit,
        databaseDeadline,
      )
      await this.agentRunRecorderService.completeStep(
        loadHistoryStep.id,
        databaseDeadline,
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
      const registeredToolDefinitions = this.toolRegistryService.listDefinitions()
      const toolDefinitions = AGENT_RUN_TOOL_NAMES.flatMap((name) => {
        const definition = registeredToolDefinitions.find(
          candidate => candidate.name === name,
        )

        return definition ? [definition] : []
      })
      const modelTools = runtimePolicy.maxToolCalls === 0
        ? []
        : toolDefinitions.map(toModelToolSpec)

      // 创建助手消息与 Run 关联必须同事务提交，避免 deadline 下留下未关联的 late Message。
      assistantMessage = await this.agentRunRecorderService.createAssistantMessage(
        currentAgentRunId,
        input.conversationId,
        databaseDeadline,
      )
      const assistantMessageId = assistantMessage.id

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
        }, databaseDeadline)
        assistantOutputStepId = step.id
      }

      const chatStreamOptions = {
        ...(input.model ? { model: input.model } : {}),
        temperature: input.temperature,
        ...(input.maxTokens === undefined
          ? {}
          : { maxTokens: input.maxTokens }),
        signal: runSignal,
        tools: modelTools,
      }

      let hasFinalAnswer = false
      let toolCallCount = 0

      for (
        let samplingAttempt = 1;
        samplingAttempt <= runtimePolicy.maxSamplingRounds;
        samplingAttempt += 1
      ) {
        runCancellation.throwIfUnavailable()
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
        }, databaseDeadline)
        const samplingStartedAt = Date.now()
        let samplingDecision: SamplingDecision

        try {
          // 两层 async generator 此时只创建迭代器；首次 sampling.next() 才启动模型请求并拉取事件。
          const sampling = streamModelSampling(
            this.llmService.chatStream(modelInputItems, chatStreamOptions),
            samplingAttemptId,
          )
          let samplingResult = await sampling.next()

          while (!samplingResult.done) {
            runCancellation.throwIfUnavailable()
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

          runCancellation.throwIfUnavailable()
          await this.agentRunRecorderService.completeStep(
            samplingStep.id,
            databaseDeadline,
            {
              output: this.toSamplingStepOutput(
                samplingDecision.summary,
                Date.now() - samplingStartedAt,
              ),
            },
          )
        }
        catch (error) {
          terminalStepFailure = {
            id: samplingStep.id,
            errorMessage: this.toChatStreamErrorMessage(error),
            output: this.toFailedSamplingStepOutput(
              error,
              Date.now() - samplingStartedAt,
            ),
          }
          claimRunTermination(runCancellation, error)
          throw error
        }

        runCancellation.throwIfUnavailable()

        if (samplingDecision.type === 'final_answer') {
          hasFinalAnswer = true
          break
        }

        if (toolCallCount >= runtimePolicy.maxToolCalls)
          throw new AgentLoopLimitExceededError()

        toolCallCount += 1

        const toolDefinition = toolDefinitions.find(
          definition => definition.name === samplingDecision.call.toolName,
        )
        // add toolstep runing
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
        }, databaseDeadline)
        const toolStartedAt = Date.now()
        let toolResult: ToolResult

        try {
          if (!toolDefinition) {
            toolResult = {
              ok: false,
              code: 'unknown_tool',
              modelContent: `工具 ${samplingDecision.call.toolName} 不存在。`,
              retryable: false,
            }
          }
          else {
            toolResult = await this.toolInvocationService.invoke(
              samplingDecision.call,
              {
                runId: currentAgentRunId,
                conversationId: input.conversationId,
                signal: runSignal,
                databaseDeadline,
                executionAttempt: 1,
              },
            )
          }
          runCancellation.throwIfUnavailable()
        }
        catch (error) {
          terminalStepFailure = {
            id: toolStep.id,
            errorMessage: '工具执行未能安全完成。',
            output: {
              durationMs: Date.now() - toolStartedAt,
            },
          }
          claimRunTermination(runCancellation, error)
          throw error
        }

        const observation = normalizeToolObservation(
          toolResult.modelContent,
          toolDefinition?.maxObservationChars
          ?? TOOL_OBSERVATION_HARD_MAX_CHARS,
        )
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
          await this.agentRunRecorderService.completeStep(
            toolStep.id,
            databaseDeadline,
            { output: toolStepOutput },
          )
        }
        else {
          await this.agentRunRecorderService.failStep(
            toolStep.id,
            databaseDeadline,
            {
              errorMessage: `工具 ${samplingDecision.call.toolName} 返回 ${toolResult.code}。`,
              output: toolStepOutput,
            },
          )
        }

        runCancellation.throwIfUnavailable()
        this.appendToolObservation(
          modelInputItems,
          samplingDecision.call,
          samplingDecision.intermediateText,
          samplingDecision.reasoningContent,
          observation.content,
          toolResult.ok,
        )
      }

      if (!hasFinalAnswer) {
        throw new AgentLoopLimitExceededError()
      }

      runCancellation.throwIfUnavailable()
      await startAssistantOutputStep()
      runCancellation.throwIfUnavailable()
      const completedMessage = await this.agentRunRecorderService.completeRun(
        {
          runId: currentAgentRunId,
          conversationId: input.conversationId,
          assistantMessageId,
          assistantOutputStepId: assistantOutputStepId!,
          content,
          output: {
            contentLength: content.length,
          },
        },
        databaseDeadline,
        runCancellation.claimCompletion,
      )
      runCancellation.claimCompleted()
      runCancellation.dispose()

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
      if (
        runCancellation?.source === 'completing'
        && error instanceof DatabaseCommitOutcomeUnknownError
      ) {
        throw new AgentRunTerminalizationError(error, error)
      }

      if (runCancellation) {
        claimRunTermination(runCancellation, error)

        if (runCancellation.source === 'completed')
          throw error
      }

      const userAborted = runCancellation?.source === 'user'
        || (!runCancellation && this.isAbortSignalTriggered(input.signal))
      const runCause = runCancellation?.reason ?? error

      runCancellation?.dispose()

      if (userAborted) {
        if (agentRunId) {
          try {
            await this.agentRunRecorderService.abortRun(
              agentRunId,
              createTerminalizationDeadline(),
              assistantMessage
                ? {
                    id: assistantMessage.id,
                    conversationId: input.conversationId,
                    content,
                  }
                : undefined,
            )
          }
          catch (terminalizationCause) {
            throw new AgentRunTerminalizationError(
              runCause,
              terminalizationCause,
            )
          }
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

      const errorMessage = this.toChatStreamErrorMessage(runCause)

      if (agentRunId) {
        try {
          await this.agentRunRecorderService.failRun(
            agentRunId,
            errorMessage,
            createTerminalizationDeadline(),
            assistantMessage
              ? {
                  id: assistantMessage.id,
                  conversationId: input.conversationId,
                  content: content || errorMessage,
                }
              : undefined,
            terminalStepFailure,
          )
        }
        catch (terminalizationCause) {
          throw new AgentRunTerminalizationError(
            runCause,
            terminalizationCause,
          )
        }
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
      runCancellation?.dispose()
    }
  }

  private async listRecentChatMessages(
    conversationId: string,
    limit: number,
    databaseDeadline: DatabaseOperationDeadline,
  ): Promise<Message[]> {
    const messages = await this.prismaService.withDeadlineTransaction(
      databaseDeadline,
      transaction => transaction.execute(prisma => prisma.message.findMany({
        where: {
          conversationId,
          status: MessageStatus.COMPLETED,
        },
        orderBy: [
          { createdAt: 'desc' },
          { id: 'desc' },
        ],
        take: limit,
      })),
    )

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
    if (
      error instanceof ModelSamplingIncompleteError
      || error instanceof AgentLoopLimitExceededError
      || error instanceof AgentRunDeadlineExceededError
    ) {
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
    if (error instanceof ModelSamplingIncompleteError && error.summary)
      return this.toSamplingStepOutput(error.summary, durationMs)

    return { durationMs }
  }

  private appendToolObservation(
    modelInputItems: ModelInputItem[],
    call: UnvalidatedToolCallEnvelope,
    intermediateText: string,
    reasoningContent: string,
    content: string,
    ok: boolean,
  ): void {
    modelInputItems.push(
      {
        type: 'assistant_tool_call',
        callId: call.callId,
        name: call.toolName,
        rawArgumentsJson: call.rawArgumentsJson,
        reasoningContent,
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

function createRunCancellation(
  userSignal: AbortSignal | undefined,
  deadlineMs: number,
): RunCancellation {
  const controller = new AbortController()
  const deadlineAt = Date.now() + deadlineMs
  let cancellation!: RunCancellation
  let deadlineId!: NodeJS.Timeout
  let pendingTermination: {
    source: 'deadline' | 'user'
    reason: unknown
  } | undefined
  const deadlineError = (): AgentRunDeadlineExceededError => (
    new AgentRunDeadlineExceededError()
  )
  const claim = (
    source: 'deadline' | 'failure' | 'user',
    reason: unknown,
  ): void => {
    if (cancellation.source === 'completing') {
      if (
        !pendingTermination
        && (source === 'deadline' || source === 'user')
      ) {
        pendingTermination = { source, reason }
      }
      return
    }

    if (cancellation.source)
      return

    cancellation.source = source
    cancellation.reason = reason
    controller.abort(reason)
  }
  const handleUserAbort = (): void => claim('user', userSignal?.reason)

  cancellation = {
    databaseDeadline: {
      deadlineAt,
      signal: controller.signal,
      createTimeoutError: () => new DatabaseOperationDeadlineExceededError(),
    },
    signal: controller.signal,
    claimCompletion: () => {
      cancellation.throwIfUnavailable()
      cancellation.source = 'completing'
    },
    claimCompleted: () => {
      if (cancellation.source !== 'completing')
        throw new Error('Agent Run 尚未取得 completion commit ownership')
      cancellation.source = 'completed'
      pendingTermination = undefined
    },
    claimCompletionFailure: (source, reason) => {
      if (cancellation.source !== 'completing') {
        claim(source, reason)
        return
      }

      const firstCause = pendingTermination ?? { source, reason }
      cancellation.source = firstCause.source
      cancellation.reason = firstCause.reason
      controller.abort(firstCause.reason)
      pendingTermination = undefined
    },
    claimDeadline: (reason = deadlineError()) => {
      claim('deadline', reason)
    },
    claimFailure: (reason) => {
      claim('failure', reason)
    },
    throwIfUnavailable: () => {
      if (!cancellation.source && Date.now() >= deadlineAt)
        cancellation.claimDeadline()

      if (
        cancellation.source === 'user'
        || cancellation.source === 'deadline'
        || cancellation.source === 'failure'
      ) {
        controller.signal.throwIfAborted()
      }
    },
    dispose: () => {
      clearTimeout(deadlineId)
      userSignal?.removeEventListener('abort', handleUserAbort)
    },
  }
  deadlineId = setTimeout(
    () => claim('deadline', deadlineError()),
    deadlineMs,
  )

  if (userSignal?.aborted)
    handleUserAbort()
  else
    userSignal?.addEventListener('abort', handleUserAbort, { once: true })

  return cancellation
}

function claimRunTermination(
  cancellation: RunCancellation,
  error: unknown,
): void {
  if (error instanceof DatabaseOperationDeadlineExceededError) {
    if (cancellation.source === 'completing') {
      cancellation.claimCompletionFailure(
        'deadline',
        new AgentRunDeadlineExceededError(),
      )
    }
    else {
      cancellation.claimDeadline()
    }
    return
  }

  if (cancellation.source === 'completing')
    cancellation.claimCompletionFailure('failure', error)
  else
    cancellation.claimFailure(error)
}

function createTerminalizationDeadline(): DatabaseOperationDeadline {
  return {
    deadlineAt: Date.now() + TERMINALIZATION_DEADLINE_MS,
    createTimeoutError: () => new Error('Agent Run 终态收口超过数据库等待上限。'),
  }
}
