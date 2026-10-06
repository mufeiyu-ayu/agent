import type {
  ChatStreamOptions,
  ModelToolSpec,
} from '@agent/ai'
import type { AgentRunErrorCode } from '@agent/contracts'
import type {
  Message,
  Prisma,
  MessageRole as PrismaMessageRole,
  MessageStatus as PrismaMessageStatus,
} from '../generated/prisma/client.js'
import type { ResolvedLlmModel } from '../llm/llm-model-config.service.js'
import type { SerperApiKey } from '../runtime-config/runtime-config.service.js'
import type { NormalizedToolObservation } from '../tools/core/tool-observation.js'
import type {
  ToolDisplay,
  ToolInvocationResult,
  UnvalidatedToolCallEnvelope,
} from '../tools/core/tool.types.js'
import type {
  AgentRuntimeEvent,
  RunTurnStreamInput,
} from './agent-runtime.types.js'
import type { CompactionRun } from './context/context-compaction.service.js'
import type { SamplingContextPlan } from './context/model-context.js'
import type { CloseAgentStepInput } from './lifecycle/agent-run-recorder.service.js'
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
  LLMContextOverflowError,
  LLMError,
  LLMInvalidRequestError,
  LLMNetworkError,
  LLMRateLimitError,
  LLMServerError,
  resolveChatRequestConfig,
} from '@agent/ai'
import { Inject, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common'
import { WORKSPACE_DEVELOPMENT_INSTRUCTION, WORKSPACE_DEVELOPMENT_VERSION, WORKSPACE_TOOL_NAMES } from '../chat/prompts/workspace-development.prompt.js'
import { getAiExceptionMessage } from '../common/utils/llm-error-message.util.js'
import { MessageRole, MessageStatus } from '../generated/prisma/client.js'
import { LLMService } from '../llm/llm.service.js'
import {
  DatabaseCommitOutcomeUnknownError,
  PrismaService,
} from '../prisma/prisma.service.js'
import { ToolInvocationService } from '../tools/core/tool-invocation.service.js'
import { TOOL_DEFINITIONS } from '../tools/tool-definitions.js'
import { toToolProgressArguments } from '../tools/web/tool-progress-arguments.js'
import { WorkspaceService } from '../workspaces/workspace.service.js'
import {
  AGENT_RUN_DEADLINE_EXCEEDED_MESSAGE,
  AgentRunTerminalizationError,
  ModelSamplingIncompleteError,
  samplingFailureCause,
} from './agent-runtime.errors.js'
import { ContextCompactionService } from './context/context-compaction.service.js'
import { loadConversationHistory, separateFromPreviousText } from './context/conversation-history.js'
import { ModelContext, toFeedbackArgumentsJson } from './context/model-context.js'
import {
  AGENT_STEP_TYPES,
  AgentRunRecorderService,
  toPersistedModelUsage,
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
/** 数据库、工具执行等服务端自身故障的文案：不能说成模型服务的问题。 */
const RUN_INTERNAL_FAILURE_MESSAGE = '服务端未能完成本轮回答，请稍后重试。'

/** 一个 call 回喂给下一轮模型的内容。 */
interface ToolFeedback {
  /** 回喂给模型的正文。 */
  observation: NormalizedToolObservation
  ok: boolean
  /** 下一轮回喂给模型的参数。 */
  feedbackArgumentsJson: string
}

interface ActiveSamplingClose {
  close: () => Promise<void>
  debugModelIO: DebugModelIOCaptured
  /** 消费者提前 return() 时按中断收口这一轮采样。 */
  toAbortedStep: () => CloseAgentStepInput
}

/** 被多个阶段写入、终态收口时读取的 Run 状态。 */
interface RunTerminalSlots {
  /** 用户可见正文：action 循环推可见文本时追加；完成与中断时原样写进 Message，失败时为空则换成失败文案。 */
  content: string
  /** 被打断的 Step 与归因文案：sampling / 工具执行的 catch 与 finally 兜底写入；abortRun / failRun 按它关闭该 Step。 */
  stepFailure?: CloseAgentStepInput
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

    @Inject(ContextCompactionService)
    private readonly contextCompactionService: ContextCompactionService,
    @Optional() @Inject(WorkspaceService)
    private readonly workspaces?: WorkspaceService,
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
      // Run deadline 必须先于请求级配置解析生效；时限取自 ChatService 在 Run 开始前读好的快照，这里不会抛错。
      // 一次问答不限轮数与工具调用次数（#218），模型一直做到给出最终回答，只由这个时限兜底。
      runCancellation = createRunCancellation(
        input.signal,
        input.runtimeConfig.limits.runDeadlineMs,
      )
      const runSignal = runCancellation.signal
      const databaseDeadline = runCancellation.databaseDeadline

      // 配置解析时机保持在 Run 落库之后：请求级配置错误仍走既有 failRun
      // 终态化，不改变 Run 生命周期语义。
      const { request: resolvedRequestConfig, modelTools }
        = this.resolveRunConfiguration(input)
      const loadHistoryStep = await this.agentRunRecorderService.startStep({
        runId: currentAgentRunId,
        type: AGENT_STEP_TYPES.loadConversationHistory,
      }, databaseDeadline)

      // 查询前后各检查一次用户取消或 Run 超时；await 期间也可能发生。
      // 查 Step 失败同样在这里抛出：此时还没调用模型，由 failRun 收口，不带着半截历史发请求。
      runCancellation.throwIfUnavailable()
      // 同一个快照里读最新压缩记录与严格早于当前问题的历史（#220）：被覆盖的问答由摘要代替，其余按问答分组、
      // 最旧在前，带回之前问答的工具调用与结果（#218），不按条数截断。
      const { history, messageCount } = await loadConversationHistory(
        this.prismaService,
        input.conversationId,
        userMessage,
        databaseDeadline,
      )
      runCancellation.throwIfUnavailable()

      const modelContext = ModelContext.create({
        // 系统提示词
        instructions: input.instructions,
        history,
        // 当前用户消息；创建时间给本轮压缩的摘要输入写日期
        currentUser: { content: userMessage.content, createdAt: userMessage.createdAt },
      })
      await this.agentRunRecorderService.completeStep(
        loadHistoryStep.id,
        databaseDeadline,
        {
          // 读到的历史 Message 条数（含被压缩记录覆盖的）；发给模型的未覆盖部分条数记在各 sampling Step 的
          // contextPlan.historyIncludedCount。
          output: { messageCount },
        },
      )
      // 本 Run 的压缩状态：检查点 A、C 都用它（#220）。
      const compactionRun: CompactionRun = {
        runId: currentAgentRunId,
        conversationId: input.conversationId,
        model: input.model,
        keepRecentTokens: input.runtimeConfig.compactionKeepRecentTokens,
        tools: modelTools,
        context: modelContext,
        cancellation: runCancellation,
        loop: { attemptedSinceSampling: false, ineffectiveAttempts: 0 },
      }
      // 服务商报超长后已经压缩重试过、之后还没有成功采样（照 Pi：连续超长只救一次）。
      let overflowRetried = false
      let workspaceGuideStepId: string | undefined

      // 创建助手消息与 Run 关联必须同事务提交，避免 deadline 下留下未关联的 late Message。
      assistantMessage = await this.agentRunRecorderService.createAssistantMessage(
        currentAgentRunId,
        input.conversationId,
        databaseDeadline,
      )
      const assistantMessageId = assistantMessage.id
      // 「用时」的起点：run_started 推出的时刻，与前台计时的起点（收到 start 事件）对齐（#212）；
      // 与前台一样用单调时钟，系统校时不影响。
      const runStartedAt = performance.now()
      // 第一段正文（不只是空白）到达时距起点的毫秒数；此后收口的每个采样 Step 都带上，刷新后还原「用时」。
      let answerStartedMs: number | undefined
      const answerStartedOutput = () => answerStartedMs === undefined ? {} : { answerStartedMs }

      yield {
        type: 'run_started',
        runId: currentAgentRunId,
        conversationId: input.conversationId,
        userMessageId: userMessage.id,
        assistantMessageId,
      }

      let assistantOutputStepId: string | undefined
      // 用户可见输出一开始就启动该 Step：Tool Call 之前的中间文本也是可见输出，
      // 因此它可能早于本轮的 tool_execution Step 创建，并在整个工具循环期间保持 RUNNING。
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

      // Initial Context 与各轮 Sampling 共用同一份 resolved 请求配置；
      // 它直接取自 Run 开始时的模型行快照，Run 中途不会漂移。
      const chatStreamOptions: ChatStreamOptions = {
        request: resolvedRequestConfig,
        signal: runSignal,
        tools: modelTools,
      }

      // 不限轮数：某轮 Sampling 返回 final_answer 才退出；用户停止、到达时限或出错时由各处 throwIfUnavailable / catch 结束。
      for (let samplingAttempt = 1; ; samplingAttempt += 1) {
        runCancellation.throwIfUnavailable()
        // 检查点 A：估算超触发线就先压缩；压缩 Step 排在采样 Step 之前，采样耗时不含压缩，前台照旧显示「思考中」。
        await this.contextCompactionService.compactBeforeSampling(compactionRun)
        const samplingAttemptId = `${currentAgentRunId}:sampling-${samplingAttempt}`
        //  创建模型采样 step
        const samplingStep = await this.agentRunRecorderService.startStep({
          runId: currentAgentRunId,
          type: AGENT_STEP_TYPES.modelSampling,
          input: {
            samplingIndex: samplingAttempt,
            samplingAttemptId,
            initialContext: toPersistedInitialContext(input.model, resolvedRequestConfig.model, modelTools),
            ...(workspaceGuideStepId ? { workspaceDevelopment: { version: WORKSPACE_DEVELOPMENT_VERSION, stepId: workspaceGuideStepId } } : {}),
          },
        }, databaseDeadline)
        // debug 捕获暂存：只有运行配置打开「抓取模型原始请求」时才给 client 回调，
        // 开关关闭时始终为空对象，落库输出与现状完全一致。
        const debugModelIO: DebugModelIOCaptured = {
          runId: currentAgentRunId,
          samplingAttemptId,
        }
        // 模型流完整结束后的业务决策：final_answer 或 tool_call。
        let samplingDecision: SamplingDecision
        // 模型流已正常收完时的决策；后续 Step 落库失败时仍可用于收口，统计与回填内容都已完整成立。
        let completedSamplingDecision: SamplingDecision | undefined
        // 本轮发出的输入与估算，落库形态见 toPersistedContextPlan。
        let contextPlan: Prisma.InputJsonObject | undefined
        // 本轮是否已推出可见文本：只在本轮第一个 delta 前和上一轮的文本分段。
        let roundTextStarted = false
        // 本轮推给界面的思考原文（与 reasoning_delta 同一份）：最终回答轮与没收完的一轮按它落库，只为刷新后还原（#212）。
        let roundReasoning = ''
        // 本轮推出过任何 delta（含思考）：推出后遇到超长不再重试，已推给前台的内容撤不回。
        let roundDeltaPushed = false

        try {
          // 每轮请求模型前组装完整输入：历史（压缩记录的摘要 + 未覆盖的问答）、当前问题与本 Run 保留的工具轮，
          // 不删减内容；估算、基于的压缩记录与本轮压缩 Step 随采样 Step 落库，用于重建本轮输入。
          const plan = modelContext.plan(modelTools)

          contextPlan = toPersistedContextPlan(plan, input.model.maxInputTokens)

          runCancellation.throwIfUnavailable()
          // 两层 async generator 此时只创建迭代器；首次 sampling.next() 才启动模型请求并拉取事件。
          const sampling = streamModelSampling(
            this.llmService.chatStream(
              input.model.provider,
              plan.items,
              {
                ...chatStreamOptions,
                ...(input.runtimeConfig.debugCaptureModelIo
                  ? {
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
                    }
                  : {}),
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
                  contextPlan,
                  debugModelIO,
                ),
                ...toPersistedSamplingContent(undefined, roundReasoning),
                ...answerStartedOutput(),
                // 与 abortRun 写入 Run 的类别一致。
                errorCode: 'aborted',
              },
            }),
          }
          let samplingResult = await sampling.next()

          while (!samplingResult.done) {
            runCancellation.throwIfUnavailable()

            if (samplingResult.value.kind === 'reasoning') {
              // 思考原文只推给界面（#209）：不开输出 Step、不进 Message.content、不参与正文分段；
              // 与正文同样先做字符替换，流里的文本口径一致。
              const reasoningDelta = toPersistableText(samplingResult.value.delta)

              roundReasoning += reasoningDelta
              roundDeltaPushed = true
              yield {
                type: 'reasoning_delta',
                runId: currentAgentRunId,
                conversationId: input.conversationId,
                assistantMessageId,
                delta: reasoningDelta,
              }
            }
            else {
              // 文本实时推给前端；Tool Call 轮的中间文本同样推出，并随 tool_calls 回填模型。
              await startAssistantOutputStep()
              // 推出去的 delta 与写进 Message.content 的是同一个替换后的串。
              const visibleText = toPersistableText(samplingResult.value.delta)
              const contentDelta = roundTextStarted
                ? visibleText
                : separateFromPreviousText(terminal.content, visibleText)

              roundTextStarted = true
              roundDeltaPushed = true
              terminal.content += contentDelta
              // 与前台同一口径：只有空白（如调工具前先吐的换行）不算正文开始；向下取整，1 秒界限与整秒都按不满算。
              if (answerStartedMs === undefined && contentDelta.trim())
                answerStartedMs = Math.floor(performance.now() - runStartedAt)
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
                  contextPlan,
                  debugModelIO,
                ),
                ...toPersistedSamplingContent(samplingDecision, roundReasoning),
                ...answerStartedOutput(),
              },
            },
          )
          terminal.samplingClose = undefined
        }
        catch (error) {
          const closeSampling = terminal.samplingClose

          terminal.samplingClose = undefined
          await closeSampling?.close()
          const failedSamplingOutput = (errorCode: AgentRunErrorCode) => ({
            ...(completedSamplingDecision
              ? this.toSamplingStepOutput(
                  completedSamplingDecision.summary,
                  contextPlan,
                  debugModelIO,
                )
              : this.toFailedSamplingStepOutput(
                  error,
                  contextPlan,
                  debugModelIO,
                )),
            ...toPersistedSamplingContent(completedSamplingDecision, roundReasoning),
            ...answerStartedOutput(),
            errorCode,
          })

          // 检查点 C（照抄 Pi，连续超长只救一次）：服务商报超长、终态还没确立、本轮没推出过任何 delta、
          // 上次成功采样后还没救过、有可压缩的内容时，失败的采样 Step 照常收口（不发 run_failed），强制压缩一次后
          // 新开采样重试；压缩失败时按原来的超长错误走下面的失败收口（Step 已收口，Run 收口时不再改它）。
          if (
            !runCancellation.source
            && !roundDeltaPushed
            && !overflowRetried
            && isContextOverflow(error)
            && this.contextCompactionService.canCompact(compactionRun)
          ) {
            const overflow = describeRunFailure(undefined, error)

            overflowRetried = true
            terminal.stepFailure = {
              id: samplingStep.id,
              errorMessage: overflow.message,
              output: failedSamplingOutput(overflow.errorCode),
            }
            await this.agentRunRecorderService.failStep(samplingStep.id, databaseDeadline, terminal.stepFailure)
            delete terminal.stepFailure
            modelContext.forgetSamplingUsage()

            if (await this.contextCompactionService.compactAfterOverflow(compactionRun)) {
              this.logSamplingDebugCaptureClosed(debugModelIO, 'failure')
              continue
            }
          }

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
            output: failedSamplingOutput(samplingFailure.errorCode),
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

        if (samplingDecision.type === 'final_answer')
          break

        // 同一次问答内，下一次估算以这次采样的真实用量为锚点，只粗估之后新增的工具结果。
        modelContext.recordSamplingUsage(samplingDecision.summary.usage)
        // 成功采样后复位：之后可以再压缩（检查点 A），再遇到超长也可以再救一次（检查点 C）。
        compactionRun.loop.attemptedSinceSampling = false
        overflowRetried = false

        const { calls } = samplingDecision

        // length：模型输出达到长度限制，arguments 可能不完整。整批一个都不执行，
        // 每个 call 记一条失败 Step 并作为 observation 回喂，下一轮由模型自行重发。
        const argumentsTruncated
          = samplingDecision.summary.finishReason === 'length'

        const workspaceGuideRequired = !workspaceGuideStepId && !argumentsTruncated && calls.some(call => WORKSPACE_TOOL_NAMES.includes(call.toolName))
        if (workspaceGuideRequired) {
          const guide = await this.agentRunRecorderService.startStep({
            runId: currentAgentRunId,
            type: AGENT_STEP_TYPES.workspaceDevelopment,
            input: { version: WORKSPACE_DEVELOPMENT_VERSION, activatedAfterSamplingAttemptId: samplingAttemptId },
          }, databaseDeadline)
          await this.agentRunRecorderService.completeStep(guide.id, databaseDeadline, { output: { instruction: WORKSPACE_DEVELOPMENT_INSTRUCTION as unknown as Prisma.InputJsonObject } })
          workspaceGuideStepId = guide.id
          modelContext.addInstruction(WORKSPACE_DEVELOPMENT_INSTRUCTION)
        }

        // 拿到执行工具的结果；执行过程中逐个推出 tool_started / tool_finished 给前台显示进度。
        const toolResults = yield* this.executeToolBatch({
          // 记账
          runId: currentAgentRunId,
          samplingAttemptId,
          // 进度事件
          conversationId: input.conversationId,
          assistantMessageId,

          // toos 相关
          calls, // 模型要调用的工具
          argumentsTruncated, // 模型输出是否被截断，arguments 可能不完整
          workspaceGuideRequired,
          serperApiKey: input.runtimeConfig.serperApiKey, // 运行配置快照里的 Serper Key，只有 web_search 用
          ...(input.userId ? { userId: input.userId } : {}),

          // 情况 2 用不上
          runCancellation, // 本轮 sampling 的取消信号
          // 某个 call 被打断时把该 Step 的失败归因写进 terminal.stepFailure，由外层 catch 收口。
          terminal, // 出错时写失败归因
        })

        runCancellation.throwIfUnavailable()
        // 把「模型叫了什么工具」和「工具回了什么」配成一组来回，放进上下文（此时还没发给模型）。
        // 示例（search_articles 查 Genshin 那次 Run），modelContext 里多出的这一组：
        // {
        //   samplingAttemptId: 'run-1:sampling-1', // 产出这一组的采样轮，本轮压缩按它记保留起点
        //   assistantCall: {                   // 模型说：我要调这个
        //     type: 'assistant_tool_call',
        //     calls: [{ callId: 'call_00_7UAglwcS…', name: 'search_articles', rawArgumentsJson: '{"query": "Genshin", "limit": 10}' }],
        //     reasoningContent: 'The user wants a list of articles with "Genshin" in the title. Use search_articles.',
        //     // intermediateText 为空，所以没有 content
        //   },
        //   results: [                         // 工具说：结果是这个，靠同一个 callId 与上面配对
        //     { type: 'tool_result', callId: 'call_00_7UAglwcS…', name: 'search_articles', content: '共找到 16 篇匹配文章，…', ok: true },
        //   ],
        // }
        modelContext.appendToolExchange({
          samplingAttemptId,
          calls, // 模型要调用的工具
          intermediateText: samplingDecision.intermediateText, // 模型这轮要说的话
          reasoningContent: samplingDecision.reasoningContent, // 模型这轮的思考文本
          // 工具执行的结果：回喂正文、是否成功与回喂参数
          results: toolResults.map(result => ({
            content: result.observation.content,
            ok: result.ok,
            feedbackArgumentsJson: result.feedbackArgumentsJson,
          })),
        })
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
        },
        databaseDeadline,
        runCancellation.claimCompletion,
      )
      runCancellation.claimCompleted()
      terminalizationHandled = true
      // 检查点 B：提交确认之后在后台提前压缩下一次问答的历史；不 await，不延迟 run_completed。
      // 提交结果不确定（completeRun 抛错）的分支走 catch，不发起。
      void this.contextCompactionService.compactAfterRun({
        runId: currentAgentRunId,
        conversationId: input.conversationId,
        model: input.model,
        runtimeConfig: input.runtimeConfig,
        instructions: input.instructions,
        tools: modelTools,
      })
      runCancellation.dispose()

      // 先发布本地收尾 Promise，再交付终态；下一轮可按旧 owner 有界等待，不必阻塞完成事件。
      void this.workspaces?.releaseRun(currentAgentRunId)
      yield {
        type: 'run_completed',
        runId: currentAgentRunId,
        conversationId: input.conversationId,
        assistantMessageId,
        content: terminal.content,
        generatedAt: completedMessage.updatedAt.toISOString(),
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
      const commitWarning = error instanceof DatabaseCommitOutcomeUnknownError
        ? describeRuntimeError(error)!.message
        : undefined
      // 停止原因仍先到先得，但它不能抹掉文件 COMMIT 的不确定性；实时结果与刷新后的文本都保留提醒。
      if (commitWarning)
        terminal.content = [terminal.content, commitWarning].filter(Boolean).join('\n\n')

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

        if (agentRunId)
          void this.workspaces?.releaseRun(agentRunId)
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
      if (commitWarning && runCancellation?.source === 'deadline')
        runFailure.message += `\n\n${commitWarning}`
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

      if (agentRunId)
        void this.workspaces?.releaseRun(agentRunId)
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
      if (agentRunId)
        await this.workspaces?.releaseRun(agentRunId)
      runCancellation?.dispose()
    }
  }

  /**
   * 执行一轮采样给出的全部 Tool Call：返回与 calls 一一对应的回填结果。
   * 查找、截断批次、校验、执行与修剪都由 invoke 判定，这里只开关 Step、记账与收集回喂内容。
   * 某个 call 被停止、deadline 或工具自身抛错打断时，先确立终态原因，再把该 Step 的失败归因
   * 写进 terminal.stepFailure，然后原样抛出：外层 catch 要靠原异常判断终止来源。
   * 每个 call 在开 Step 前推出 tool_started、Step 收口后推出 tool_finished（被打断的不推）：
   * yield 点都落在没有进行中 tool Step 的位置，消费者此时 return() 不会留下 RUNNING 的 Step。
   */
  private async* executeToolBatch(input: {
    userId?: string
    runId: string
    samplingAttemptId: string
    conversationId: string
    assistantMessageId: string
    calls: UnvalidatedToolCallEnvelope[]
    argumentsTruncated: boolean
    workspaceGuideRequired?: boolean
    serperApiKey: SerperApiKey
    runCancellation: RunCancellation
    terminal: RunTerminalSlots
  }): AsyncGenerator<AgentRuntimeEvent, ToolFeedback[]> {
    const {
      runId,
      samplingAttemptId,
      conversationId,
      assistantMessageId,
      calls,
      argumentsTruncated,
      serperApiKey,
      runCancellation,
      terminal,
    } = input
    const progress = { runId, conversationId, assistantMessageId }
    const { signal: runSignal, databaseDeadline } = runCancellation

    const toolResults: ToolFeedback[] = []

    // 顺序执行，每个 call 一个 tool_execution Step；写文件的确认顺序必须与模型收到的结果一致。
    for (const call of calls) {
      // 消费者在上一个 tool_finished 处暂停期间可能已停止或到期：不推一个不会执行的 tool_started。
      runCancellation.throwIfUnavailable()
      yield {
        type: 'tool_started',
        ...progress,
        callId: call.callId,
        toolName: call.toolName,
        ...toToolProgressArguments(call.rawArgumentsJson, call.toolName),
      }

      // callId / toolName 是模型原样给的，落库副本同样要能进 jsonb。
      const toolStepInput = {
        callId: toPersistableText(call.callId),
        toolName: toPersistableText(call.toolName),
        samplingAttemptId,
      }

      // 创建执行工具的 step
      const toolStep = await this.agentRunRecorderService.startStep({
        runId,
        type: AGENT_STEP_TYPES.toolExecution,
        input: toolStepInput,
      }, databaseDeadline)
      let invocation: ToolInvocationResult

      try {
        // 截断批次、查无此工具、参数无效都由 invoke 直接返回失败结果，只有校验通过的调用才真正执行。
        invocation = await this.toolInvocationService.invoke(
          call,
          { signal: runSignal, databaseDeadline, argumentsTruncated, workspaceGuideRequired: input.workspaceGuideRequired === true, serperApiKey, ...(input.userId ? { workspace: { userId: input.userId, conversationId, runId, deadlineAt: databaseDeadline.deadlineAt } } : {}) },
        )
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

      // observation 已按工具上限修剪（唯一一道截断：上下文超限只靠压缩，之后原样回喂）；
      // argumentsValidated 是 invoke 按实际走到的分支给出的：只有通过 input.parse 的调用参数才可信。
      const { result: toolResult, argumentsValidated, observation } = invocation
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
          originalChars: observation.originalChars,
          observationChars: observation.observationChars,
          truncated: observation.truncated,
          // 回喂给模型的正文，已受 maxObservationChars 限制，之后各轮原样回喂。
          observation: toPersistableText(observation.content),
          // 工具给界面的结果，与 tool_finished 同一份，只为刷新后还原时间线（#212），不进模型上下文；
          // 工具失败时界面上的原因由 code 推出，不另存。
          ...(toolResult.ok && toolResult.display ? { display: toPersistedToolDisplay(toolResult.display) } : {}),
        },
      }

      if (toolResult.ok) {
        // 工具执行成功：写入 Step output，下一轮回喂给模型的参数也写进 Step input。
        await this.agentRunRecorderService.completeStep(
          toolStep.id,
          databaseDeadline,
          { ...toolStepClose, ...(toolResult.workspaceCommit ? { workspaceCommit: toolResult.workspaceCommit } : {}) },
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

      // 文件 COMMIT 确认期间可能已停止：保留已确认文件，但不继续推成功事件或调用下一轮模型。
      runCancellation.throwIfUnavailable()
      // 成功时带工具给界面的 display（可能自己标了 failure）；失败只分超时与其他。
      const display: ToolDisplay | undefined = toolResult.ok
        ? toolResult.display
        : { failure: toolResult.code === 'timeout' ? 'timeout' : 'failed' }

      yield {
        type: 'tool_finished',
        ...progress,
        callId: call.callId,
        ok: !display?.failure,
        ...display,
      }
      toolResults.push({
        observation,
        ok: toolResult.ok,
        feedbackArgumentsJson,
      })
    }

    return toolResults
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

    if (input.agentRunId)
      void this.workspaces?.releaseRun(input.agentRunId)
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
   * 解析一次 Run 的请求级配置：模型可见 Tool 说明与 resolved 模型请求配置（模型行快照 + 请求级 reasoningEffort）。
   * 模型行的数值约束在 Admin 写入时由 `assertModelRowValid` 把关，这里不再校验。
   */
  private resolveRunConfiguration(input: RunTurnStreamInput) {
    // 工具始终全部提供给模型；顺序即工具清单的顺序。模型只看到名称、说明与输入 Schema，timeout 与 Observation 预算留在服务端。
    const modelTools = TOOL_DEFINITIONS
      .filter(definition => !this.workspaces || this.workspaces.cloud.configured || !WORKSPACE_TOOL_NAMES.includes(definition.name))
      .map(definition => ({
        name: definition.name,
        description: definition.description,
        inputSchema: definition.input.schema,
      }))
    const request = resolveChatRequestConfig(input.model.profile, {
      ...(input.reasoningEffort === undefined
        ? {}
        : { reasoningEffort: input.reasoningEffort }),
    })

    return { request, modelTools }
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
    contextPlan?: Prisma.InputJsonObject,
    debugModelIO?: DebugModelIOCaptured,
  ) {
    return {
      samplingAttemptId: summary.samplingAttemptId,
      finishReason: summary.finishReason,
      usage: toPersistedModelUsage(summary.usage),
      toolCallCount: summary.toolCallCount,
      firstTokenMs: summary.firstTokenMs,
      ...(contextPlan ? { contextPlan } : {}),
      ...this.toDebugModelIOOutput(debugModelIO),
    }
  }

  private toFailedSamplingStepOutput(
    error: unknown,
    contextPlan?: Prisma.InputJsonObject,
    debugModelIO?: DebugModelIOCaptured,
  ) {
    if (error instanceof ModelSamplingIncompleteError && error.summary) {
      return this.toSamplingStepOutput(
        error.summary,
        contextPlan,
        debugModelIO,
      )
    }

    return {
      ...(contextPlan ? { contextPlan } : {}),
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

  const rootCause = samplingFailureCause(reason)

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
  if (error instanceof DatabaseCommitOutcomeUnknownError)
    return { errorCode: 'internal', message: '数据库提交结果未知，请刷新会话与工作文件核对，不要假设改动已经回滚。' }

  return undefined
}

/** 服务商报的输入超长。 */
function isContextOverflow(error: unknown): boolean {
  return samplingFailureCause(error) instanceof LLMContextOverflowError
}

function toLlmErrorCode(error: LLMError): AgentRunErrorCode {
  if (error instanceof LLMAuthError)
    return 'llm_auth'
  if (error instanceof LLMBalanceError)
    return 'llm_balance'
  if (error instanceof LLMRateLimitError)
    return 'llm_rate_limit'
  // 先于它的父类 LLMInvalidRequestError。
  if (error instanceof LLMContextOverflowError)
    return 'llm_context_overflow'
  if (error instanceof LLMInvalidRequestError)
    return 'llm_invalid_request'
  if (error instanceof LLMServerError)
    return 'llm_server'
  if (error instanceof LLMNetworkError)
    return 'llm_network'

  // LLMApiError：adapter 协议异常，或 400 / 401 / 402 / 403 / 422 / 429 / 5xx 之外的 HTTP 状态。
  return 'llm_protocol'
}

/**
 * 每个 sampling Step 的 `input.initialContext`：本 Run 的模型快照、触发线（模型行「单次输入上限」）与给模型的工具名单
 * （当次部署的工具清单全部）；工具定义本身取自当次部署的代码（已知偏差）。读到的历史条数在 load_conversation_history 的 output。
 */
function toPersistedInitialContext(
  model: ResolvedLlmModel,
  resolvedModel: string,
  modelTools: ModelToolSpec[],
): Prisma.InputJsonObject {
  return {
    resolvedModel,
    providerId: model.provider.providerId,
    modelId: model.modelId,
    resolvedInputBudgetTokens: model.maxInputTokens,
    modelToolNames: modelTools.map(tool => tool.name),
  }
}

/**
 * 本轮输入的还原依据（#220）：触发线与估算，本轮基于的历史压缩记录（摘要 + 覆盖集合）与本轮压缩 Step（前缀摘要 +
 * 保留起点），以及未被覆盖的历史 Message 条数（同一会话并发时按条数重建）。它们与历史消息、Step 里的正文一起还原本轮输入。
 */
function toPersistedContextPlan(
  plan: SamplingContextPlan,
  resolvedInputBudgetTokens: number,
): Prisma.InputJsonObject {
  return {
    resolvedInputBudgetTokens,
    estimatedInputTokens: plan.estimatedInputTokens,
    compactionId: plan.compactionId,
    turnCompactionStepId: plan.turnCompactionStepId,
    historyIncludedCount: plan.historyIncludedCount,
  }
}

/**
 * Tool Call 轮随 assistant 消息回填给模型的内容：本轮文本与 reasoning continuation。
 * DeepSeek 家族续轮一律回填 `reasoning_content`（模型没思考时为空串），这里仍只在非空时落库，
 * 重建时缺失即视为空串。final_answer 轮的文本是最终回答，不在这里。
 * final_answer 轮与没收完的一轮（停止、失败，decision 为空）的思考不回填模型、不属于模型可见内容：
 * 存的是推给界面的同一份原文，同样只在非空时写进 reasoningContent，只为刷新后还原时间线（#212）。
 */
function toPersistedSamplingContent(
  decision: SamplingDecision | undefined,
  roundReasoning: string,
): Prisma.InputJsonObject {
  if (decision?.type !== 'tool_call')
    return roundReasoning ? { reasoningContent: roundReasoning } : {}

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
 * 落库的 display（#212）：只取 tool_finished 协议里的字段（工具多带的字段不存），
 * 网页标题、地址来自外部，同样换掉 jsonb 存不了的字符。
 */
function toPersistedToolDisplay(display: ToolDisplay): Prisma.InputJsonObject {
  return {
    ...(display.workspace ? { workspace: JSON.parse(JSON.stringify(display.workspace, (_key, value: unknown) => typeof value === 'string' ? toPersistableText(value) : value)) as Prisma.InputJsonObject } : {}),
    ...(display.failure === undefined ? {} : { failure: display.failure }),
    ...(display.results === undefined
      ? {}
      : { results: display.results.map(({ title, url }) => ({ title: toPersistableText(title), url: toPersistableText(url) })) }),
    ...(display.finalUrl === undefined ? {} : { finalUrl: toPersistableText(display.finalUrl) }),
    ...(display.title === undefined ? {} : { title: toPersistableText(display.title) }),
    ...(display.chars === undefined ? {} : { chars: display.chars }),
  }
}
