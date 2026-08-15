import type { MessageGroundingV1 } from '@agent/contracts'
import type {
  Message,
  Prisma,
  MessageRole as PrismaMessageRole,
  MessageStatus as PrismaMessageStatus,
} from '../generated/prisma/client.js'
import type { ChatMessage } from '../llm/llm.types.js'
import type { DatabaseOperationDeadline } from '../prisma/prisma.service.js'
import type { ToolResult } from '../tools/core/tool.types.js'
import type {
  AgentRuntimeEvent,
  RunTurnStreamInput,
} from './agent-runtime.types.js'
import type { GroundedFinalizationAttemptSummary } from './grounding/grounded-answer.finalizer.js'
import type { HistoryCursor } from './initial-context-selection.js'
import type {
  ModelSamplingSummary,
  SamplingDecision,
} from './model-sampling-decision.js'
import type { SamplingContextPlanSummary } from './sampling-context-planner.js'

import { Inject, Injectable, NotFoundException } from '@nestjs/common'
import { MessageRole, MessageStatus } from '../generated/prisma/client.js'
import { LLMService } from '../llm/llm.service.js'
import { getModelProfile } from '../llm/model-profiles.js'
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
import { normalizeToolStepSummary } from '../tools/core/tool-step-summary.js'
import {
  AGENT_STEP_TYPES,
  AgentRunRecorderService,
} from './agent-run-recorder.service.js'
import {
  AgentLoopLimitExceededError,
  AgentRunDeadlineExceededError,
  AgentRunTerminalizationError,
  ContextBudgetExceededError,
  ContextTokenEstimationError,
  ModelSamplingIncompleteError,
} from './agent-runtime.errors.js'
import { AgentRuntimePolicyService } from './agent-runtime.policy.js'
import { submitGroundedAnswerToolSpec } from './grounding/grounded-answer.contract.js'
import {
  GroundedFinalizationFailedError,
  GroundedFinalizationSamplingError,
  runGroundedFinalization,
} from './grounding/grounded-answer.finalizer.js'
import { toMessageGroundingV1 } from './grounding/message-grounding.projector.js'
import { RunEvidenceRegistry } from './grounding/run-evidence-registry.js'
import { toValidatedAnswerChunks } from './grounding/validated-answer-replay.js'
import {
  InitialContextSelectionService,
} from './initial-context-selection.js'
import { ModelContext } from './model-context.js'
import { streamModelSampling } from './model-sampling-decision.js'
import {
  SamplingContextBudgetExceededError,
  SamplingContextPlanner,
} from './sampling-context-planner.js'

