import type { ChatMessage } from '../../llm/llm.types.js'
import type { ModelInputItem } from '../../llm/model-input.types.js'
import type { NormalizedToolObservation } from '../../tools/core/tool-observation.js'
import type { UnvalidatedToolCallEnvelope } from '../../tools/core/tool.types.js'
import type { InitialContextSelectionSummary } from './initial-context-selection.js'

type MessageInputItem = Extract<ModelInputItem, { type: 'message' }>
type AssistantToolCallInputItem = Extract<
  ModelInputItem,
  { type: 'assistant_tool_call' }
>
type ToolResultInputItem = Extract<ModelInputItem, { type: 'tool_result' }>

export interface ModelContextSnapshotItem {
  source: 'conversation' | 'instructions' | 'tool_exchange'
  category:
    | 'assistant_message'
    | 'assistant_tool_call'
    | 'system_message'
    | 'tool_result'
    | 'user_message'
  characterCount: number
}

export interface ModelContextSnapshot {
  samplingIndex: number
  itemCount: number
  characterCount: number
  hasToolExchange: boolean
  toolExchangeCount: number
  items: ModelContextSnapshotItem[]
  initialSelection?: InitialContextSelectionSummary
}

export interface ModelContextToolExchange {
  exchangeIndex: number
  assistantCall: AssistantToolCallInputItem
  toolResult: ToolResultInputItem
  observation: NormalizedToolObservation
  contextBudgetPreviewChars: number | null
}

/** Sampling Planner 使用的显式 source identity，不依赖 role 或数组位置反推。 */
export interface ModelContextPlanningState {
  instructions: MessageInputItem[]
  initialHistory: MessageInputItem[]
  // 纯后台观测：作为原始候选基准，用于统计最终有多少条历史未纳入。
  // 不参与 Token 估算、历史删减决策或模型输入组装。
  initialHistoryCandidateCount: number
  currentUser: MessageInputItem
  toolExchanges: ModelContextToolExchange[]
}

export interface ModelContextPlanCommit {
  excludedOldestHistoryCount: number
  observations: Array<{
    exchangeIndex: number
    content: string
    contextBudgetPreviewChars: number | null
  }>
}

interface CreateModelContextInput {
  instructions: ChatMessage[]
  initialHistory: ChatMessage[]
  currentUserMessage: ChatMessage
  initialSelection?: InitialContextSelectionSummary
}

/** 单次 Run 内的 source-aware model-visible context；预算选择由 Sampling Planner 负责。 */
export class ModelContext {
  private readonly toolExchanges: ModelContextToolExchange[] = []

  private constructor(
    // 核心输入：模型必须携带的指令消息；当前 SEO 入口中就是系统提示词。
    private readonly instructions: MessageInputItem[],
    // 核心输入：Initial Context Selection 实际选中的历史消息；后续超预算时可删减。
    private readonly initialHistory: MessageInputItem[],
    // 纯后台观测：保存当初从数据库检查的候选总数，用它减去当前
    // initialHistory.length，只为了展示最终有多少条历史未纳入模型上下文。
    // 它不参与 Token 计算、历史删减决策或真正的模型输入。
    private readonly initialHistoryCandidateCount: number,
    // 核心输入：触发本次 Run 的当前用户消息，始终必须保留。
    private readonly currentUser: MessageInputItem,
    // 纯后台观测：初始历史选择快照，供 Sampling Step / Admin 展示；
    // 不参与模型输入组装或预算决策。
    private readonly initialSelection?: InitialContextSelectionSummary,
  ) {}

  static fromHistory(input: CreateModelContextInput): ModelContext {
    // 将 select() 返回的 ChatMessage 转成 Runtime 内部统一的 message item。
    const initialHistory = toMessageInputItems(input.initialHistory)

    return new ModelContext(
      toMessageInputItems(input.instructions),
      initialHistory,
      // 这一行只选择后台统计的「原始候选基准」，不会改变 initialHistory。
      // 有快照时使用真实候选总数；没有时用已选长度兜底，表示无法确认更早的排除量。
      input.initialSelection?.historyCandidateCount ?? initialHistory.length,
      toMessageInputItem(input.currentUserMessage),
      input.initialSelection,
    )
  }

  forSampling(): ModelInputItem[] {
    return flattenPlanningState(this.forPlanning())
  }

  forPlanning(): ModelContextPlanningState {
    return {
      instructions: this.instructions.map(cloneMessage),
      initialHistory: this.initialHistory.map(cloneMessage),
      initialHistoryCandidateCount: this.initialHistoryCandidateCount,
      currentUser: cloneMessage(this.currentUser),
      toolExchanges: this.toolExchanges.map(exchange => ({
        exchangeIndex: exchange.exchangeIndex,
        assistantCall: { ...exchange.assistantCall },
        toolResult: { ...exchange.toolResult },
        observation: { ...exchange.observation },
        contextBudgetPreviewChars: exchange.contextBudgetPreviewChars,
      })),
    }
  }

