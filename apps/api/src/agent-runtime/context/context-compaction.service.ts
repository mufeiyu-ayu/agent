import type {
  MessageInputItem,
  ModelInputItem,
  ModelToolSpec,
  ModelUsage,
  ResolvedChatRequestConfig,
} from '@agent/ai'
import type { Prisma } from '../../generated/prisma/client.js'
import type { ResolvedLlmModel } from '../../llm/llm-model-config.service.js'
import type { DatabaseOperationDeadline } from '../../prisma/prisma.service.js'
import type { RuntimeConfigSnapshot } from '../../runtime-config/runtime-config.service.js'
import type { RunCancellation } from '../lifecycle/run-cancellation.js'
import type { HistorySummaryChunk } from './compaction.js'
import type { HistoryCompactionRecord } from './conversation-history.js'
import type { ModelContext } from './model-context.js'

import { reasoningEffortsOf } from '@agent/contracts'
import { Inject, Injectable, Logger } from '@nestjs/common'
import { LLMService } from '../../llm/llm.service.js'
import { DatabaseOperationDeadlineExceededError, PrismaService } from '../../prisma/prisma.service.js'
import { ModelSamplingIncompleteError } from '../agent-runtime.errors.js'
import { AGENT_STEP_TYPES, AgentRunRecorderService } from '../lifecycle/agent-run-recorder.service.js'
import { toPersistableText } from '../persistable-text.js'
import { streamModelSampling } from '../sampling/model-sampling-decision.js'
import {
  historySummaryChunks,
  keepRecentBudget,
  planHistoryCompaction,
  planTurnCompaction,
  serializeTurnPrefix,
  SUMMARIZATION_SYSTEM_PROMPT,
  SUMMARY_MAX_TOKENS,
  summaryRequestText,
  TURN_PREFIX_SUMMARY_MAX_TOKENS,
} from './compaction.js'
import { historyItems, loadConversationHistory } from './conversation-history.js'
import { estimateRequestTokens } from './token-estimate.js'

/** 回答结束后，下一次问答的历史粗估超过触发线的这个比例就在后台提前压缩（我们加的：网页端下次提问不该等）。 */
const AFTER_RUN_RATIO = 0.8
/** 连续这么多次尝试无效（摘要失败或压完仍超线）后，本 Run 停用阈值压缩，只剩服务商报超长时的强制压缩（我们加的）。 */
const MAX_INEFFECTIVE_ATTEMPTS = 2

/** threshold：调模型前超触发线；overflow：服务商报超长；after_run：问答结束后预压。 */
type CompactionReason = 'threshold' | 'overflow' | 'after_run'

/** 一次 Run 内压缩要用的东西：runtime 在 Run 开始时建一份，贯穿整个 Run。 */
export interface CompactionRun {
  runId: string
  conversationId: string
  model: ResolvedLlmModel
  /** 运行配置「压缩保留最近 Tokens」。 */
  keepRecentTokens: number
  tools: ModelToolSpec[]
  context: ModelContext
  cancellation: RunCancellation
  /**
   * 防循环：照 Pi（`compaction.ts:766-768,817`）要有新内容才压；「两次尝试之间要有成功采样」比 Pi 严，
   * 与连续无效上限都是我们加的（写页面时读进大文件、一次压不下去很常见，不能压一次就停）。
   */
  loop: {
    /** 上次尝试之后还没有成功采样：检查点 A 不再压。检查点 C 的强制压缩也算一次尝试；成功采样后由 runtime 复位。 */
    attemptedSinceSampling: boolean
    /** 连续无效的尝试次数，一次有效就清零。 */
    ineffectiveAttempts: number
  }
}

type SummaryResult
  = | { ok: true, summary: string, usage: ModelUsage | null }
    | { ok: false, reason: string, usage: ModelUsage | null }

