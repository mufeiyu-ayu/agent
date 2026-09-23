import type {
  AssistantToolCallInputItem,
  MessageInputItem,
  ModelInputItem,
  ToolResultInputItem,
} from '@agent/ai'
import type { NormalizedToolObservation } from '../../tools/core/tool-observation.js'
import type { UnvalidatedToolCallEnvelope } from '../../tools/core/tool.types.js'

/** 一个 Tool Call 的结果：Tool Result 文本与供 Context Planner 二次缩短的来源。 */
export interface ModelContextToolResult {
  toolResult: ToolResultInputItem
  observation: NormalizedToolObservation
  contextBudgetPreviewChars: number | null
}

/** 一轮 sampling 产生的 assistant Tool Call 消息与逐个 call 对应的结果。 */
export interface ModelContextToolExchange {
  exchangeIndex: number
  assistantCall: AssistantToolCallInputItem
  /** 与 assistantCall.calls 一一对应，顺序相同。 */
  results: ModelContextToolResult[]
}

/** Sampling Planner 使用的显式 source identity，不依赖 role 或数组位置反推。 */
export interface ModelContextPlanningState {
  instructions: MessageInputItem[]
  initialHistory: MessageInputItem[]
  // 原始候选基准，只用于 plan summary 统计有多少条历史未纳入（内存统计，不落库）。
  // 不参与 Token 估算、历史删减决策或模型输入组装。
  initialHistoryCandidateCount: number
  currentUser: MessageInputItem
  toolExchanges: ModelContextToolExchange[]
}

export interface ModelContextPlanCommit {
  excludedOldestHistoryCount: number
  observations: Array<{
    exchangeIndex: number
    resultIndex: number
    content: string
    contextBudgetPreviewChars: number | null
  }>
}

interface CreateModelContextInput {
  instructions: MessageInputItem[]
  initialHistory: MessageInputItem[]
  currentUserMessage: MessageInputItem
}

/** 单次 Run 内的 source-aware model-visible context；预算选择由 Sampling Planner 负责。 */
export class ModelContext {
  private readonly toolExchanges: ModelContextToolExchange[] = []

  private constructor(
    // 核心输入：模型必须携带的指令消息；当前 Chat 入口中就是系统提示词。
    private readonly instructions: MessageInputItem[],
    // 核心输入：一次查询读到的全部历史候选；每轮 plan() 超预算时从最旧删减。
    private readonly initialHistory: MessageInputItem[],
    // 创建时的候选总数基准，用它减去当前 initialHistory.length 得出累计有多少条历史
    // 未纳入模型上下文；只进 plan summary，不落库（Admin 的候选条数取自 load_conversation_history）。
    // 它不参与 Token 计算、历史删减决策或真正的模型输入。
    private readonly initialHistoryCandidateCount: number,
    // 核心输入：触发本次 Run 的当前用户消息，始终必须保留。
    private readonly currentUser: MessageInputItem,
  ) {}

  static fromHistory(input: CreateModelContextInput): ModelContext {
    const initialHistory = input.initialHistory.map(cloneMessage)

    return new ModelContext(
      input.instructions.map(cloneMessage),
      initialHistory,
      // 候选基准就是读取条数：全部候选都先进入 initialHistory，裁剪发生在 plan()。
      initialHistory.length,
      cloneMessage(input.currentUserMessage),
    )
  }

  forPlanning(): ModelContextPlanningState {
    return {
      instructions: this.instructions.map(cloneMessage),
      initialHistory: this.initialHistory.map(cloneMessage),
      initialHistoryCandidateCount: this.initialHistoryCandidateCount,
      currentUser: cloneMessage(this.currentUser),
      toolExchanges: this.toolExchanges.map(exchange => ({
        exchangeIndex: exchange.exchangeIndex,
        assistantCall: cloneAssistantCall(exchange.assistantCall),
        results: exchange.results.map(result => ({
          toolResult: { ...result.toolResult },
          observation: { ...result.observation },
          contextBudgetPreviewChars: result.contextBudgetPreviewChars,
        })),
      })),
    }
  }

  /** 仅接收 Planner 已完整重估并通过预算的单调收缩结果。 */
  commitPlan(input: ModelContextPlanCommit): void {
    this.initialHistory.splice(0, input.excludedOldestHistoryCount)

    for (const observation of input.observations) {
      const result = this.toolExchanges[observation.exchangeIndex]
        ?.results[observation.resultIndex]

      if (!result)
        throw new RangeError('Sampling Context Plan 包含未知 Tool Exchange')

      result.toolResult.content = observation.content
      result.contextBudgetPreviewChars = observation.contextBudgetPreviewChars
    }
  }

