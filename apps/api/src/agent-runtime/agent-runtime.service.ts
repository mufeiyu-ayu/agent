import type { MessageGroundingV1 } from '@agent/contracts'
import type {
  Message,
  Prisma,
  MessageRole as PrismaMessageRole,
  MessageStatus as PrismaMessageStatus,
} from '../generated/prisma/client.js'
import type { ChatMessage, ChatStreamOptions } from '../llm/llm.types.js'
import type { ModelUsage } from '../llm/model-stream.types.js'
import type { DatabaseOperationDeadline } from '../prisma/prisma.service.js'
import type { ToolResult } from '../tools/core/tool.types.js'
import type {
  AgentRuntimeEvent,
  RunTurnStreamInput,
} from './agent-runtime.types.js'
import type { HistoryCursor } from './context/initial-context-selection.js'
import type { SamplingContextPlanSummary } from './context/sampling-context-planner.js'
import type { GroundedFinalizationAttemptSummary } from './grounding/grounded-answer.finalizer.js'
import type { RunCancellation } from './lifecycle/run-cancellation.js'
import type { DebugModelIOCaptured } from './sampling/model-io-debug-capture.js'

import type {
  ModelSamplingSummary,
  SamplingDecision,
} from './sampling/model-sampling-decision.js'
import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common'
import { MessageRole, MessageStatus } from '../generated/prisma/client.js'
import { LLMService } from '../llm/llm.service.js'
import {
  DatabaseCommitOutcomeUnknownError,
  PrismaService,
} from '../prisma/prisma.service.js'
import { ToolInvocationService } from '../tools/core/tool-invocation.service.js'
import {
  normalizeToolObservation,
  TOOL_OBSERVATION_HARD_MAX_CHARS,
} from '../tools/core/tool-observation.js'
import { normalizeToolStepSummary } from '../tools/core/tool-step-summary.js'
import {
  AgentLoopLimitExceededError,
  AgentRunDeadlineExceededError,
  AgentRunTerminalizationError,
  ContextBudgetExceededError,
  ContextTokenEstimationError,
  ModelSamplingIncompleteError,
} from './agent-runtime.errors.js'
import { AgentRunConfigurationService } from './configuration/agent-run-configuration.service.js'
import {
  InitialContextSelectionService,
} from './context/initial-context-selection.js'
import { ModelContext } from './context/model-context.js'
import {
  SamplingContextBudgetExceededError,
  SamplingContextPlanner,
} from './context/sampling-context-planner.js'
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
  AGENT_STEP_TYPES,
  AgentRunRecorderService,
} from './lifecycle/agent-run-recorder.service.js'
import {
  claimRunTermination,
  createRunCancellation,
  createTerminalizationDeadline,
} from './lifecycle/run-cancellation.js'
import {
  toModelIODebugCaptureEnvelope,
  toModelIODebugResponseCaptureEnvelope,
} from './sampling/model-io-debug-capture.js'
import { streamModelSampling } from './sampling/model-sampling-decision.js'

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

interface ActiveSamplingClose {
  close: () => Promise<void>
  debugModelIO: DebugModelIOCaptured
  toMetadata: () => TerminalStepMetadata | undefined
}

@Injectable()
export class AgentRuntimeService {
  private readonly logger = new Logger(AgentRuntimeService.name)