/**
 * 上下文自动压缩的编排（#220）：检查点 A（每次调模型前超触发线）、C（服务商报超长后强制压缩一次再重试）
 * 与 B（问答成功结束后在后台预压）。切点、序列化与提示词在 `compaction.ts`。
 *
 * 两层（我们加的：同会话可并发 Run、失败 Run 的回答不进历史，会话级切点落进进行中的问答会还原不出来）：
 * 历史压缩只覆盖已结束的问答整组，写 ConversationCompaction 表；本轮压缩把本 Run 前面的工具轮写成前缀摘要，
 * 记在 context_compaction Step 上，Run 结束后这次问答在历史里按压缩后的样子还原。
 */
@Injectable()
export class ContextCompactionService {
  private readonly logger = new Logger(ContextCompactionService.name)

  constructor(
    @Inject(LLMService)
    private readonly llmService: LLMService,

    @Inject(PrismaService)
    private readonly prismaService: PrismaService,

    @Inject(AgentRunRecorderService)
    private readonly agentRunRecorderService: AgentRunRecorderService,
  ) {}

  /**
   * 检查点 A：每次调模型前（照抄 Pi；每次问答第 1 次调用前也查是我们加的，因为每次问答都从库重建）。
   * 估算超过触发线（模型行「单次输入上限」）且没停用时尝试一次：有可摘要的历史先压历史，没有或压完仍超线再压本轮。
   * 压缩失败不影响这次调用照常发出：触发线离模型真实上限至少还有「最大输出 + 16,384」。
   */
  async compactBeforeSampling(run: CompactionRun): Promise<void> {
    if (run.loop.attemptedSinceSampling || run.loop.ineffectiveAttempts >= MAX_INEFFECTIVE_ATTEMPTS)
      return

    const tokensBefore = run.context.estimateInputTokens(run.tools)

    if (tokensBefore > run.model.maxInputTokens)
      await this.attempt(run, 'threshold', tokensBefore)
  }

  /** 检查点 C 先看有没有可压缩的内容：没有就不救（照 Pi：没内容可压时直接返回），失败的采样照常随 Run 收口。 */
  canCompact(run: CompactionRun): boolean {
    const keepBudget = keepRecentBudget(run.keepRecentTokens, run.model.maxInputTokens)

    return planHistoryCompaction(run.context.conversationHistory, keepBudget) !== undefined
      || turnCut(run, keepBudget) !== undefined
  }

  /**
   * 检查点 C：服务商报超长后强制压缩一次（照抄 Pi，不看触发线）。压成了返回 true，由 runtime 新开一次采样重试；
   * 压缩失败时返回 false，runtime 按原来的超长错误收口。
   */
  async compactAfterOverflow(run: CompactionRun): Promise<boolean> {
    this.logger.warn({ event: 'context_overflow_compaction', runId: run.runId })

    return await this.attempt(run, 'overflow', run.context.estimateInputTokens(run.tools)) === 'compacted'
  }

  /**
   * 检查点 B：问答成功提交后在后台提前压缩下一次问答的历史（时机照 Pi 问答结束后，后台与 0.8 的预压线是我们加的）。
   * 调用方不 await（返回的 Promise 不会拒绝），不写 Step，失败只记日志；进程关停时直接丢弃。下一次问答不等它：
   * 估算不超线时直接用当时最新的记录，超线时检查点 A 自己同步压缩，两边重复压缩只多花一次调用（记录各自完整）。
   */
  compactAfterRun(input: {
    runId: string
    conversationId: string
    model: ResolvedLlmModel
    runtimeConfig: RuntimeConfigSnapshot
    instructions: MessageInputItem[]
    tools: ModelToolSpec[]
  }): Promise<void> {
    const startedAt = performance.now()

    return this.compactAfterRunInBackground(input).catch((error: unknown) => {
      this.logger.warn({
        event: 'after_run_compaction_failed',
        runId: input.runId,
        durationMs: Math.round(performance.now() - startedAt),
        errorName: error instanceof Error ? error.name : typeof error,
        message: error instanceof Error ? error.message : String(error),
      })
    })
  }

