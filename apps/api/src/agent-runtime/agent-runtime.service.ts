import type {
  ChatStreamOptions,
  MessageInputItem,
  ModelUsage,
} from '@agent/ai'
import type { MessageGroundingV1 } from '@agent/contracts'
import type {
  Message,
  Prisma,
  MessageRole as PrismaMessageRole,
  MessageStatus as PrismaMessageStatus,
} from '../generated/prisma/client.js'
import type { DatabaseOperationDeadline } from '../prisma/prisma.service.js'
import type { NormalizedToolObservation } from '../tools/core/tool-observation.js'
import type { ToolResult } from '../tools/core/tool.types.js'
import type {
  AgentRuntimeEvent,
  RunTurnStreamInput,
} from './agent-runtime.types.js'
import type { AgentRuntimePolicy } from './configuration/agent-runtime.policy.js'
import type { TokenEstimator } from './context/deepseek-v4-token-estimator.js'
import type { InitialContextSummary } from './context/initial-context.js'
import type { SamplingContextPlanSummary } from './context/sampling-context-planner.js'
import type { GroundedFinalizationAttemptSummary } from './grounding/grounded-answer.finalizer.js'
import type {
  CloseAgentStepInput,
  CloseAgentStepMetadata,
} from './lifecycle/agent-run-recorder.service.js'
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
import { ToolRegistryService } from '../tools/core/tool-registry.service.js'
import { normalizeToolStepSummary } from '../tools/core/tool-step-summary.js'
import { TOOL_DEFINITIONS } from '../tools/tool-definitions.js'
import {
  AgentLoopLimitExceededError,
  AgentRunDeadlineExceededError,
  AgentRunTerminalizationError,
  ContextBudgetExceededError,
  ContextTokenEstimationError,
  ModelSamplingIncompleteError,
} from './agent-runtime.errors.js'
import { AgentRuntimePolicyService } from './configuration/agent-runtime.policy.js'
import { DeepSeekV4TokenEstimator } from './context/deepseek-v4-token-estimator.js'
import { summarizeInitialContext } from './context/initial-context.js'
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

interface ActiveSamplingClose {
  close: () => Promise<void>
  debugModelIO: DebugModelIOCaptured
  toMetadata: () => CloseAgentStepMetadata | undefined
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

    @Inject(AgentRuntimePolicyService)
    private readonly runtimePolicyService: AgentRuntimePolicyService,

    @Inject(ToolRegistryService)
    private readonly toolRegistryService: ToolRegistryService,

    @Inject(DeepSeekV4TokenEstimator)
    private readonly tokenEstimator: TokenEstimator,