  /**
   * 将一轮 sampling 已处理完的全部 Tool Call 与各自的 Tool Result 成组追加到
   * 当前 Run 的内存 ModelContext，供下一轮 Sampling 继续读取。
   *
   * @description 这是核心模型输入，不是用户可见 Message，也不会在此函数中
   * 写入数据库。`callId` 保证 Provider 能把每个调用与结果配对。
   */
  appendToolExchange(input: {
    // 上一轮模型产生的全部工具名与 callId，按 index 顺序。原始参数刻意不收：
    // 回喂的只能是 results 里的续轮表示，与 tool Step 落库的是同一个字符串。
    calls: Array<Pick<UnvalidatedToolCallEnvelope, 'callId' | 'toolName'>>
    // 模型在本轮产生的可选文本，存在时作为 assistant content 续传。
    intermediateText: string
    // DeepSeek thinking Tool Call 要求下一轮原样续传的 reasoning continuation，不是 UI 消息。
    reasoningContent: string
    // 与 calls 一一对应：后端工具结果经长度上限处理后的模型可见文本，以及执行是否成功；
    // 失败结果也要回填模型，让它决定后续行为。
    results: Array<{
      observation: NormalizedToolObservation
      ok: boolean
      /** 回喂给模型的参数 JSON，由调用方经 toFeedbackArgumentsJson 得出；tool Step 落库的是同一个字符串。 */
      feedbackArgumentsJson: string
    }>
  }): void {
    if (input.calls.length === 0 || input.calls.length !== input.results.length)
      throw new RangeError('Tool Exchange 的 calls 与 results 必须一一对应且非空')

    this.toolExchanges.push({
      // 同时作为数组位置，供 commitPlan() 定位并同步缩短后的 Tool Result。
      exchangeIndex: this.toolExchanges.length,
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
      results: input.calls.map((call, index) => {
        const result = input.results[index]!

        return {
          // Provider 视角的 Tool Result：通过同一 callId 与 assistant 消息里的 call 严格配对。
          toolResult: {
            type: 'tool_result',
            callId: call.callId,
            name: call.toolName,
            content: result.observation.content,
            ok: result.ok,
          },
          // 保留规范化后的来源文本与长度统计，供 Context Planner 必要时生成更短预览。
          observation: { ...result.observation },
          // null 表示尚未因 Context Budget 进行第二次缩短。
          contextBudgetPreviewChars: null,
        }
      }),
    })
  }
}

/**
 * 将 Planner 按来源分开维护的 Context 状态，按 Provider 需要的先后顺序
 * 摊平成一个 `ModelInputItem[]`。
 *
 * @description 输出顺序固定为 instructions -> initialHistory -> currentUser
 * -> 每组 assistant Tool Call 消息 / 逐个 Tool Result。本函数只复制和组装模型可见输入，
 * 不修改 `state`、不计算 Token，也不包含只用于统计的字段
 * `initialHistoryCandidateCount`。工具定义由调用方单独传给 TokenEstimator / Provider。
 */
export function flattenPlanningState(
  state: ModelContextPlanningState,
): ModelInputItem[] {
  return [
    ...state.instructions.map(cloneMessage),
    ...state.initialHistory.map(cloneMessage),
    cloneMessage(state.currentUser),
    ...state.toolExchanges.flatMap(exchange => [
      cloneAssistantCall(exchange.assistantCall),
      ...exchange.results.map(result => ({ ...result.toolResult })),
    ]),
  ]
}

/**
 * 续轮表示里的 arguments。
 *
 * 通过工具输入契约校验的参数是键与值都在 DeepSeek estimator 已验证子集内的 JSON 对象，
 * 原样续传。未校验的原始参数（unknown_tool / invalid_arguments / truncated_arguments）
 * 可能是任意文本或非对象 JSON，统一用 DeepSeek 官方编码器对不可解析参数的回退形状
 * `{"arguments": raw}` 承载：原文一字不改保留在值里，wire 上是合法 JSON 对象，
 * Context Planner 估算的和实际发给 Provider 的是同一份表示。Runtime 每个 call 只调用一次，
 * 同一个字符串既进 appendToolExchange，也落 tool_execution Step 的 `input.arguments`。
 */
export function toFeedbackArgumentsJson(
  rawArgumentsJson: string,
  argumentsValidated: boolean,
): string {
  return argumentsValidated
    ? rawArgumentsJson
    : JSON.stringify({ arguments: rawArgumentsJson })
}

function cloneMessage(item: MessageInputItem): MessageInputItem {
  return { ...item }
}

function cloneAssistantCall(
  item: AssistantToolCallInputItem,
): AssistantToolCallInputItem {
  return { ...item, calls: item.calls.map(call => ({ ...call })) }
}
