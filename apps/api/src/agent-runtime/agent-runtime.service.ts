import type {
  ChatStreamOptions,
  MessageInputItem,
  ModelUsage,
} from '@agent/ai'
import type { AgentRunErrorCode, MessageGroundingV1 } from '@agent/contracts'
import type {
  Message,
  Prisma,
  MessageRole as PrismaMessageRole,
  MessageStatus as PrismaMessageStatus,
} from '../generated/prisma/client.js'
import type { LlmProviderCredentials } from '../llm/llm-model-config.service.js'
import type { DatabaseOperationDeadline } from '../prisma/prisma.service.js'
import type { NormalizedToolObservation } from '../tools/core/tool-observation.js'
import type {
  ToolDefinition,
  ToolResult,
  UnvalidatedToolCallEnvelope,
} from '../tools/core/tool.types.js'
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
import type {
  RunCancellation,
  RunTerminationSource,
} from './lifecycle/run-cancellation.js'
import type { DebugModelIOCaptured } from './sampling/model-io-debug-capture.js'

import type {
  ModelSamplingSummary,
  SamplingDecision,
} from './sampling/model-sampling-decision.js'
import {
  LLMAuthError,
  LLMBalanceError,
  LLMError,
  LLMInvalidRequestError,
  LLMNetworkError,
  LLMRateLimitError,
  LLMServerError,
  resolveChatRequestConfig,
} from '@agent/ai'
import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common'
import { getAiExceptionMessage } from '../common/utils/llm-error-message.util.js'
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
  AGENT_RUN_DEADLINE_EXCEEDED_MESSAGE,
  AgentLoopLimitExceededError,
  AgentRunTerminalizationError,
  ContextBudgetExceededError,
  ContextTokenEstimationError,
  ModelSamplingIncompleteError,
} from './agent-runtime.errors.js'
import { AgentRuntimePolicyService } from './configuration/agent-runtime.policy.js'
import { DeepSeekV4TokenEstimator } from './context/deepseek-v4-token-estimator.js'
import { summarizeInitialContext } from './context/initial-context.js'
import { ModelContext, toFeedbackArgumentsJson } from './context/model-context.js'
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
import { toPersistableText } from './persistable-text.js'
import {
  toModelIODebugCaptureEnvelope,
  toModelIODebugResponseCaptureEnvelope,
} from './sampling/model-io-debug-capture.js'
import { streamModelSampling } from './sampling/model-sampling-decision.js'

/** 用户停止（或消费者提前断开）时中断的 Step 文案；Run 与 Message 走 ABORTED，不写失败文案。 */
const RUN_ABORTED_MESSAGE = '用户已停止生成。'
/** finalization 流不合协议、又没有更具体原因时的文案（沿用改动前的说法）。 */
const MODEL_NO_RESULT_MESSAGE = '模型服务暂时没有返回结果，请稍后重试。'
/** 数据库、工具执行等服务端自身故障的文案：不能说成模型服务的问题。 */
const RUN_INTERNAL_FAILURE_MESSAGE = '服务端未能完成本轮回答，请稍后重试。'

interface ActiveSamplingClose {
  close: () => Promise<void>
  debugModelIO: DebugModelIOCaptured
  /** 消费者提前 return() 时按中断收口这一轮采样。 */
  toAbortedStep: () => CloseAgentStepInput
}