    @Inject(SamplingContextPlanner)
    private readonly samplingContextPlanner: SamplingContextPlanner,
  ) {}

  async* runTurnStream(input: RunTurnStreamInput): AsyncGenerator<AgentRuntimeEvent> {
    let assistantMessage: Message | undefined
    let agentRunId: string | undefined
    let content = ''
    let runCancellation: RunCancellation | undefined
    let terminalStepFailure: CloseAgentStepInput | undefined
    // 终态收口是否已由正常完成或 catch 接管。消费者提前 return()（如
    // for-await break）会让 yield 点以 return 语义恢复、跳过 catch，
    // 此时只有 finally 有机会兜底收口。
    let terminalizationHandled = false
    // 失败 / return 时仍需落库的最新安全 output；action sampling 与
    // finalization 不会同时处于 RUNNING，因此复用一个 metadata 槽位。
    let terminalStepMetadata: CloseAgentStepMetadata | undefined
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
      const runtimePolicy = this.runtimePolicyService.value

      runCancellation = createRunCancellation(
        input.signal,
        runtimePolicy.runDeadlineMs,
      )
      const runSignal = runCancellation.signal
      const databaseDeadline = runCancellation.databaseDeadline

      // 配置解析时机保持在 Run 落库之后：请求级配置错误仍走既有 failRun
      // 终态化，不改变 Run 生命周期语义。
      const { request: resolvedRequestConfig, toolDefinitions, modelTools }
        = this.resolveRunConfiguration(input, runtimePolicy)
      const loadHistoryStep = await this.agentRunRecorderService.startStep({
        runId: currentAgentRunId,
        type: AGENT_STEP_TYPES.loadConversationHistory,
      }, databaseDeadline)

      // 查询前后各检查一次用户取消或 Run 超时；await 期间也可能发生。
      runCancellation.throwIfUnavailable()
      const historyCandidates = await this.listRecentMessageCandidates(
        input.conversationId,
        userMessage,
        runtimePolicy.historyCandidateHardLimit,
        databaseDeadline,
      )
      runCancellation.throwIfUnavailable()

      const modelContext = ModelContext.fromHistory({
        // 系统提示词
        instructions: input.instructions,
        // 全部历史候选：数据库按「最新 -> 最旧」读取，模型上下文恢复为
        // 「最旧 -> 最新」；首轮 plan() 超预算时从最旧删减
        initialHistory: historyCandidates
          .map(message => this.toLlmMessage(message))
          .reverse(),
        // 当前用户消息
        currentUserMessage: this.toLlmMessage(userMessage),
      })
      // 裁剪前快照，写入每个 sampling Step 的 input.initialContext。
      // 估算失败或必带内容超预算都在这里抛出，此时 load_conversation_history
      // 仍为 RUNNING，由 failRun 收口为 FAILED，不会创建 sampling Step，也不会调用模型。
      const initialContext = summarizeInitialContext({
        resolvedModel: resolvedRequestConfig.model,
        contextWindowTokens: resolvedRequestConfig.contextWindowTokens,
        resolvedMaxOutputTokens: resolvedRequestConfig.maxOutputTokens,
        candidateHardLimit: runtimePolicy.historyCandidateHardLimit,
        context: modelContext,
        tools: modelTools,
        tokenEstimator: this.tokenEstimator,
      })
      await this.agentRunRecorderService.completeStep(
        loadHistoryStep.id,
        databaseDeadline,
        {
          // 仅记录本次读取的安全统计，供 AgentStep / Admin 观测；
          // 预算裁剪发生在首轮 plan()，体现在 sampling Step 的 contextPlan。
          output: {
            // 进入 ModelContext 的历史条数，等于一次读到的条数。
            messageCount: initialContext.historyIncludedCount,
            // 本次实际从数据库读取的候选条数。
            candidateCount: initialContext.historyCandidateCount,
            // 读取阶段不再按预算排除，恒为 0。
            excludedCount: initialContext.historyExcludedCount,
            // candidate_cap：读取条数触到硬上限；null：自然读完。
            excludedReason: initialContext.excludedReason,
          },
        },
      )

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
      // 用户可见输出一开始就启动该 Step：非 Grounding 模式下 Tool Call 之前的中间文本也是
      // 可见输出，因此它可能早于本轮的 tool_execution Step 创建，并在整个工具循环期间保持 RUNNING。
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
      // 已发起的普通 action Tool Call 次数，按 call 计数（同轮多个 call 各算一次），
      // 用于限制 maxToolCalls；不计入 Grounded finalization 使用的终态提交工具。
      let toolCallCount = 0
      // Grounding Session：首次调用 evidence-eligible Tool 时建立，
      // 用于累积检索证据、零命中或工具失败等事实；建立后最终回答
      // 必须经过结构化 finalization，草稿不再直接流给用户。
      let evidenceRegistry: RunEvidenceRegistry | undefined
      // Grounding Session 建立后暂存最终回答那一轮的模型草稿；校验通过前不 yield 给前端，
      // 也不写入 Assistant Message.content。带 Tool Call 的轮次文本不进这里，只回填模型。
      let hiddenFinalDraft = ''

      for (
        let samplingAttempt = 1;
        samplingAttempt <= runtimePolicy.maxSamplingRounds;
        samplingAttempt += 1
      ) {
        runCancellation.throwIfUnavailable()
        const samplingAttemptId = `${currentAgentRunId}:sampling-${samplingAttempt}`
        // 模型采样 step 创建完成
        const samplingStep = await this.agentRunRecorderService.startStep({
          runId: currentAgentRunId,
          type: AGENT_STEP_TYPES.modelSampling,
          input: {
            samplingIndex: samplingAttempt,
            samplingAttemptId,
            initialContext: toPersistedInitialContext(initialContext),
          },
        }, databaseDeadline)
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
        // Grounding Session 建立后本轮暂存的文本；流结束前不知道它是草稿还是 Tool Call 前的中间文本。
        let roundHiddenText = ''

        try {
          // 每轮请求模型前重新规划完整输入：首轮把一次读到的全部历史按预算裁剪；
          // 后续轮次还要把上一轮模型产生的 assistant_tool_call 与后端产生的
          // tool_result 成对加入输入，超预算时先删最旧历史，再缩短 Tool Observation。
          const contextPlan = this.samplingContextPlanner.plan({
            samplingIndex: samplingAttempt,
            context: modelContext,
            tools: modelTools,
            resolvedInputBudgetTokens:
              initialContext.resolvedInputBudgetTokens,
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
              // 已建立 Grounding Session：文本只留在服务端内存，
              // 校验通过前既不发 assistant_delta，也不写入 Message.content。
              roundHiddenText += samplingResult.value
            }
            else {
              // 尚未建立 Grounding Session：文本实时推给前端。若本轮随后由 evidence-eligible
              // Tool 建立 Session，这段已推出的 delta 不可撤回，按 Issue #116 决策保留在 content。
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
                  plannedMessageCount,
                  contextPlanSummary,
                  debugModelIO,
                )
              : this.toFailedSamplingStepOutput(
                  error,
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
          // Grounding 模式下只有最终回答这一轮的文本才是待校验草稿。
          hiddenFinalDraft = roundHiddenText
          hasFinalAnswer = true
          break
        }

        const { calls } = samplingDecision

        // 本轮 call 数超过剩余预算：在执行任何 call 之前整体拒绝，没有部分副作用。
        if (toolCallCount + calls.length > runtimePolicy.maxToolCalls)
          throw new AgentLoopLimitExceededError()

        toolCallCount += calls.length

        // length：模型输出达到长度限制，arguments 可能不完整。整批一个都不执行，
        // 每个 call 记一条失败 Step 并作为 observation 回喂，下一轮由模型自行重发。
        const argumentsTruncated
          = samplingDecision.summary.finishReason === 'length'
        const toolResults: Array<{
          observation: NormalizedToolObservation
          ok: boolean
          argumentsValidated: boolean
        }> = []

        // 顺序执行，每个 call 一个 tool_execution Step；当前工具只读，并行没有收益。
        for (const call of calls) {
          const toolDefinition = toolDefinitions.find(
            definition => definition.name === call.toolName,
          )
          const toolStep = await this.agentRunRecorderService.startStep({
            runId: currentAgentRunId,
            type: AGENT_STEP_TYPES.toolExecution,
            input: {
              callId: call.callId,
              toolName: call.toolName,
              samplingAttemptId,
            },
          }, databaseDeadline)
          let toolResult: ToolResult

          try {
            if (argumentsTruncated) {
              toolResult = {
                ok: false,
                code: 'truncated_arguments',
                modelContent: `工具 ${call.toolName} 的参数因模型输出达到长度限制而不完整，本次未执行；仍需要时请重新发起调用。`,
              }
            }
            else if (!toolDefinition) {
              toolResult = {
                ok: false,
                code: 'unknown_tool',
                modelContent: `工具 ${call.toolName} 不存在。`,
              }
            }
            else {
              toolResult = await this.toolInvocationService.invoke(
                call,
                { signal: runSignal, databaseDeadline },
              )
            }
            runCancellation.throwIfUnavailable()
          }
          catch (error) {
            terminalStepFailure = {
              id: toolStep.id,
              errorMessage: '工具执行未能安全完成。',
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
            ...(toolResult.ok ? {} : { code: toolResult.code }),
            ...(toolSummary ? { toolSummary } : {}),
            originalChars: observation.originalChars,
            observationChars: observation.observationChars,
            truncated: observation.truncated,
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
                errorMessage: `工具 ${call.toolName} 返回 ${toolResult.code}。`,
                output: toolStepOutput,
              },
            )
          }

          // Evidence policy 由服务端 Tool Definition 声明，模型 arguments 无法改变；
          // zero-hit、not found 和执行失败同样建立 Session，它们是不同的证据事实。
          // 截断批次根本没有执行，不构成任何证据事实。
          if (!argumentsTruncated && toolDefinition?.evidencePolicy === 'eligible') {
            evidenceRegistry ??= new RunEvidenceRegistry()
            evidenceRegistry.recordEligibleToolOutcome({
              toolName: toolDefinition.name,
              ok: toolResult.ok,
              // 始终原样传入：缺失投影本身就是需要被记录为 evidence failure 的事实，
              // 不能在这里先过滤掉再让 Registry 误判成合法零命中。
              evidence: toolResult.ok ? toolResult.evidence : undefined,
            })
          }

          toolResults.push({
            observation,
            ok: toolResult.ok,
            // 只有 ToolInvocationService 经 input.parse 校验后执行的调用，参数才可信；
            // 这三个 code 都发生在校验之前或根本没有校验。execution_failed 也可能来自
            // policy 拒绝（parse 前），当前 allowlist 工具都通过 policy，该分支不可达。
            argumentsValidated: toolResult.ok
              || (toolResult.code !== 'truncated_arguments'
                && toolResult.code !== 'unknown_tool'
                && toolResult.code !== 'invalid_arguments'),
          })
        }

        runCancellation.throwIfUnavailable()
        modelContext.appendToolExchange({
          calls,
          intermediateText: samplingDecision.intermediateText,
          reasoningContent: samplingDecision.reasoningContent,
          results: toolResults,
        })
      }

      if (!hasFinalAnswer) {
        throw new AgentLoopLimitExceededError()
      }

      runCancellation.throwIfUnavailable()

      let grounding: MessageGroundingV1 | undefined
      let finalizationCommit: CloseAgentStepMetadata | undefined

      if (evidenceRegistry) {
        const finalizationStep = await this.agentRunRecorderService.startStep({
          runId: currentAgentRunId,
          type: AGENT_STEP_TYPES.groundedFinalization,
          input: {
            assistantMessageId,
            evidenceAvailability: evidenceRegistry.evidenceAvailability(),
            registryRefCount: evidenceRegistry.summary().refCount,
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
        || (!runCancellation && (input.signal?.aborted ?? false))
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
   * 解析一次 Run 的请求级配置：allowlist 内的 Tool 定义、模型可见 Tool
   * 说明与 resolved 模型请求配置。请求级 model / maxTokens 非法时抛
   * LLMConfigError；Registry 缺失 allowlisted Tool 时按现状跳过，不伪造定义。
   */
  private resolveRunConfiguration(
    input: RunTurnStreamInput,
    runtimePolicy: AgentRuntimePolicy,
  ) {
    // allowlist 就是 TOOL_DEFINITIONS 的顺序；定义仍以 Registry 实际注册的为准。
    const toolDefinitions = TOOL_DEFINITIONS.flatMap(({ name }) => {
      const definition = this.toolRegistryService.get(name)?.definition

      if (!definition) {
        this.logger.warn(`allowlist 工具 ${name} 未在 Registry 注册，本次 Run 不暴露该工具`)

        return []
      }

      return [definition]
    })
    // 模型只看到名称、说明与输入 Schema；timeout、Observation 预算与 evidence policy 留在服务端。
    const modelTools = runtimePolicy.maxToolCalls === 0
      ? []
      : toolDefinitions.map(definition => ({
          name: definition.name,
          description: definition.description,
          inputSchema: definition.input.schema,
        }))
    const request = this.llmService.resolveChatRequestConfig({
      ...(input.model ? { model: input.model } : {}),
      ...(input.reasoningEffort === undefined
        ? {}
        : { reasoningEffort: input.reasoningEffort }),
      ...(input.maxTokens === undefined
        ? {}
        : { maxTokens: input.maxTokens }),
    })

    return { request, toolDefinitions, modelTools }
  }

  /**
   * 一次按时间倒序读取严格早于当前用户消息的最近已完成消息，最多 take 条。
   * 仅返回已完成消息；未完成消息不进入模型历史。
   */
  private async listRecentMessageCandidates(
    conversationId: string,
    currentUserUpperBound: Pick<Message, 'id' | 'createdAt'>,
    take: number,
    databaseDeadline: DatabaseOperationDeadline,
  ): Promise<Message[]> {
    const messages = await this.prismaService.withDeadlineTransaction(
      databaseDeadline,
      transaction => transaction.execute(prisma => prisma.message.findMany({
        where: {
          conversationId,
          status: MessageStatus.COMPLETED,
          // 严格早于当前用户消息：createdAt 更早，或同一时刻 id 更小。
          OR: [
            { createdAt: { lt: currentUserUpperBound.createdAt } },
            {
              createdAt: currentUserUpperBound.createdAt,
              id: { lt: currentUserUpperBound.id },
            },
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

  private toLlmMessage(message: Message): MessageInputItem {
    return {
      type: 'message',
      role: message.role === MessageRole.USER ? 'user' : 'assistant',
      content: message.content,
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
      ...(contextPlan
        ? { contextPlan: toPersistedContextPlan(contextPlan) }
        : {}),
      ...this.toDebugModelIOOutput(debugModelIO),
    }
  }

  private toFailedSamplingStepOutput(
    error: unknown,
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
        messageCount,
        failedContextPlan,
        debugModelIO,
      )
    }

    return {
      messageCount,
      ...(error instanceof ContextTokenEstimationError
        ? { contextFailureReason: 'estimator_failure' as const }
        : {}),
      ...(failedContextPlan
        ? { contextPlan: toPersistedContextPlan(failedContextPlan) }
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
        usage: toPersistedModelUsage(attempt.usage),
      })),
      ...(grounding
        ? {
            outcome: grounding.outcome,
            citationCount: grounding.citations.length,
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
}

/** 落库的裁剪前快照只保留 Admin 读取的四个字段；另两个计数写入 load_conversation_history 的 output。 */
function toPersistedInitialContext(
  initialContext: InitialContextSummary,
): Prisma.InputJsonObject {
  return {
    resolvedModel: initialContext.resolvedModel,
    resolvedInputBudgetTokens: initialContext.resolvedInputBudgetTokens,
    historyCandidateCount: initialContext.historyCandidateCount,
    historyIncludedCount: initialContext.historyIncludedCount,
  }
}

function toPersistedContextPlan(
  contextPlan: SamplingContextPlanSummary,
): Prisma.InputJsonObject {
  return {
    resolvedInputBudgetTokens: contextPlan.resolvedInputBudgetTokens,
    estimatedInputTokens: contextPlan.estimatedInputTokens,
    historyCandidateCount: contextPlan.historyCandidateCount,
    historyIncludedCount: contextPlan.historyIncludedCount,
    overflowReason: contextPlan.overflowReason,
    observations: contextPlan.observations.map(observation => ({
      originalChars: observation.originalChars,
      toolCeilingChars: observation.toolCeilingChars,
      finalChars: observation.finalChars,
    })),
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