  /**
   * 一次尝试：「先历史、再本轮」两步合起来。两层都没有新内容时什么都不做、不算一次尝试；
   * 否则记下这次尝试，按压完的估算判断有效与否（摘要失败或仍超线都算无效）。
   */
  private async attempt(
    run: CompactionRun,
    reason: 'threshold' | 'overflow',
    tokensBefore: number,
  ): Promise<'nothing' | 'compacted' | 'failed'> {
    const { context } = run
    const triggerTokens = run.model.maxInputTokens
    const keepBudget = keepRecentBudget(run.keepRecentTokens, triggerTokens)
    const historyPlan = planHistoryCompaction(context.conversationHistory, keepBudget)
    let attempted = false
    let compacted = false

    if (historyPlan) {
      attempted = true
      compacted = await this.compactHistoryInRun(run, historySummaryChunks(context.conversationHistory, historyPlan, triggerTokens), reason, tokensBefore)
    }

    if (!historyPlan || context.estimateInputTokens(run.tools) > triggerTokens) {
      const cut = turnCut(run, keepBudget)

      if (cut !== undefined) {
        attempted = true
        compacted = await this.compactTurn(run, cut, tokensBefore) || compacted
      }
    }

    if (!attempted)
      return 'nothing'

    const effective = compacted && context.estimateInputTokens(run.tools) <= triggerTokens

    run.loop.attemptedSinceSampling = true
    run.loop.ineffectiveAttempts = effective ? 0 : run.loop.ineffectiveAttempts + 1

    return compacted ? 'compacted' : 'failed'
  }

  /** Run 内的历史压缩：每块一次摘要调用、一条 context_compaction Step，成功就插记录并换进上下文。 */
  private async compactHistoryInRun(
    run: CompactionRun,
    chunks: HistorySummaryChunk[],
    reason: 'threshold' | 'overflow',
    tokensBefore: number,
  ): Promise<boolean> {
    const { context, cancellation } = run
    const { databaseDeadline } = cancellation
    let previousSummary = context.conversationHistory.compaction?.summary
    let compacted = false

    for (const chunk of chunks) {
      const step = await this.agentRunRecorderService.startStep({
        runId: run.runId,
        type: AGENT_STEP_TYPES.contextCompaction,
        input: { kind: 'history' },
      }, databaseDeadline)
      const startedAt = performance.now()
      const result = await this.summarizeInRun(run, summaryRequestText({ kind: 'history', conversation: chunk.conversation, previousSummary }), SUMMARY_MAX_TOKENS)
      const durationMs = Math.round(performance.now() - startedAt)

      if (!result.ok) {
        await this.agentRunRecorderService.failStep(step.id, databaseDeadline, {
          errorMessage: result.reason,
          output: { tokensBefore, ...toUsageOutput(result.usage), durationMs },
        })
        return compacted
      }

      // 先插记录再收口 Step：之间被停止时 Step 随 Run 收成 ABORTED，记录保留且内容完整，下一次问答照常使用。
      const record = await this.insertRecord({
        conversationId: run.conversationId,
        runId: run.runId,
        reason,
        chunk,
        summary: result.summary,
        readAt: context.conversationHistory.readAt,
        tokensBefore,
        usage: result.usage,
        modelId: run.model.modelId,
      }, databaseDeadline)

      await this.agentRunRecorderService.completeStep(step.id, databaseDeadline, {
        output: { compactionId: record.id, tokensBefore, ...toUsageOutput(result.usage), durationMs },
      })
      context.applyHistoryCompaction(record)
      previousSummary = record.summary
      compacted = true
    }

    return compacted
  }