  /** 仅接收 Planner 已完整重估并通过预算的单调收缩结果。 */
  commitPlan(input: ModelContextPlanCommit): void {
    this.initialHistory.splice(0, input.excludedOldestHistoryCount)

    for (const observation of input.observations) {
      const exchange = this.toolExchanges[observation.exchangeIndex]

      if (!exchange)
        throw new RangeError('Sampling Context Plan 包含未知 Tool Exchange')

      exchange.toolResult.content = observation.content
      exchange.contextBudgetPreviewChars
        = observation.contextBudgetPreviewChars
    }
  }

  /**
   * 将一次已执行的 Tool Call 与它的 Tool Result 成对追加到当前 Run 的
   * 内存 ModelContext，供下一轮 Sampling 继续读取。
   *
   * @description 这是核心模型输入，不是用户可见 Message，也不会在此函数中
   * 写入数据库。`callId` 保证 Provider 能把调用与结果配对。
   */
  appendToolExchange(input: {
    // 上一轮模型产生的工具名、callId 与原始 JSON 参数。
    call: UnvalidatedToolCallEnvelope
    // 模型在 Tool Call 前产生的可选中间文本，存在时作为 assistant content 续传。
    intermediateText: string
    // DeepSeek thinking Tool Call 要求下一轮原样续传的 reasoning continuation，不是 UI 消息。
    reasoningContent: string
    // 后端工具结果经长度上限处理后的模型可见文本与原始字符统计。
    observation: NormalizedToolObservation
    // 工具执行是否成功；失败结果也要回填模型，让它决定后续行为。
    ok: boolean
  }): void {
    // Provider 视角的 assistant Tool Call：表示「模型刚才请求调用了什么」。
    const assistantCall: AssistantToolCallInputItem = {
      type: 'assistant_tool_call',
      callId: input.call.callId,
      name: input.call.toolName,
      rawArgumentsJson: input.call.rawArgumentsJson,
      reasoningContent: input.reasoningContent,
      ...(input.intermediateText ? { content: input.intermediateText } : {}),
    }
    // Provider 视角的 Tool Result：通过同一 callId 与 assistantCall 严格配对。
    const toolResult: ToolResultInputItem = {
      type: 'tool_result',
      callId: input.call.callId,
      name: input.call.toolName,
      content: input.observation.content,
      ok: input.ok,
    }

    this.toolExchanges.push({
      // 同时作为数组位置，供 commitPlan() 定位并同步缩短后的 Tool Result。
      exchangeIndex: this.toolExchanges.length,
      assistantCall,
      toolResult,
      // 保留规范化后的来源文本与长度统计，供 Context Planner 必要时生成更短预览。
      observation: { ...input.observation },
      // null 表示尚未因 Context Budget 进行第二次缩短。
      contextBudgetPreviewChars: null,
    })
  }

  snapshot(samplingIndex: number): ModelContextSnapshot {
    const state = this.forPlanning()
    const items = [
      ...state.instructions.map(item => toSnapshotItem(item, 'instructions')),
      ...state.initialHistory.map(item => toSnapshotItem(item, 'conversation')),
      toSnapshotItem(state.currentUser, 'conversation'),
      ...state.toolExchanges.flatMap(exchange => [
        toSnapshotItem(exchange.assistantCall, 'tool_exchange'),
        toSnapshotItem(exchange.toolResult, 'tool_exchange'),
      ]),
    ]

    return {
      samplingIndex,
      itemCount: items.length,
      characterCount: items.reduce(
        (total, item) => total + item.characterCount,
        0,
      ),
      hasToolExchange: state.toolExchanges.length > 0,
      toolExchangeCount: state.toolExchanges.length,
      items,
      ...(this.initialSelection
        ? { initialSelection: this.initialSelection }
        : {}),
    }
  }
}

/**
 * 将 Planner 按来源分开维护的 Context 状态，按 Provider 需要的先后顺序
 * 摊平成一个 `ModelInputItem[]`。
 *
 * @description 输出顺序固定为 instructions -> initialHistory -> currentUser
 * -> 每组 assistant Tool Call / Tool Result。本函数只复制和组装模型可见输入，
 * 不修改 `state`、不计算 Token，也不包含纯后台观测字段
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
      { ...exchange.assistantCall },
      { ...exchange.toolResult },
    ]),
  ]
}

function toMessageInputItems(messages: ChatMessage[]): MessageInputItem[] {
  return messages.map(toMessageInputItem)
}

function toMessageInputItem(message: ChatMessage): MessageInputItem {
  return {
    type: 'message',
    role: message.role,
    content: message.content,
  }
}

function cloneMessage(item: MessageInputItem): MessageInputItem {
  return { ...item }
}

function toSnapshotItem(
  item: ModelInputItem,
  source: ModelContextSnapshotItem['source'],
): ModelContextSnapshotItem {
  switch (item.type) {
    case 'message':
      return {
        source,
        category: `${item.role}_message`,
        characterCount: countCharacters(item.content),
      }

    case 'assistant_tool_call':
      return {
        source,
        category: 'assistant_tool_call',
        characterCount: countCharacters(
          item.callId,
          item.name,
          item.rawArgumentsJson,
          item.reasoningContent,
          item.content,
        ),
      }

    case 'tool_result':
      return {
        source,
        category: 'tool_result',
        characterCount: countCharacters(item.callId, item.content),
      }
  }
}

function countCharacters(...values: Array<string | undefined>): number {
  return values.reduce(
    (total, value) => total + (value ? [...value].length : 0),
    0,
  )
}