const AGENT_RUN_TOOL_NAMES = [
  'search_articles',
  'get_article_detail',
  'retrieve_article_context',
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

/** 失败 / 中断收口时仍需保留 output 的 Step。 */
interface TerminalStepMetadata {
  id: string
  output: Prisma.InputJsonValue
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

    @Inject(InitialContextSelectionService)
    private readonly initialContextSelectionService: InitialContextSelectionService,

    @Inject(SamplingContextPlanner)
    private readonly samplingContextPlanner: SamplingContextPlanner,
  ) {}

  async* runTurnStream(input: RunTurnStreamInput): AsyncGenerator<AgentRuntimeEvent> {
    let assistantMessage: Message | undefined
    let agentRunId: string | undefined
    let content = ''
    let runCancellation: RunCancellation | undefined
    let terminalStepFailure: TerminalStepFailure | undefined
    // finalization Step 的最新已知安全 output。一旦模型调用发生过，
    // 无论 replay Abort、Step 启动失败还是终态事务回滚，都用它收口，
    // 已经产生的 attempt 与 usage 不会从审计里消失。
    let finalizationClose: TerminalStepMetadata | undefined

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
      const resolvedRequestConfig = this.llmService.resolveChatRequestConfig({
        ...(input.model ? { model: input.model } : {}),
        ...(input.maxTokens === undefined
          ? {}
          : { maxTokens: input.maxTokens }),
      })
      const modelProfile = getModelProfile(resolvedRequestConfig.model)!
      const loadHistoryStep = await this.agentRunRecorderService.startStep({
        runId: currentAgentRunId,
        type: AGENT_STEP_TYPES.loadConversationHistory,
        input: {
          limit: runtimePolicy.historyCandidateHardLimit,
          batchSize: runtimePolicy.historyCandidateBatchSize,
        },
      }, databaseDeadline)

      const selection = await this.initialContextSelectionService.select({
        resolvedModel: resolvedRequestConfig.model,
        contextWindowTokens: modelProfile.contextWindowTokens,
        resolvedMaxOutputTokens: resolvedRequestConfig.maxOutputTokens,
        candidateBatchSize: runtimePolicy.historyCandidateBatchSize,
        candidateHardLimit: runtimePolicy.historyCandidateHardLimit,
        currentUserMessage: this.toLlmMessage(userMessage),
        tools: modelTools,
        buildModelMessages: input.buildModelMessages,
        loadCandidates: async ({ cursor, take }) => {
          const messages = await this.listRecentChatMessageCandidates(
            input.conversationId,
            {
              id: userMessage.id,
              createdAt: userMessage.createdAt,
            },
            cursor,
            take,
            databaseDeadline,
          )

          return messages.map(message => ({
            id: message.id,
            createdAt: message.createdAt,
            message: this.toLlmMessage(message),
          }))
        },
        assertAvailable: runCancellation.throwIfUnavailable,
      })
      await this.agentRunRecorderService.completeStep(
        loadHistoryStep.id,
        databaseDeadline,
        {
          output: {
            messageCount: selection.summary.historyIncludedCount,
            candidateCount: selection.summary.historyCandidateCount,
            excludedCount: selection.summary.historyExcludedCount,
            excludedReason: selection.summary.excludedReason,
          },
        },
      )

      const modelContext = ModelContext.fromHistory({
        instructions: input.buildModelMessages([]),
        initialHistory: selection.historyMessages,
        currentUserMessage: this.toLlmMessage(userMessage),
        initialSelection: selection.summary,
      })

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
        model: resolvedRequestConfig.model,
        temperature: input.temperature,
        maxTokens: resolvedRequestConfig.maxOutputTokens,
        signal: runSignal,
        tools: modelTools,
      }

      let hasFinalAnswer = false
      let toolCallCount = 0
      // Grounding Session：首次调用 evidence-eligible Tool 时建立，
      // 此后本轮最终回答必须经过结构化 finalization，草稿不再直接流给用户。
      let evidenceRegistry: RunEvidenceRegistry | undefined
      let hiddenFinalDraft = ''

      for (
        let samplingAttempt = 1;
        samplingAttempt <= runtimePolicy.maxSamplingRounds;
        samplingAttempt += 1
      ) {
        runCancellation.throwIfUnavailable()
        const samplingAttemptId = `${currentAgentRunId}:sampling-${samplingAttempt}`
        const contextSnapshot = modelContext.snapshot(samplingAttempt)
        const samplingStep = await this.agentRunRecorderService.startStep({
          runId: currentAgentRunId,
          type: AGENT_STEP_TYPES.modelSampling,
          input: {
            samplingIndex: samplingAttempt,
            samplingAttemptId,
            requestedModel: input.model ?? null,
            candidateMessageCount: contextSnapshot.itemCount,
            toolCount: modelTools.length,
            ...(contextSnapshot.initialSelection
              ? { initialContext: { ...contextSnapshot.initialSelection } }
              : {}),
          },
        }, databaseDeadline)
        const samplingStartedAt = Date.now()
        let samplingDecision: SamplingDecision
        let contextPlanSummary: SamplingContextPlanSummary | undefined
        let plannedMessageCount = 0

        try {
          const contextPlan = this.samplingContextPlanner.plan({
            samplingIndex: samplingAttempt,
            context: modelContext,
            tools: modelTools,
            resolvedInputBudgetTokens:
              selection.summary.resolvedInputBudgetTokens,
          })
          contextPlanSummary = contextPlan.summary
          plannedMessageCount = contextPlan.items.length

          runCancellation.throwIfUnavailable()
          // 两层 async generator 此时只创建迭代器；首次 sampling.next() 才启动模型请求并拉取事件。
          const sampling = streamModelSampling(
            this.llmService.chatStream(
              contextPlan.items,
              chatStreamOptions,
            ),
            samplingAttemptId,
          )
          let samplingResult = await sampling.next()

          while (!samplingResult.done) {
            runCancellation.throwIfUnavailable()

            if (evidenceRegistry) {
              // 已建立 Grounding Session：草稿只留在服务端内存，
              // 校验通过前既不发 assistant_delta，也不写入 Message.content。
              hiddenFinalDraft += samplingResult.value
            }
            else {
              await startAssistantOutputStep()
              content += samplingResult.value
              yield {
                type: 'assistant_delta',
                runId: currentAgentRunId,
                conversationId: input.conversationId,
                assistantMessageId,
                contentDelta: samplingResult.value,
              }
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
                plannedMessageCount,
                contextPlanSummary,
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
              plannedMessageCount,
              contextPlanSummary,
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
        // 工具自愿提供的安全摘要；未通过 JSON / 体积 / 深度校验时整项跳过，
        // 既不写入 AgentStep，也不影响 Tool Result 与本轮 Run 的收口。
        const toolSummary = toolResult.ok
          ? normalizeToolStepSummary(toolResult.stepSummary)
          : undefined
        const toolStepOutput = {
          ok: toolResult.ok,
          ...(toolResult.ok
            ? {}
            : {
                code: toolResult.code,
                retryable: toolResult.retryable,
              }),
          ...(toolSummary ? { toolSummary } : {}),
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

        // Evidence policy 由服务端 Tool Definition 声明，模型 arguments 无法改变；
        // zero-hit、not found 和执行失败同样建立 Session，它们是不同的证据事实。
        if (toolDefinition?.evidencePolicy === 'eligible') {
          evidenceRegistry ??= new RunEvidenceRegistry()
          evidenceRegistry.recordEligibleToolOutcome({
            toolName: toolDefinition.name,
            ok: toolResult.ok,
            // 始终原样传入：缺失投影本身就是需要被记录为 evidence failure 的事实，
            // 不能在这里先过滤掉再让 Registry 误判成合法零命中。
            evidence: toolResult.ok ? toolResult.evidence : undefined,
          })
        }

        runCancellation.throwIfUnavailable()
        modelContext.appendToolExchange({
          call: samplingDecision.call,
          intermediateText: samplingDecision.intermediateText,
          reasoningContent: samplingDecision.reasoningContent,
          observation,
          ok: toolResult.ok,
        })
      }

      if (!hasFinalAnswer) {
        throw new AgentLoopLimitExceededError()
      }

      runCancellation.throwIfUnavailable()

      let grounding: MessageGroundingV1 | undefined
      let finalizationCommit: TerminalStepMetadata | undefined

      if (evidenceRegistry) {
        const finalizationStep = await this.agentRunRecorderService.startStep({
          runId: currentAgentRunId,
          type: AGENT_STEP_TYPES.groundedFinalization,
          input: {
            assistantMessageId,
            evidenceAvailability: evidenceRegistry.evidenceAvailability(),
            registryRefCount: evidenceRegistry.summary().refCount,
            registryTruncated: evidenceRegistry.summary().registryTruncated,
          },
        }, databaseDeadline)
        const registry = evidenceRegistry
        // Runtime 自己持有 attempt 事实：模型调用一开始就记账，
        // 不依赖某一种错误类型是否恰好把 attempts 带出来。
        const finalizationAttempts: GroundedFinalizationAttemptSummary[] = []
        const closeFinalizationStep = (error?: unknown): void => {
          finalizationClose = {
            id: finalizationStep.id,
            output: this.toFinalizationStepOutput(
              registry,
              finalizationAttempts,
              grounding,
              error,
            ),
          }
        }

        closeFinalizationStep()

        try {
          const finalization = await runGroundedFinalization({
            draft: hiddenFinalDraft,
            registry,
            assertAvailable: runCancellation.throwIfUnavailable,
            onAttempt: (summary) => {
              finalizationAttempts.push(summary)
              closeFinalizationStep()
            },
            // finalization 只暴露终态输出契约，没有任何 action Tool，
            // 因此不可能借这一轮继续调用工具或扩展 action-loop 预算。
            sample: items => this.llmService.chatStream(items, {
              ...chatStreamOptions,
              tools: [submitGroundedAnswerToolSpec],
            }),
          })

          // done 事件与 Messages API 必须来自同一个 durable safe projector：
          // 这里先按持久化形状过一遍投影，投影不通过就 fail closed，不写库也不外发。
          const projected = toMessageGroundingV1(finalization.validated.grounding)

          if (!projected) {
            throw new GroundedFinalizationFailedError(
              'schema_invalid',
              finalization.attempts,
            )
          }

          grounding = projected
          // finalization Step 在 replay 期间保持 RUNNING：只有 replay 全部完成、
          // 终态事务提交成功，它才和 Message / Grounding / Run 一起变成 COMPLETED。
          finalizationCommit = {
            id: finalizationStep.id,
            output: this.toFinalizationStepOutput(
              registry,
              finalizationAttempts,
              grounding,
            ),
          }
          // 成功后的失败路径（replay Abort / Step 失败 / 终态事务回滚）
          // 同样保留这份已经成立的 attempt 与 usage。
          closeFinalizationStep()

          runCancellation.throwIfUnavailable()
          await startAssistantOutputStep()

          // 校验通过后才通过既有 assistant_delta 重放正文；
          // chunks 拼接逐字符等于 persisted content 与 done.content。
          for (const contentDelta of toValidatedAnswerChunks(
            finalization.validated.answer,
          )) {
            runCancellation.throwIfUnavailable()
            content += contentDelta
            yield {
              type: 'assistant_delta',
              runId: currentAgentRunId,
              conversationId: input.conversationId,
              assistantMessageId,
              contentDelta,
            }
          }
        }
        catch (error) {
          closeFinalizationStep(error)
          terminalStepFailure = {
            id: finalizationStep.id,
            errorMessage: error instanceof GroundedFinalizationFailedError
              ? error.message
              : '回答引用校验未能安全完成。',
            output: finalizationClose!.output,
          }
          claimRunTermination(runCancellation, error)
          throw error
        }
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
          ...(grounding ? { grounding } : {}),
          ...(finalizationCommit ? { finalizationStep: finalizationCommit } : {}),
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
        ...(grounding ? { grounding } : {}),
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
              finalizationClose,
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
            finalizationClose,
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

  private async listRecentChatMessageCandidates(
    conversationId: string,
    currentUserUpperBound: HistoryCursor,
    cursor: HistoryCursor | undefined,
    take: number,
    databaseDeadline: DatabaseOperationDeadline,
  ): Promise<Message[]> {
    const messages = await this.prismaService.withDeadlineTransaction(
      databaseDeadline,
      transaction => transaction.execute(prisma => prisma.message.findMany({
        where: {
          conversationId,
          status: MessageStatus.COMPLETED,
          AND: [
            toStrictlyEarlierMessageWhere(currentUserUpperBound),
            ...(cursor ? [toStrictlyEarlierMessageWhere(cursor)] : []),
          ],
        },
        orderBy: [
          { createdAt: 'desc' },
          { id: 'desc' },
        ],
        take,
      })),
    )

    return messages
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
      || error instanceof ContextBudgetExceededError
      || error instanceof ContextTokenEstimationError
      // 引用校验失败必须与「知识库没有答案」区分开，不能伪装成 zero-hit。
      || error instanceof GroundedFinalizationFailedError
    ) {
      return error.message
    }

    return '模型服务暂时没有返回结果，请稍后重试。'
  }

  private toSamplingStepOutput(
    summary: ModelSamplingSummary,
    durationMs: number,
    messageCount: number,
    contextPlan?: SamplingContextPlanSummary,
  ) {
    return {
      samplingAttemptId: summary.samplingAttemptId,
      messageCount,
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
      ...(contextPlan
        ? { contextPlan: contextPlan as unknown as Prisma.InputJsonValue }
        : {}),
    }
  }

  private toFailedSamplingStepOutput(
    error: unknown,
    durationMs: number,
    messageCount: number,
    contextPlan?: SamplingContextPlanSummary,
  ) {
    const failedContextPlan = contextPlan
      ?? (error instanceof SamplingContextBudgetExceededError
        ? error.summary
        : undefined)

    if (error instanceof ModelSamplingIncompleteError && error.summary) {
      return this.toSamplingStepOutput(
        error.summary,
        durationMs,
        messageCount,
        failedContextPlan,
      )
    }

    return {
      durationMs,
      messageCount,
      ...(error instanceof ContextTokenEstimationError
        ? { contextFailureReason: 'estimator_failure' as const }
        : {}),
      ...(failedContextPlan
        ? {
            contextPlan:
              failedContextPlan as unknown as Prisma.InputJsonValue,
          }
        : {}),
    }
  }

  /**
   * finalization Step 的 bounded 审计输出。
   *
   * 刻意不写入 finalization Prompt、reasoning、hidden draft、证据 excerpt 全文
   * 和 citationKey；只保留可审计的计数、状态与安全错误类别。
   */
  private toFinalizationStepOutput(
    registry: RunEvidenceRegistry,
    attempts: GroundedFinalizationAttemptSummary[],
    grounding?: MessageGroundingV1,
    error?: unknown,
  ): Prisma.InputJsonValue {
    const summary = registry.summary()

    return {
      evidenceAvailability: summary.evidenceAvailability,
      registryRefCount: summary.refCount,
      registryTruncated: summary.registryTruncated,
      eligibleToolCallCount: summary.eligibleToolCallCount,
      eligibleToolFailureCount: summary.eligibleToolFailureCount,
      attemptCount: attempts.length,
      attempts: attempts.map(attempt => ({
        attempt: attempt.attempt,
        ok: attempt.ok,
        ...(attempt.rejectionCode
          ? { rejectionCode: attempt.rejectionCode }
          : {}),
        // 采样故障与「模型说错了」在审计里必须能逐 attempt 区分开。
        ...(attempt.samplingFailure
          ? { samplingFailure: attempt.samplingFailure }
          : {}),
        submittedCitationKeyCount: attempt.submittedCitationKeyCount,
        usage: attempt.usage
          ? {
              ...(attempt.usage.inputTokens === undefined
                ? {}
                : { inputTokens: attempt.usage.inputTokens }),
              ...(attempt.usage.outputTokens === undefined
                ? {}
                : { outputTokens: attempt.usage.outputTokens }),
              ...(attempt.usage.totalTokens === undefined
                ? {}
                : { totalTokens: attempt.usage.totalTokens }),
            }
          : null,
        durationMs: attempt.durationMs,
      })),
      ...(grounding
        ? {
            outcome: grounding.outcome,
            citationCount: grounding.citations.length,
            citationIntegrity: grounding.citationIntegrity,
            faithfulnessStatus: grounding.faithfulnessStatus,
            schemaVersion: grounding.schemaVersion,
          }
        : {}),
      ...(error instanceof GroundedFinalizationFailedError
        ? { failureReason: 'validation_failed', rejectionCode: error.rejectionCode }
        : {}),
      // Provider 流不完整与「模型说错了」必须能在审计里区分开。
      ...(error instanceof GroundedFinalizationSamplingError
        ? { failureReason: 'sampling_incomplete', samplingFailure: error.failure }
        : {}),
      ...(error !== undefined
        && !(error instanceof GroundedFinalizationFailedError)
        && !(error instanceof GroundedFinalizationSamplingError)
        ? { failureReason: 'finalization_incomplete' }
        : {}),
    }
  }

  private isAbortSignalTriggered(signal: AbortSignal | undefined): boolean {
    return signal?.aborted ?? false
  }
}

function toStrictlyEarlierMessageWhere(bound: HistoryCursor) {
  return {
    OR: [
      { createdAt: { lt: bound.createdAt } },
      {
        createdAt: bound.createdAt,
        id: { lt: bound.id },
      },
    ],
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