  /**
   * 本轮压缩：保留起点之前的工具轮写成前缀摘要。首次用 TURN_PREFIX 提示词、带上当前问题；再次压缩时旧前缀摘要作为
   * `<previous-summary>`，用 UPDATE 提示词从上次保留的起点合并（照 Pi）。
   */
  private async compactTurn(run: CompactionRun, cut: number, tokensBefore: number): Promise<boolean> {
    const { context, cancellation } = run
    const { databaseDeadline } = cancellation
    const previous = context.turnCompaction
    const keptFromSamplingAttemptId = context.exchanges[cut]!.samplingAttemptId
    const conversation = serializeTurnPrefix({
      question: previous ? undefined : context.question,
      exchanges: context.exchanges.slice(previous?.keptFrom ?? 0, cut),
    })
    const step = await this.agentRunRecorderService.startStep({
      runId: run.runId,
      type: AGENT_STEP_TYPES.contextCompaction,
      input: { kind: 'turn', keptFromSamplingAttemptId },
    }, databaseDeadline)
    const startedAt = performance.now()
    const result = await this.summarizeInRun(
      run,
      summaryRequestText({ kind: 'turn_prefix', conversation, previousSummary: previous?.summary }),
      previous ? SUMMARY_MAX_TOKENS : TURN_PREFIX_SUMMARY_MAX_TOKENS,
    )
    const durationMs = Math.round(performance.now() - startedAt)

    if (!result.ok) {
      await this.agentRunRecorderService.failStep(step.id, databaseDeadline, {
        errorMessage: result.reason,
        output: { tokensBefore, ...toUsageOutput(result.usage), durationMs },
      })
      return false
    }

    await this.agentRunRecorderService.completeStep(step.id, databaseDeadline, {
      output: { summary: result.summary, tokensBefore, ...toUsageOutput(result.usage), durationMs },
    })
    context.applyTurnCompaction({ stepId: step.id, summary: result.summary, keptFrom: cut })

    return true
  }

  /** Run 内写摘要：用 Run 的信号，被停止或到期时先按终态原因抛出，打开的压缩 Step 随 Run 收口。 */
  private async summarizeInRun(run: CompactionRun, text: string, maxTokens: number): Promise<SummaryResult> {
    try {
      const result = await this.summarize(run.model, text, maxTokens, run.cancellation.signal)

      run.cancellation.throwIfUnavailable()
      if (!result.ok)
        this.logger.warn({ event: 'context_compaction_failed', runId: run.runId, message: result.reason })

      return result
    }
    catch (error) {
      run.cancellation.throwIfUnavailable()
      throw error
    }
  }

  private async compactAfterRunInBackground(input: Parameters<ContextCompactionService['compactAfterRun']>[0]): Promise<void> {
    const { runDeadlineMs } = input.runtimeConfig.limits
    // 自己的时限：取本 Run 快照的单次最长时间；数据库操作同一个上界。
    const signal = AbortSignal.timeout(runDeadlineMs)
    const deadline: DatabaseOperationDeadline = {
      deadlineAt: Date.now() + runDeadlineMs,
      signal,
      createTimeoutError: () => new DatabaseOperationDeadlineExceededError(),
    }
    const { history } = await loadConversationHistory(this.prismaService, input.conversationId, undefined, deadline)
    const triggerTokens = input.model.maxInputTokens
    // 下一次问答会发出的历史（不含还不知道的下一个问题）全部粗估。
    const tokensBefore = estimateRequestTokens({ items: [...input.instructions, ...historyItems(history)], tools: input.tools })

    if (tokensBefore <= AFTER_RUN_RATIO * triggerTokens)
      return

    const plan = planHistoryCompaction(history, keepRecentBudget(input.runtimeConfig.compactionKeepRecentTokens, triggerTokens))

    if (!plan)
      return

    let previousSummary = history.compaction?.summary

    for (const chunk of historySummaryChunks(history, plan, triggerTokens)) {
      const result = await this.summarize(input.model, summaryRequestText({ kind: 'history', conversation: chunk.conversation, previousSummary }), SUMMARY_MAX_TOKENS, signal)

      if (!result.ok)
        throw new Error(result.reason)

      const record = await this.insertRecord({
        conversationId: input.conversationId,
        runId: input.runId,
        reason: 'after_run',
        chunk,
        summary: result.summary,
        readAt: history.readAt,
        tokensBefore,
        usage: result.usage,
        modelId: input.model.modelId,
      }, deadline)

      previousSummary = record.summary
    }
  }