/** 被多个阶段写入、终态收口时读取的 Run 状态。 */
interface RunTerminalSlots {
  /** 用户可见正文：action 循环推可见文本、Grounding 重放时追加；完成与中断时原样写进 Message，失败时为空则换成失败文案。 */
  content: string
  /** 被打断的 Step 与归因文案：sampling / 工具执行 / grounded finalization 的 catch 与 finally 兜底写入；abortRun / failRun 按它关闭该 Step。 */
  stepFailure?: CloseAgentStepInput
  /** 失败 / 中断时仍需落库的最新安全 output：只由 grounded finalization 写入；abortRun / failRun 带着它关闭仍未结束的该 Step。 */
  stepMetadata?: CloseAgentStepMetadata
  /** 进行中的 action sampling：每轮开流时写入，收完或进 catch 时清空；消费者 return() 时 finally 按它关流并记中断 Step。 */
  samplingClose?: ActiveSamplingClose | undefined
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
    let runCancellation: RunCancellation | undefined
    // 终态收口是否已由正常完成或 catch 接管。消费者提前 return()（如
    // for-await break）会让 yield 点以 return 语义恢复、跳过 catch，
    // 此时只有 finally 有机会兜底收口。
    let terminalizationHandled = false
    // 用户消息落库时同时更新了会话 updatedAt；此后的失败要让前台同步侧栏（Run 可能还没创建）。
    let userMessagePersisted = false
    const terminal: RunTerminalSlots = { content: '' }

