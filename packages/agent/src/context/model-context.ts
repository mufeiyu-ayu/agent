import type {
  AssistantToolCallInputItem,
  MessageInputItem,
  ModelInputItem,
  ModelToolSpec,
  ModelUsage,
  ToolResultInputItem,
} from '@agent/ai'
import type { UnvalidatedToolCallEnvelope } from '../tools/tool.types.js'
import type { ConversationHistory, HistoryCompactionRecord, HistoryQuestion } from './conversation-history.js'

import { groupItems, historyItems, questionItem, turnSummaryMessage } from './conversation-history.js'
import { estimateItemTokens, estimateRequestTokens, roughTokens } from './token-estimate.js'

/** 一轮 sampling 产生的 assistant Tool Call 消息与逐个 call 对应的结果。 */
export interface ModelContextToolExchange {
  /** 产出这一轮的采样尝试 `${runId}:sampling-${N}`：本轮压缩按它记保留起点。 */
  samplingAttemptId: string
  assistantCall: AssistantToolCallInputItem
  /** 与 assistantCall.calls 一一对应，顺序相同。 */
  results: ToolResultInputItem[]
}

/** 本 Run 最后一次成功的本轮压缩（#220）：前缀摘要替换保留起点之前的工具轮。 */
export interface TurnCompaction {
  stepId: string
  summary: string
  /** 第一条保留原文的工具轮下标。 */
  keptFrom: number
}

/** 一次调模型前的规划：发出的输入与估算；落库哪些字段见 agent-runtime.ts 的 toPersistedContextPlan。 */
export interface SamplingContextPlan {
  items: ModelInputItem[]
  estimatedInputTokens: number
  /** 本次基于的历史压缩记录，没有为 null。 */
  compactionId: string | null
  /** 本次基于的本轮压缩 Step，没有为 null。 */
  turnCompactionStepId: string | null
  /** 未被覆盖的历史组的 Message 条数：同一会话并发时按条数重建。 */
  historyIncludedCount: number
}

interface CreateModelContextInput {
  instructions: MessageInputItem[]
  history: ConversationHistory
  currentUser: HistoryQuestion
}

/**
 * 单次 Run 内模型看到的上下文：系统提示词 → 历史（压缩记录的摘要 + 未被覆盖的问答组）→ 当前问题
 * →（本轮压缩的前缀摘要）→ 本 Run 保留的工具轮。不删减内容；超触发线时由压缩改写（#220）。
 */
export class ModelContext {
  private readonly toolExchanges: ModelContextToolExchange[] = []
  private turn: TurnCompaction | undefined
  /**
   * 同一次问答内上一次采样的真实用量（输入 + 输出）与它发出时已有几组工具来回；每次问答第 1 次、上一次采样
   * 没有可用用量或失败、之后压缩过时为空。
   */
  private usageAnchor: { tokens: number, exchangeCount: number } | undefined

  private constructor(
    private readonly instructions: MessageInputItem[],
    // 本 Run 开始时读到的历史：历史压缩后换成新记录、去掉被覆盖的组，不重读消息。
    private history: ConversationHistory,
    private readonly currentUser: HistoryQuestion,
  ) {}

  static create(input: CreateModelContextInput): ModelContext {
    return new ModelContext([...input.instructions], input.history, input.currentUser)
  }

  get conversationHistory(): ConversationHistory {
    return this.history
  }

  get exchanges(): readonly ModelContextToolExchange[] {
    return this.toolExchanges
  }

  get turnCompaction(): TurnCompaction | undefined {
    return this.turn
  }

  get question(): HistoryQuestion {
    return this.currentUser
  }

  /** 只在对应启用 Step 确认后追加，清掉旧用量锚点，下一轮重新计入指令。 */
  addInstruction(instruction: MessageInputItem): void {
    this.instructions.push(instruction)
    this.usageAnchor = undefined
  }

  /** 调模型前：组装完整输入并估算。 */
  plan(tools: ModelToolSpec[]): SamplingContextPlan {
    return {
      items: this.items(),
      estimatedInputTokens: this.estimateInputTokens(tools),
      compactionId: this.history.compaction?.id ?? null,
      turnCompactionStepId: this.turn?.stepId ?? null,
      historyIncludedCount: this.history.groups.reduce((count, group) => count + group.messageCount, 0),
    }
  }

  /**
   * 估算（照抄 Pi `estimateContextTokens`）：同一次问答内有上一次采样的真实用量时 = 用量 + 之后新增的工具结果粗估，
   * 那次采样的输出（tool_calls 消息）已含在输出用量里、不重复计；否则整份请求全部粗估。
   */
  estimateInputTokens(tools: ModelToolSpec[]): number {
    const anchor = this.usageAnchor

    if (!anchor)
      return estimateRequestTokens({ items: this.items(), tools })

    return this.toolExchanges.slice(anchor.exchangeCount).reduce(
      (tokens, exchange) => exchange.results.reduce((sum, result) => sum + roughTokens(result.content), tokens),
      anchor.tokens,
    )
  }

  /** 历史里未被覆盖的原文（不含摘要消息）的粗估：本轮压缩的保留预算要先扣掉它。 */
  historyRawTokens(): number {
    return this.history.groups.reduce(
      (tokens, group) => groupItems(group, group.key === this.history.compaction?.answerOnlyGroupId)
        .reduce((sum, item) => sum + estimateItemTokens(item), tokens),
      0,
    )
  }