  /**
   * 写摘要（照抄 Pi `generateSummaryWithUsage`）：当前对话模型、不带工具，一条系统提示词 + 一条用户消息；只收正文、忽略思考。
   * 思考压到最低（我们加的：OpenAI 兼容接口的 max_tokens 含思考，照会话强度会被思考吃满而 length 失败）：DeepSeek 发
   * thinking disabled，其他家族取最低一档 reasoning_effort，没有就不发。`length`、报错、正文为空（我们加的）都算失败；
   * 临时性错误的重试交给 SDK，流中途断开按失败处理。只有信号已中止时才抛出。
   */
  private async summarize(model: ResolvedLlmModel, text: string, maxTokens: number, signal: AbortSignal): Promise<SummaryResult> {
    // 各家族的强度按从低到高列出。
    const lowestEffort = reasoningEffortsOf(model.family)[0]
    const request: ResolvedChatRequestConfig = {
      model: model.profile.wireName,
      contextWindowTokens: model.profile.contextWindowTokens,
      maxOutputTokens: Math.min(maxTokens, model.profile.maxOutputTokens),
      compat: model.profile.compat,
      ...(model.profile.compat.thinkingFormat === 'deepseek'
        ? { thinking: 'disabled' as const }
        : lowestEffort ? { reasoningEffort: lowestEffort } : {}),
    }
    const items: ModelInputItem[] = [
      { type: 'message', role: 'system', content: SUMMARIZATION_SYSTEM_PROMPT },
      { type: 'message', role: 'user', content: text },
    ]
    let summary = ''

    try {
      const sampling = streamModelSampling(
        this.llmService.chatStream(model.provider, items, { request, signal }),
        'context-compaction',
      )
      let next = await sampling.next()

      while (!next.done) {
        if (next.value.kind === 'text')
          summary += next.value.delta
        next = await sampling.next()
      }

      if (!summary.trim())
        return { ok: false, reason: '写摘要失败：摘要正文为空。', usage: next.value.summary.usage }

      return { ok: true, summary: toPersistableText(summary), usage: next.value.summary.usage }
    }
    catch (error) {
      if (signal.aborted)
        throw error

      // 流读取失败时真实原因在 cause 上；length 等未完整结束的原因就是错误自身的文案。
      const cause = error instanceof ModelSamplingIncompleteError && error.cause !== undefined ? error.cause : error

      return {
        ok: false,
        reason: `写摘要失败：${cause instanceof Error ? cause.message : String(cause)}`,
        usage: error instanceof ModelSamplingIncompleteError ? error.summary?.usage ?? null : null,
      }
    }
  }

  private async insertRecord(input: {
    conversationId: string
    runId: string
    reason: CompactionReason
    chunk: HistorySummaryChunk
    summary: string
    readAt: Date
    tokensBefore: number
    usage: ModelUsage | null
    modelId: string
  }, deadline: DatabaseOperationDeadline): Promise<HistoryCompactionRecord> {
    return await this.prismaService.withDeadlineTransaction(deadline, transaction => transaction.execute(prisma => prisma.conversationCompaction.create({
      data: {
        conversationId: input.conversationId,
        runId: input.runId,
        reason: input.reason,
        summary: input.summary,
        coveredGroupIds: input.chunk.coveredGroupIds,
        answerOnlyGroupId: input.chunk.answerOnlyGroupId,
        readAt: input.readAt,
        tokensBefore: input.tokensBefore,
        ...toUsageOutput(input.usage),
        modelId: input.modelId,
      },
      select: { id: true, summary: true, coveredGroupIds: true, answerOnlyGroupId: true },
    })))
  }
}

/**
 * 本轮压缩的切点。只用一份保留预算（照 Pi）：先扣掉历史里仍是原文的部分，两层各留一份会让压完仍贴着触发线（我们加的）。
 */
function turnCut(run: CompactionRun, keepBudget: number): number | undefined {
  return planTurnCompaction(
    run.context.exchanges,
    run.context.turnCompaction?.keptFrom ?? 0,
    Math.max(0, keepBudget - run.context.historyRawTokens()),
  )
}

/** 用量按采样 Step 的 output.usage 同一形状落库：去掉缺失的字段，没有就不写。 */
function toUsageOutput(usage: ModelUsage | null): { usage?: Prisma.InputJsonObject } {
  if (!usage)
    return {}

  return { usage: Object.fromEntries(Object.entries(usage).filter(([, value]) => value !== undefined)) as Prisma.InputJsonObject }
}