  constructor(
    @Inject(LLMService)
    private readonly llmService: LLMService,

    @Inject(PrismaService)
    private readonly prismaService: PrismaService,

    @Inject(AgentRunRecorderService)
    private readonly agentRunRecorderService: AgentRunRecorderService,

    @Inject(ToolInvocationService)
    private readonly toolInvocationService: ToolInvocationService,

    @Inject(AgentRunConfigurationService)
    private readonly runConfigurationService: AgentRunConfigurationService,

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
    // 终态收口是否已由正常完成或 catch 接管。消费者提前 return()（如
    // for-await break）会让 yield 点以 return 语义恢复、跳过 catch，
    // 此时只有 finally 有机会兜底收口。
    let terminalizationHandled = false
    // 失败 / return 时仍需落库的最新安全 output；action sampling 与
    // finalization 不会同时处于 RUNNING，因此复用一个 metadata 槽位。
    let terminalStepMetadata: TerminalStepMetadata | undefined
    let activeSamplingClose: ActiveSamplingClose | undefined

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
      // Run deadline 必须先于请求级配置解析生效；policy 是启动期已校验的非抛错读取。
      const runtimePolicy = this.runConfigurationService.policy

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

      // 配置解析时机保持在 Run / receiveUserMessageStep 落库之后：请求级
      // 配置错误仍走既有 failRun 终态化，不改变 Run 生命周期语义。
      // 覆盖字段的规范化只在 resolve() 内做一层，这里不重复过滤。
      const { request: resolvedRequestConfig, toolDefinitions, modelTools }
        = this.runConfigurationService.resolve(input)
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
        contextWindowTokens: resolvedRequestConfig.contextWindowTokens,
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
          // 仅记录本次历史选择的安全统计，供 AgentStep / Admin 观测；
          // 真正传给 ModelContext 的消息仍使用 selection.historyMessages。
          output: {
            // 最终纳入模型上下文的历史消息条数。
            messageCount: selection.summary.historyIncludedCount,
            // 本次实际从数据库读取并进入 Token 检查的候选条数。
            candidateCount: selection.summary.historyCandidateCount,
            // 已读取候选中，因 Token 预算不足而未纳入的条数。
            excludedCount: selection.summary.historyExcludedCount,
            // budget：Token 预算不足；candidate_cap：达到候选上限；null：自然读完。
            excludedReason: selection.summary.excludedReason,
          },
        },
      )

      const modelContext = ModelContext.fromHistory({
        // 系统提示词
        instructions: input.buildModelMessages([]),
        // 历史消息（按时间倒序，最旧在前）
        initialHistory: selection.historyMessages,
        // 当前用户消息
        currentUserMessage: this.toLlmMessage(userMessage),
        // 信息统计快照
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

      // Initial Context、后续 Sampling 与 Grounded finalization 共用同一份
      // resolved 请求配置；Provider Client 端的重校验只会 fail-fast，不会漂移。
      const chatStreamOptions: ChatStreamOptions = {
        model: resolvedRequestConfig.model,
        reasoningEffort: resolvedRequestConfig.reasoningEffort,
        maxTokens: resolvedRequestConfig.maxOutputTokens,
        signal: runSignal,
        tools: modelTools,
      }

      // 只有某轮 Sampling 返回 final_answer 才置为 true；
      // 轮数耗尽后仍为 false 表示 Agent Loop 未正常完成。
      let hasFinalAnswer = false
      // 已发起的普通 action Tool Call 次数，用于限制 maxToolCalls；
      // 不计入 Grounded finalization 使用的终态提交工具。
      let toolCallCount = 0
      // Grounding Session：首次调用 evidence-eligible Tool 时建立，
      // 用于累积检索证据、零命中或工具失败等事实；建立后最终回答
      // 必须经过结构化 finalization，草稿不再直接流给用户。
      let evidenceRegistry: RunEvidenceRegistry | undefined
      // Grounding Session 建立后暂存模型草稿；校验通过前不 yield 给前端，
      // 也不写入 Assistant Message.content。
      let hiddenFinalDraft = ''

      for (
        let samplingAttempt = 1;
        samplingAttempt <= runtimePolicy.maxSamplingRounds;
        samplingAttempt += 1
      ) {
        runCancellation.throwIfUnavailable()
        const samplingAttemptId = `${currentAgentRunId}:sampling-${samplingAttempt}`
        const contextSnapshot = modelContext.snapshot(samplingAttempt)
        // 模型采样 step 创建完成
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
        // debug 捕获暂存：只有 AGENT_DEBUG_CAPTURE_MODEL_IO 开启时 client 才会回调，
        // 开关关闭时始终为空对象，落库输出与现状完全一致。
        const debugModelIO: DebugModelIOCaptured = {
          runId: currentAgentRunId,
          samplingAttemptId,
        }
        // 模型流完整结束后的业务决策：final_answer 或 tool_call。
        let samplingDecision: SamplingDecision
        // 模型流已正常收完时的统计；后续 Step 落库失败时仍可用于收口。
        let completedSamplingSummary: ModelSamplingSummary | undefined
        // Context Planner 已产生的预算、历史排除和 Observation 截断统计。
        let contextPlanSummary: SamplingContextPlanSummary | undefined
        // Planner 最终准备发给 Provider 的 ModelInputItem 数量。
        let plannedMessageCount = 0

        try {
          // 每轮请求模型前重新规划完整输入：首轮复核 Initial Context；
          // 后续轮次还要把上一轮模型产生的 assistant_tool_call 与后端产生的
          // tool_result 成对加入输入，超预算时先删最旧历史，再缩短 Tool Observation。
          const contextPlan = this.samplingContextPlanner.plan({
            samplingIndex: samplingAttempt,
            context: modelContext,
            tools: modelTools,
            resolvedInputBudgetTokens:
              selection.summary.resolvedInputBudgetTokens,
          })

          // 主要是后台观察：记录本轮预算、最终 Token、历史排除和 Tool Observation
          contextPlanSummary = contextPlan.summary
          plannedMessageCount = contextPlan.items.length

          runCancellation.throwIfUnavailable()
          // 两层 async generator 此时只创建迭代器；首次 sampling.next() 才启动模型请求并拉取事件。
          const sampling = streamModelSampling(
            this.llmService.chatStream(
              contextPlan.items,
              {
                ...chatStreamOptions,
                debugCapture: {
                  onRequest: (requestBody) => {
                    debugModelIO.requestBody = requestBody
                  },
                  onResponse: (responseCapture) => {
                    debugModelIO.rawResponse = responseCapture
                  },
                  onCaptureError: (side) => {
                    this.recordDebugCaptureFailure(debugModelIO, side)
                  },
                },
              },
            ),
            samplingAttemptId,
          )
          activeSamplingClose = {
            debugModelIO,
            close: async () => {
              try {
                await sampling.return(undefined as never)
              }
              catch {
                this.logger.warn({
                  event: 'model_sampling_iterator_close_failed',
                  runId: currentAgentRunId,
                  samplingAttemptId,
                })
              }
            },
            toMetadata: () => (
              debugModelIO.requestBody !== undefined
              || debugModelIO.rawResponse !== undefined
                ? {
                    id: samplingStep.id,
                    output: this.toFailedSamplingStepOutput(
                      undefined,
                      Date.now() - samplingStartedAt,
                      plannedMessageCount,
                      contextPlanSummary,
                      debugModelIO,
                    ),
                  }
                : undefined
            ),
          }
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
          completedSamplingSummary = samplingDecision.summary

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
                debugModelIO,
              ),
            },
          )
          activeSamplingClose = undefined
        }
        catch (error) {
          const closeSampling = activeSamplingClose

          activeSamplingClose = undefined
          await closeSampling?.close()
          terminalStepFailure = {
            id: samplingStep.id,
            errorMessage: this.toChatStreamErrorMessage(error),
            output: completedSamplingSummary
              ? this.toSamplingStepOutput(
                  completedSamplingSummary,
                  Date.now() - samplingStartedAt,
                  plannedMessageCount,
                  contextPlanSummary,
                  debugModelIO,
                )
              : this.toFailedSamplingStepOutput(
                  error,
                  Date.now() - samplingStartedAt,
                  plannedMessageCount,
                  contextPlanSummary,
                  debugModelIO,
                ),
          }
          claimRunTermination(runCancellation, error)
          this.logSamplingDebugCaptureClosed(
            debugModelIO,
            runCancellation.source === 'user'
              ? 'abort'
              : runCancellation.source === 'deadline'
                ? 'deadline'
                : 'failure',
          )
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
          terminalStepMetadata = {
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
            output: terminalStepMetadata!.output,
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
      terminalizationHandled = true
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
      // catch 一旦接管，终态收口（成功或失败）都由本块负责；finally 的
      // 兜底只针对 catch 未执行的 return() 路径。约定：本块每条分支都必须
      // 以「写入 DB 终态」或「向消费者交付终态事件」结束；新增早退 rethrow
      // 分支会静默失去 finally 兜底，必须自行保证收口。
      terminalizationHandled = true

      if (
        runCancellation?.source === 'completing'
        && error instanceof DatabaseCommitOutcomeUnknownError
      ) {
        yield* this.emitTerminalizationFailure({
          conversationId: input.conversationId,
          agentRunId,
          assistantMessage,
          runCause: error,
          terminalizationCause: error,
        })
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
              this.toAssistantMessageSnapshot(
                assistantMessage,
                input.conversationId,
                content,
              ),
              terminalStepFailure,
              terminalStepMetadata,
            )
          }
          catch (terminalizationCause) {
            yield* this.emitTerminalizationFailure({
              conversationId: input.conversationId,
              agentRunId,
              assistantMessage,
              runCause,
              terminalizationCause,
            })
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
            this.toAssistantMessageSnapshot(
              assistantMessage,
              input.conversationId,
              content || errorMessage,
            ),
            terminalStepFailure,
            terminalStepMetadata,
          )
        }
        catch (terminalizationCause) {
          yield* this.emitTerminalizationFailure({
            conversationId: input.conversationId,
            agentRunId,
            assistantMessage,
            runCause,
            terminalizationCause,
          })
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
      // 兜底收口：只覆盖消费者提前 return() 的路径（catch 未执行）。
      // 此时不存在进行中的数据库事务（return 只能发生在 yield 点），
      // 按用户中断语义收口为 ABORTED，避免 Run / Message 永久 RUNNING / STREAMING。
      if (!terminalizationHandled && agentRunId) {
        // 先取消在途模型请求：return() 路径不经过 claimRunTermination，
        // 不 abort 内部信号的话 provider 流会继续生成 token 直到自然结束。
        runCancellation?.claimFailure(new Error('流消费者提前终止了本次 Run'))
        const samplingClose = activeSamplingClose

        activeSamplingClose = undefined
        await samplingClose?.close()

        if (samplingClose) {
          terminalStepMetadata = samplingClose.toMetadata()
          this.logSamplingDebugCaptureClosed(
            samplingClose.debugModelIO,
            'consumer_return',
          )
        }

        try {
          await this.agentRunRecorderService.abortRun(
            agentRunId,
            createTerminalizationDeadline(),
            this.toAssistantMessageSnapshot(
              assistantMessage,
              input.conversationId,
              content,
            ),
            terminalStepFailure,
            terminalStepMetadata,
          )
        }
        catch (terminalizationCause) {
          // return 路径上没有消费者能接收异常；从 finally 抛出只会
          // 变成 return() 调用点的意外拒绝，这里记录后放弃。
          this.logger.error(
            `Agent Run ${agentRunId} 兜底收口失败`,
            terminalizationCause instanceof Error
              ? terminalizationCause.stack
              : String(terminalizationCause),
          )
        }
      }
      runCancellation?.dispose()
    }
  }

  /**
   * 终态收口失败（含 COMMIT 结果未知）的统一出口：先记服务端日志，再
   * best-effort 通知流消费者，最后抛出。日志必须在 yield 之前落：消费者
   * 收到 run_failed 后可能停止拉流（触发 return()），后面的 throw 就永远
   * 不会执行，这起最需要告警的事故不能只依赖异常传播才可见。
   */
  private async* emitTerminalizationFailure(input: {
    conversationId: string
    agentRunId: string | undefined
    assistantMessage: Message | undefined
    runCause: unknown
    terminalizationCause: unknown
  }): AsyncGenerator<AgentRuntimeEvent, never> {
    this.logger.error(
      `Agent Run ${input.agentRunId ?? '(未创建)'} 终态收口失败，DB 状态可能停留在非终态`,
      input.terminalizationCause instanceof Error
        ? input.terminalizationCause.stack
        : String(input.terminalizationCause),
    )

    yield {
      type: 'run_failed',
      ...(input.agentRunId ? { runId: input.agentRunId } : {}),
      conversationId: input.conversationId,
      ...(input.assistantMessage
        ? { assistantMessageId: input.assistantMessage.id }
        : {}),
      failureReason: 'terminalization_unknown',
      message: '本轮回答的收口结果未知，请刷新会话查看最终状态。',
    }

    throw new AgentRunTerminalizationError(
      input.runCause,
      input.terminalizationCause,
    )
  }

  private toAssistantMessageSnapshot(
    assistantMessage: Message | undefined,
    conversationId: string,
    content: string,
  ): { id: string, conversationId: string, content: string } | undefined {
    return assistantMessage
      ? {
          id: assistantMessage.id,
          conversationId,
          content,
        }
      : undefined
  }

  /**
   * 按时间倒序列出最近的已完成消息，分页游标为「严格早于」。
   * 仅返回已完成消息，未完成消息不计入分页。
   */
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
    debugModelIO?: DebugModelIOCaptured,
  ) {
    return {
      samplingAttemptId: summary.samplingAttemptId,
      messageCount,
      finishReason: summary.finishReason,
      usage: toPersistedModelUsage(summary.usage),
      toolCallCount: summary.toolCallCount,
      textChars: summary.textChars,
      intermediateTextChars: summary.intermediateTextChars,
      durationMs,
      ...(contextPlan
        ? { contextPlan: contextPlan as unknown as Prisma.InputJsonValue }
        : {}),
      ...this.toDebugModelIOOutput(debugModelIO),
    }
  }

  private toFailedSamplingStepOutput(
    error: unknown,
    durationMs: number,
    messageCount: number,
    contextPlan?: SamplingContextPlanSummary,
    debugModelIO?: DebugModelIOCaptured,
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
        debugModelIO,
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
      ...this.toDebugModelIOOutput(debugModelIO),
    }
  }

  /**
   * 把 debug 捕获暂存收敛成落库字段；未捕获时返回空对象，输出保持现状。
   * 序列化失败降级为不写该侧字段并记 warning，不影响采样流程。
   */
  private toDebugModelIOOutput(
    debugModelIO?: DebugModelIOCaptured,
  ): Record<string, Prisma.InputJsonValue> {
    const output: Record<string, Prisma.InputJsonValue> = {}

    if (debugModelIO?.requestBody !== undefined) {
      const envelope = toModelIODebugCaptureEnvelope(debugModelIO.requestBody)

      if (envelope) {
        output.debugRequestBody = envelope as unknown as Prisma.InputJsonValue
      }
      else {
        this.logger.warn({
          event: 'model_sampling_debug_capture_serialization_failed',
          runId: debugModelIO.runId,
          samplingAttemptId: debugModelIO.samplingAttemptId,
          captureSide: 'request',
        })
      }
    }

    if (debugModelIO?.rawResponse !== undefined) {
      const capture = debugModelIO.rawResponse
      const envelope = toModelIODebugResponseCaptureEnvelope(capture)

      if (envelope) {
        output.debugRawResponse = envelope as unknown as Prisma.InputJsonValue
      }
      else {
        this.logger.warn({
          event: 'model_sampling_debug_capture_serialization_failed',
          runId: debugModelIO.runId,
          samplingAttemptId: debugModelIO.samplingAttemptId,
          captureSide: 'response',
          captureState: capture.state,
          lastModelEvent: capture.lastEvent,
          textChars: capture.textChars,
          toolCallCount: capture.toolCallCount,
        })
      }
    }

    return output
  }

  private recordDebugCaptureFailure(
    debugModelIO: DebugModelIOCaptured,
    side: 'request' | 'response',
  ): void {
    debugModelIO.failedSides ??= []

    if (debugModelIO.failedSides.includes(side))
      return

    debugModelIO.failedSides.push(side)
    this.logger.warn({
      event: 'model_sampling_debug_capture_failed',
      runId: debugModelIO.runId,
      samplingAttemptId: debugModelIO.samplingAttemptId,
      captureSide: side,
    })
  }

  private logSamplingDebugCaptureClosed(
    debugModelIO: DebugModelIOCaptured,
    termination: 'abort' | 'consumer_return' | 'deadline' | 'failure',
  ): void {
    const capture = debugModelIO.rawResponse

    if (!capture)
      return

    this.logger.warn({
      event: 'model_sampling_debug_capture_closed',
      runId: debugModelIO.runId,
      samplingAttemptId: debugModelIO.samplingAttemptId,
      termination,
      captureState: capture.state,
      lastModelEvent: capture.lastEvent,
      textChars: capture.textChars,
      toolCallCount: capture.toolCallCount,
    })
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
        usage: toPersistedModelUsage(attempt.usage),
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

function toPersistedModelUsage(
  usage: ModelUsage | null,
): Prisma.InputJsonObject | null {
  return usage
    ? Object.fromEntries(
      Object.entries(usage).filter(([, value]) => value !== undefined),
    ) as Prisma.InputJsonObject
    : null
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