  /** 一次采样成功收完后调用：输入 + 输出用量可用就作下一次估算的锚点；缺字段或为 0 时清掉，下一次全部粗估。 */
  recordSamplingUsage(usage: ModelUsage | null): void {
    const tokens = usage?.inputTokens !== undefined && usage.outputTokens !== undefined
      ? usage.inputTokens + usage.outputTokens
      : 0

    this.usageAnchor = tokens > 0 ? { tokens, exchangeCount: this.toolExchanges.length } : undefined
  }

  /** 采样失败后调用：下一次全部粗估。 */
  forgetSamplingUsage(): void {
    this.usageAnchor = undefined
  }

  /** 换成新的历史压缩记录：去掉它覆盖的组（不重读消息），之后全部粗估。 */
  applyHistoryCompaction(record: HistoryCompactionRecord): void {
    const covered = new Set(record.coveredGroupIds)

    this.history = {
      ...this.history,
      compaction: record,
      groups: this.history.groups.filter(group => !covered.has(group.key)),
    }
    this.usageAnchor = undefined
  }

  /** 本轮压缩成功：保留起点之前的工具轮换成前缀摘要，之后全部粗估。 */
  applyTurnCompaction(turn: TurnCompaction): void {
    this.turn = turn
    this.usageAnchor = undefined
  }

  /**
   * 将一轮 sampling 已处理完的全部 Tool Call 与各自的 Tool Result 成组追加到当前 Run 的上下文，供下一轮继续读取。
   *
   * @description 这是核心模型输入，不是用户可见 Message，也不会在此函数中写入数据库。
   * `callId` 保证 Provider 能把每个调用与结果配对。
   */
  appendToolExchange(input: {
    samplingAttemptId: string
    // 上一轮模型产生的全部工具名与 callId，按 index 顺序。原始参数刻意不收：
    // 回喂的只能是 results 里的续轮表示，与 tool Step 落库的是同一个字符串。
    calls: Array<Pick<UnvalidatedToolCallEnvelope, 'callId' | 'toolName'>>
    // 模型在本轮产生的可选文本，存在时作为 assistant content 续传。
    intermediateText: string
    // DeepSeek thinking Tool Call 要求下一轮原样续传的 reasoning continuation，不是 UI 消息。
    reasoningContent: string
    // 与 calls 一一对应：后端工具结果经工具上限处理后的模型可见文本，以及执行是否成功；
    // 失败结果也要回填模型，让它决定后续行为。
    results: Array<{
      content: string
      ok: boolean
      /** 回喂给模型的参数 JSON，由调用方经 toFeedbackArgumentsJson 得出；tool Step 落库的是同一个字符串。 */
      feedbackArgumentsJson: string
    }>
  }): void {
    if (input.calls.length === 0 || input.calls.length !== input.results.length)
      throw new RangeError('Tool Exchange 的 calls 与 results 必须一一对应且非空')

    this.toolExchanges.push({
      samplingAttemptId: input.samplingAttemptId,
      // Provider 视角的 assistant Tool Call 消息：表示「模型刚才请求调用了什么」。
      assistantCall: {
        type: 'assistant_tool_call',
        calls: input.calls.map((call, index) => ({
          callId: call.callId,
          name: call.toolName,
          rawArgumentsJson: input.results[index]!.feedbackArgumentsJson,
        })),
        reasoningContent: input.reasoningContent,
        ...(input.intermediateText ? { content: input.intermediateText } : {}),
      },
      // Provider 视角的 Tool Result：通过同一 callId 与 assistant 消息里的 call 严格配对。
      results: input.calls.map((call, index) => ({
        type: 'tool_result',
        callId: call.callId,
        name: call.toolName,
        content: input.results[index]!.content,
        ok: input.results[index]!.ok,
      })),
    })
  }

  private items(): ModelInputItem[] {
    return [
      ...this.instructions,
      ...historyItems(this.history),
      questionItem(this.currentUser),
      ...(this.turn ? [turnSummaryMessage(this.turn.summary)] : []),
      ...this.toolExchanges.slice(this.turn?.keptFrom ?? 0).flatMap(exchange => [exchange.assistantCall, ...exchange.results]),
    ]
  }
}

/**
 * 续轮表示里的 arguments。
 *
 * 通过工具输入契约校验的参数是 JSON 对象，原样续传。未校验的原始参数（unknown_tool /
 * invalid_arguments / truncated_arguments）可能是任意文本或非对象 JSON，统一用 DeepSeek 官方编码器
 * 对不可解析参数的回退形状 `{"arguments": raw}` 承载：原文一字不改保留在值里，wire 上是合法 JSON 对象。
 * Runtime 每个 call 只调用一次，同一个字符串既进 appendToolExchange，也落 tool_execution Step 的 `input.arguments`。
 */
export function toFeedbackArgumentsJson(
  rawArgumentsJson: string,
  argumentsValidated: boolean,
): string {
  return argumentsValidated
    ? rawArgumentsJson
    : JSON.stringify({ arguments: rawArgumentsJson })
}