    try {
      await this.assertConversationExists(input.conversationId)

      // 落库与进模型上下文的是同一个替换后的串。
      const normalizedMessage = toPersistableText(input.userContent.trim())
      const userMessage = await this.createMessageAndTouchConversation(
        input.conversationId,
        MessageRole.USER,
        normalizedMessage,
      )
      userMessagePersisted = true

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
        providerId: input.model.provider.providerId,
        modelId: input.model.modelId,
        contextWindowTokens: resolvedRequestConfig.contextWindowTokens,
        resolvedMaxOutputTokens: resolvedRequestConfig.maxOutputTokens,
        context: modelContext,
        tools: modelTools,
        tokenEstimator: this.tokenEstimator,
      })
      await this.agentRunRecorderService.completeStep(
        loadHistoryStep.id,
        databaseDeadline,
        {
          // 候选历史条数：本次读入 ModelContext、尚未按预算裁剪的条数；
          // 每轮实际选入几条由该轮 plan() 决定，记在对应 sampling Step 的 contextPlan.historyIncludedCount。
          output: {
            messageCount: historyCandidates.length,
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
      // resolved 请求配置；它直接取自 Run 开始时的模型行快照，Run 中途不会漂移。
      const chatStreamOptions: ChatStreamOptions = {
        request: resolvedRequestConfig,
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
        //  创建模型采样 step
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
        // 模型流已正常收完时的决策；后续 Step 落库失败时仍可用于收口，统计与回填内容都已完整成立。
        let completedSamplingDecision: SamplingDecision | undefined
        // Context Planner 本轮的规划结果；落库的字段见 toPersistedContextPlan。
        let contextPlanSummary: SamplingContextPlanSummary | undefined
        // Grounding Session 建立后本轮暂存的文本；流结束前不知道它是草稿还是 Tool Call 前的中间文本。
        let roundHiddenText = ''
        // 本轮是否已推出可见文本：只在本轮第一个 delta 前和上一轮的文本分段。
        let roundTextStarted = false

        try {
          // 每轮请求模型前重新规划完整输入：首轮把一次读到的全部历史按预算裁剪；
          // 后续轮次还要把上一轮模型产生的 assistant_tool_call 与后端产生的
          // tool_result 成对加入输入，超预算时先删最旧历史，再缩短 Tool Observation。
          const contextPlan = this.samplingContextPlanner.plan({
            context: modelContext,
            tools: modelTools,
            resolvedInputBudgetTokens:
              initialContext.resolvedInputBudgetTokens,
          })

          // 预算、估算与选入的历史条数、每个 Tool Result 送入的字符数随采样 Step 落库，用于重建本轮输入。
          contextPlanSummary = contextPlan.summary

          runCancellation.throwIfUnavailable()
          // 两层 async generator 此时只创建迭代器；首次 sampling.next() 才启动模型请求并拉取事件。
          const sampling = streamModelSampling(
            this.llmService.chatStream(
              input.model.provider,
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

          // 中途关水龙头
          terminal.samplingClose = {
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
            toAbortedStep: () => ({
              id: samplingStep.id,
              errorMessage: RUN_ABORTED_MESSAGE,
              output: {
                ...this.toFailedSamplingStepOutput(
                  undefined,
                  contextPlanSummary,
                  debugModelIO,
                ),
                // 与 abortRun 写入 Run 的类别一致。
                errorCode: 'aborted',
              },
            }),
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
              // 推出去的 delta 与写进 Message.content 的是同一个替换后的串。
              const visibleText = toPersistableText(samplingResult.value)
              const contentDelta = roundTextStarted
                ? visibleText
                : separateFromPreviousText(terminal.content, visibleText)

              roundTextStarted = true
              terminal.content += contentDelta
              yield {
                type: 'assistant_delta',
                runId: currentAgentRunId,
                conversationId: input.conversationId,
                assistantMessageId,
                contentDelta,
              }
            }
            samplingResult = await sampling.next()
          }
          samplingDecision = samplingResult.value
          // 备份 一个，给后面 catch 用
          completedSamplingDecision = samplingDecision

          runCancellation.throwIfUnavailable()
          await this.agentRunRecorderService.completeStep(
            samplingStep.id,
            databaseDeadline,
            {
              output: {
                ...this.toSamplingStepOutput(
                  samplingDecision.summary,
                  contextPlanSummary,
                  debugModelIO,
                ),
                ...toPersistedSamplingContent(samplingDecision),
              },
            },
          )
          terminal.samplingClose = undefined
        }
        catch (error) {
          const closeSampling = terminal.samplingClose

          terminal.samplingClose = undefined
          await closeSampling?.close()
          // 先确立终态原因再写 Step 归因：用户停止或 deadline 先到时，
          // 随后的流读取失败只是它们的后果，Step 不能记成模型故障。
          claimRunTermination(runCancellation, error)
          const samplingFailure = describeRunFailure(
            runCancellation.source,
            runCancellation.reason ?? error,
          )

          terminal.stepFailure = {
            id: samplingStep.id,
            errorMessage: samplingFailure.message,
            output: {
              ...(completedSamplingDecision
                ? {
                    ...this.toSamplingStepOutput(
                      completedSamplingDecision.summary,
                      contextPlanSummary,
                      debugModelIO,
                    ),
                    ...toPersistedSamplingContent(completedSamplingDecision),
                  }
                : this.toFailedSamplingStepOutput(
                    error,
                    contextPlanSummary,
                    debugModelIO,
                  )),
              errorCode: samplingFailure.errorCode,
            },
          }
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
        const toolBatch = await this.executeToolBatch({
          // 记账
          runId: currentAgentRunId,
          samplingAttemptId,

          // toos 相关
          calls, // 模型要调用的工具
          // 记账用
          toolDefinitions, // 我们的工具
          argumentsTruncated, // 模型输出是否被截断，arguments 可能不完整

          // 情况 2 用不上
          runCancellation, // 本轮 sampling 的取消信号
          evidenceRegistry, // tools 情况为 undefined
          // 某个 call 被打断时把该 Step 的失败归因写进 terminal.stepFailure，由外层 catch 收口。
          terminal, // 出错时写失败归因
        })

        evidenceRegistry = toolBatch.evidenceRegistry
        runCancellation.throwIfUnavailable()
        modelContext.appendToolExchange({
          calls,
          intermediateText: samplingDecision.intermediateText,
          reasoningContent: samplingDecision.reasoningContent,
          results: toolBatch.toolResults,
        })
      }

      if (!hasFinalAnswer) {
        throw new AgentLoopLimitExceededError()
      }

      runCancellation.throwIfUnavailable()

      let grounding: MessageGroundingV1 | undefined
      let finalizationCommit: CloseAgentStepMetadata | undefined

      if (evidenceRegistry) {
        ({ grounding, finalizationCommit } = yield* this.finalizeGroundedAnswer({
          runId: currentAgentRunId,
          conversationId: input.conversationId,
          assistantMessageId,
          provider: input.model.provider,
          chatStreamOptions,
          evidenceRegistry,
          hiddenFinalDraft,
          runCancellation,
          terminal,
          startAssistantOutputStep,
        }))
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
          content: terminal.content,
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
        content: terminal.content,
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
                terminal.content,
              ),
              terminal.stepFailure,
              terminal.stepMetadata,
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
            content: terminal.content,
          }
        }

        return
      }

      const runFailure = describeRunFailure(runCancellation?.source, runCause)
      const errorMessage = runFailure.message

      if (agentRunId) {
        this.logRunFailure(agentRunId, terminal.stepFailure?.id, runFailure)

        try {
          await this.agentRunRecorderService.failRun(
            agentRunId,
            errorMessage,
            runFailure.errorCode,
            createTerminalizationDeadline(),
            this.toAssistantMessageSnapshot(
              assistantMessage,
              input.conversationId,
              terminal.content || errorMessage,
            ),
            terminal.stepFailure,
            terminal.stepMetadata,
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
        ...(userMessagePersisted ? { userMessagePersisted: true as const } : {}),
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
        const samplingClose = terminal.samplingClose

        terminal.samplingClose = undefined
        await samplingClose?.close()

        if (samplingClose) {
          terminal.stepFailure = samplingClose.toAbortedStep()
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
              terminal.content,
            ),
            terminal.stepFailure,
            terminal.stepMetadata,
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
   * 执行一轮采样给出的全部 Tool Call：返回与 calls 一一对应的回填结果，以及登记过本批
   * eligible 结果的 Evidence Registry（传入的沿用，否则由本批第一个 eligible 调用建立）。
   * 某个 call 被停止、deadline 或工具自身抛错打断时，先确立终态原因，再把该 Step 的失败归因
   * 写进 terminal.stepFailure，然后原样抛出：外层 catch 要靠原异常判断终止来源。
   * 抛出时本批才建立的 Registry 不会回到外层；外层 catch / finally 目前不读它，要读须先改成外层持有。
   */
  private async executeToolBatch(input: {
    runId: string
    samplingAttemptId: string
    calls: UnvalidatedToolCallEnvelope[]
    toolDefinitions: ToolDefinition[]
    argumentsTruncated: boolean
    runCancellation: RunCancellation
    evidenceRegistry: RunEvidenceRegistry | undefined
    terminal: RunTerminalSlots
  }) {
    const {
      runId,
      samplingAttemptId,
      calls,
      toolDefinitions,
      argumentsTruncated,
      runCancellation,
      terminal,
    } = input
    const { signal: runSignal, databaseDeadline } = runCancellation

    // tools 情况不用，为 undefined
    let evidenceRegistry = input.evidenceRegistry

    const toolResults: Array<{
      observation: NormalizedToolObservation // 回喂给模型的正文，
      ok: boolean
      feedbackArgumentsJson: string // 下一轮回喂给模型的参数
    }> = []

    // 顺序执行，每个 call 一个 tool_execution Step；当前工具只读，并行没有收益。
    for (const call of calls) {
      const toolDefinition = toolDefinitions.find(
        definition => definition.name === call.toolName,
      )
      // callId / toolName 是模型原样给的，落库副本同样要能进 jsonb。
      const toolStepInput = {
        callId: toPersistableText(call.callId),
        toolName: toPersistableText(call.toolName),
        samplingAttemptId,
      }
      const toolStep = await this.agentRunRecorderService.startStep({
        runId,
        type: AGENT_STEP_TYPES.toolExecution,
        input: toolStepInput,
      }, databaseDeadline)
      let toolResult: ToolResult

      try {
        // 情况 A：模型输出被截断，arguments 可能不完整，直接编一份失败结果。
        if (argumentsTruncated) {
          toolResult = {
            ok: false,
            code: 'truncated_arguments',
            modelContent: `工具 ${call.toolName} 的参数因模型输出达到长度限制而不完整，本次未执行；仍需要时请重新发起调用。`,
          }
        }
        // 情况 B：模型输出的工具名在服务端不存在，直接编一份失败结果。
        else if (!toolDefinition) {
          toolResult = {
            ok: false,
            code: 'unknown_tool',
            modelContent: `工具 ${call.toolName} 不存在。`,
          }
        }
        // 情况 C：真正执行 ，tools 走这
        else {
          // 执行工具拿到工具结果
          toolResult = await this.toolInvocationService.invoke(
            call,
            { signal: runSignal, databaseDeadline },
          )
        }
        runCancellation.throwIfUnavailable()
      }
      catch (error) {
        claimRunTermination(runCancellation, error)
        terminal.stepFailure = {
          id: toolStep.id,
          // 用户停止或 deadline 先到时按终态原因记；工具自身抛错仍记工具失败。
          errorMessage: runCancellation.source === 'failure'
            ? '工具执行未能安全完成。'
            : describeRunFailure(
              runCancellation.source,
              runCancellation.reason ?? error,
            ).message,
        }
        throw error
      }

      // 第一道截断：按工具自己的字数上限修剪回喂给模型的正文（不超过全局硬上限），
      // 超了就截断并前后加说明，让模型知道看到的不完整。第二道按整轮上下文预算缩，在 plan() 里。
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
      // 只有 ToolInvocationService 经 input.parse 校验后执行的调用，参数才可信；
      // 这三个 code 都发生在校验之前或根本没有校验，其余 code 都在校验通过之后。
      const argumentsValidated = toolResult.ok
        || (toolResult.code !== 'truncated_arguments'
          && toolResult.code !== 'unknown_tool'
          && toolResult.code !== 'invalid_arguments')
      // 回喂给模型的参数表示只算这一次：同一个字符串既落库，也进下一轮的 ModelContext。
      const feedbackArgumentsJson = toFeedbackArgumentsJson(
        call.rawArgumentsJson,
        argumentsValidated,
      )
      // 它要等执行结果出来才知道（是否经过校验），所以与 output 在收口时同一事务写入；
      // 停止、deadline 或工具抛错时 Step 未收口，不带参数与 observation。
      const toolStepClose = {
        input: {
          ...toolStepInput,
          arguments: toPersistableText(feedbackArgumentsJson),
        },
        output: {
          ok: toolResult.ok,
          ...(toolResult.ok ? {} : { code: toolResult.code }),
          ...(toolSummary ? { toolSummary } : {}),
          originalChars: observation.originalChars,
          observationChars: observation.observationChars,
          truncated: observation.truncated,
          // 回喂给模型的正文，已受 maxObservationChars 限制；后续轮次按预算缩短见 sampling Step 的 contextPlan。
          observation: toPersistableText(observation.content),
        },
      }

      if (toolResult.ok) {
        await this.agentRunRecorderService.completeStep(
          toolStep.id,
          databaseDeadline,
          toolStepClose,
        )
      }
      else {
        await this.agentRunRecorderService.failStep(
          toolStep.id,
          databaseDeadline,
          {
            errorMessage: `工具 ${toolStepInput.toolName} 返回 ${toolResult.code}。`,
            ...toolStepClose,
          },
        )
      }

      // Evidence policy 由服务端 Tool Definition 声明，模型 arguments 无法改变；
      // zero-hit、not found 和执行失败同样建立 Session，它们是不同的证据事实。
      // 参数没通过校验的调用（截断批次、invalid_arguments）根本没有执行，不构成任何证据事实。
      if (argumentsValidated && toolDefinition?.evidencePolicy === 'eligible') {
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
        feedbackArgumentsJson,
      })
    }

    return { toolResults, evidenceRegistry }
  }

  /**
   * Grounding Session 建立后的收尾：开 grounded_finalization Step，校验隐藏草稿并投影成 Message Grounding，
   * 通过后经 assistant_delta 重放已校验正文，返回终态事务要一并提交的 grounding 与 finalization Step 收口内容。
   * finalization Step 在重放期间保持 RUNNING，最新安全 output 始终在 terminal.stepMetadata：出错时先把
   * 该 Step 的失败归因写进 terminal.stepFailure 再原样抛出；消费者提前 return() 不经过这里的 catch，
   * 外层 finally 只按 terminal.stepMetadata 收口。
   */
  private async* finalizeGroundedAnswer(input: {
    runId: string
    conversationId: string
    assistantMessageId: string
    provider: LlmProviderCredentials
    chatStreamOptions: ChatStreamOptions
    evidenceRegistry: RunEvidenceRegistry
    hiddenFinalDraft: string
    runCancellation: RunCancellation
    terminal: RunTerminalSlots
    startAssistantOutputStep: () => Promise<void>
  }): AsyncGenerator<AgentRuntimeEvent, {
    grounding: MessageGroundingV1
    finalizationCommit: CloseAgentStepMetadata
  }> {
    const {
      runId,
      conversationId,
      assistantMessageId,
      provider,
      chatStreamOptions,
      evidenceRegistry,
      hiddenFinalDraft,
      runCancellation,
      terminal,
      startAssistantOutputStep,
    } = input
    const { databaseDeadline } = runCancellation
    // closeFinalizationStep 读 grounding 的当前值：投影通过前为空。
    let grounding: MessageGroundingV1 | undefined
    let finalizationCommit: CloseAgentStepMetadata | undefined

    const finalizationStep = await this.agentRunRecorderService.startStep({
      runId,
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
      terminal.stepMetadata = {
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
        sample: items => this.llmService.chatStream(provider, items, {
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

      // 校验通过后才通过既有 assistant_delta 重放正文；Session 建立前已推出的中间文本
      // 与回答之间同样分段。chunks 拼接逐字符等于 persisted content 与 done.content。
      for (const contentDelta of toValidatedAnswerChunks(
        separateFromPreviousText(terminal.content, toPersistableText(finalization.validated.answer)),
      )) {
        runCancellation.throwIfUnavailable()
        terminal.content += contentDelta
        yield {
          type: 'assistant_delta',
          runId,
          conversationId,
          assistantMessageId,
          contentDelta,
        }
      }
    }
    catch (error) {
      closeFinalizationStep(error)
      // 与 action sampling 同理：先确立终态原因，Step 文案再跟 Run 走同一套归因。
      claimRunTermination(runCancellation, error)
      terminal.stepFailure = {
        id: finalizationStep.id,
        errorMessage: describeRunFailure(
          runCancellation.source,
          runCancellation.reason ?? error,
        ).message,
        output: terminal.stepMetadata!.output,
      }
      throw error
    }

    return { grounding, finalizationCommit }
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
      // 终态收口只发生在 Run 创建之后，用户消息必然已落库。
      userMessagePersisted: true,
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
   * 说明与 resolved 模型请求配置（模型行快照 + 请求级 reasoningEffort）。
   * 模型行的数值约束在 Admin 写入时由 `assertModelRowValid` 把关，这里不再校验；
   * Registry 缺失 allowlisted Tool 时按现状跳过，不伪造定义。
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
    const request = resolveChatRequestConfig(input.model.profile, {
      ...(input.reasoningEffort === undefined
        ? {}
        : { reasoningEffort: input.reasoningEffort }),
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

  /**
   * Run FAILED 时的一条服务端日志：真实错误类别与上游状态码只在这里出现，
   * 用户看到的是 describeRunFailure 的安全文案。不记 LLMError.detail 与请求体；
   * message 是错误自身的文案：400 / 422 / 5xx 与未识别状态码的文案里带脱敏、截断到 200 字符的上游错误摘要，
   * 上游若在报错里回显请求片段，这一段会进日志。
   */
  private logRunFailure(
    runId: string,
    stepId: string | undefined,
    failure: RunFailure,
  ): void {
    const { rootCause } = failure
    // LLMError.detail 是 SDK 的 APIError 时只取它的 HTTP status，不碰 body。
    const status = rootCause instanceof LLMError
      ? (rootCause.detail as { status?: unknown } | null | undefined)?.status
      : undefined
    const httpStatus = typeof status === 'number' ? status : undefined

    this.logger.warn({
      event: 'agent_run_failed',
      runId,
      stepId: stepId ?? null,
      errorCode: failure.errorCode,
      errorName: rootCause instanceof Error ? rootCause.name : typeof rootCause,
      ...(httpStatus === undefined ? {} : { httpStatus }),
      message: rootCause instanceof Error ? rootCause.message : String(rootCause),
    })
  }

  private toSamplingStepOutput(
    summary: ModelSamplingSummary,
    contextPlan?: SamplingContextPlanSummary,
    debugModelIO?: DebugModelIOCaptured,
  ) {
    return {
      samplingAttemptId: summary.samplingAttemptId,
      finishReason: summary.finishReason,
      usage: toPersistedModelUsage(summary.usage),
      toolCallCount: summary.toolCallCount,
      firstTokenMs: summary.firstTokenMs,
      ...(contextPlan
        ? { contextPlan: toPersistedContextPlan(contextPlan) }
        : {}),
      ...this.toDebugModelIOOutput(debugModelIO),
    }
  }

  private toFailedSamplingStepOutput(
    error: unknown,
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
        failedContextPlan,
        debugModelIO,
      )
    }

    return {
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
   * 和 citationKey；只保留可审计的计数、状态与安全错误类别。提示词里服务端派生的
   * 标量（`buildFinalizationInput` 的 system 段）全部落库，与模型看到的一致。
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

interface RunFailure {
  errorCode: AgentRunErrorCode
  /** 用户可见文案：error 事件、失败 Message.content 与失败 Step.errorMessage 共用。 */
  message: string
  /** 剥掉采样包装后的真实错误，只进服务端日志。 */
  rootCause: unknown
}

/**
 * 从终态已确立的原因得出失败类别与用户可见文案；Run、失败采样 Step 与 error 事件都用它，
 * 三处因此不会各说各话。source 先于 reason：用户停止或 deadline 先到时，
 * 随后的流读取失败只是后果，不能归为模型故障。
 */
function describeRunFailure(
  source: RunTerminationSource | undefined,
  reason: unknown,
): RunFailure {
  if (source === 'user')
    return { errorCode: 'aborted', message: RUN_ABORTED_MESSAGE, rootCause: reason }
  if (source === 'deadline')
    return { errorCode: 'deadline', message: AGENT_RUN_DEADLINE_EXCEEDED_MESSAGE, rootCause: reason }

  // 流读取失败时，采样包装只说明「这一轮没完整结束」，真实原因在 cause 上。
  const rootCause = (
    reason instanceof ModelSamplingIncompleteError
    || reason instanceof GroundedFinalizationSamplingError
  ) && reason.cause !== undefined
    ? reason.cause
    : reason

  if (rootCause instanceof LLMError) {
    return {
      errorCode: toLlmErrorCode(rootCause),
      message: getAiExceptionMessage(rootCause),
      rootCause,
    }
  }

  const known = describeRuntimeError(rootCause)

  return known
    ? { ...known, rootCause }
    : {
        errorCode: 'internal',
        // 会话不存在发生在 Run 创建之前：不写 errorCode，但 run_failed 事件仍用这条文案。
        message: rootCause instanceof NotFoundException
          ? rootCause.message
          : RUN_INTERNAL_FAILURE_MESSAGE,
        rootCause,
      }
}

/** runtime 自己抛出的失败语义；文案就是错误自身的 message（已是用户可读的安全文案）。 */
function describeRuntimeError(
  error: unknown,
): Omit<RunFailure, 'rootCause'> | undefined {
  // 模型没以 stop / tool_calls 完整结束（length / content_filter / unknown / 缺 response_completed）。
  if (error instanceof ModelSamplingIncompleteError)
    return { errorCode: 'llm_protocol', message: error.message }
  // finalization 流本身不合协议：缺完成事件、多次提交、未知工具或 finish reason 不对。
  if (error instanceof GroundedFinalizationSamplingError)
    return { errorCode: 'llm_protocol', message: MODEL_NO_RESULT_MESSAGE }
  // 引用校验失败必须与「知识库没有答案」区分开，不能伪装成 zero-hit。
  if (error instanceof GroundedFinalizationFailedError)
    return { errorCode: 'grounding_failed', message: error.message }
  if (error instanceof AgentLoopLimitExceededError)
    return { errorCode: 'loop_limit', message: error.message }
  if (error instanceof ContextBudgetExceededError)
    return { errorCode: 'context_overflow', message: error.message }
  if (error instanceof ContextTokenEstimationError)
    return { errorCode: 'estimator_failure', message: error.message }

  return undefined
}

function toLlmErrorCode(error: LLMError): AgentRunErrorCode {
  if (error instanceof LLMAuthError)
    return 'llm_auth'
  if (error instanceof LLMBalanceError)
    return 'llm_balance'
  if (error instanceof LLMRateLimitError)
    return 'llm_rate_limit'
  if (error instanceof LLMInvalidRequestError)
    return 'llm_invalid_request'
  if (error instanceof LLMServerError)
    return 'llm_server'
  if (error instanceof LLMNetworkError)
    return 'llm_network'

  // LLMApiError：adapter 协议异常，或 400 / 401 / 402 / 403 / 422 / 429 / 5xx 之外的 HTTP 状态。
  return 'llm_protocol'
}

/** 落库的裁剪前快照：InitialContextSummary 的四个字段原样写入；候选历史条数在 load_conversation_history 的 output。 */
function toPersistedInitialContext(
  initialContext: InitialContextSummary,
): Prisma.InputJsonObject {
  return {
    resolvedModel: initialContext.resolvedModel,
    providerId: initialContext.providerId,
    modelId: initialContext.modelId,
    resolvedInputBudgetTokens: initialContext.resolvedInputBudgetTokens,
  }
}

/**
 * 预算与估算之外，只落两项 planner 决策：本轮选入几条历史（首轮超预算从最旧处删，后续轮次
 * 超预算还会继续删，所以每轮各记各的），以及每个 Tool Result 实际送入的字符数（按 exchange、
 * call 顺序，与 tool_execution Step 的先后一致）。它们与历史消息、Step 里的正文一起还原本轮输入。
 */
function toPersistedContextPlan(
  contextPlan: SamplingContextPlanSummary,
): Prisma.InputJsonObject {
  return {
    resolvedInputBudgetTokens: contextPlan.resolvedInputBudgetTokens,
    estimatedInputTokens: contextPlan.estimatedInputTokens,
    overflowReason: contextPlan.overflowReason,
    historyIncludedCount: contextPlan.historyIncludedCount,
    observationPreviewChars: contextPlan.observations.map(
      observation => observation.finalChars,
    ),
  }
}

/**
 * Tool Call 轮随 assistant 消息回填给模型的内容：本轮文本（含 Grounding 模式下没推给用户的那段）
 * 与 reasoning continuation。DeepSeek 家族续轮一律回填 `reasoning_content`（模型没思考时为空串），
 * 这里仍只在非空时落库，重建时缺失即视为空串。final_answer 轮的文本是最终回答或待校验草稿，不在这里。
 */
function toPersistedSamplingContent(
  decision: SamplingDecision,
): Prisma.InputJsonObject {
  if (decision.type !== 'tool_call')
    return {}

  return {
    ...(decision.intermediateText
      ? { intermediateText: toPersistableText(decision.intermediateText) }
      : {}),
    ...(decision.reasoningContent
      ? { reasoningContent: toPersistableText(decision.reasoningContent) }
      : {}),
  }
}

/**
 * 用户可见文本跨轮拼接时保证中间隔一个空行，新一轮的文本另起一段：否则以 `## 标题` 或列表开头的
 * 回答会粘进上一段，只隔单个换行也只是段内软换行；下个 Run 的历史里同样是粘连文本。
 */
function separateFromPreviousText(previous: string, next: string): string {
  if (!previous || !next || previous.endsWith('\n\n'))
    return next

  return `${previous.endsWith('\n') ? '\n' : '\n\n'}${next}`
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
