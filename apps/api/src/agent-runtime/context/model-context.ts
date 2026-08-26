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
    private readonly instructions: MessageInputItem[],
    private readonly initialHistory: MessageInputItem[],
    private readonly initialHistoryCandidateCount: number,
    private readonly currentUser: MessageInputItem,
    private readonly initialSelection?: InitialContextSelectionSummary,
  ) {}

  static fromHistory(input: CreateModelContextInput): ModelContext {
    const initialHistory = toMessageInputItems(input.initialHistory)

    return new ModelContext(
      toMessageInputItems(input.instructions),
      initialHistory,
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

  appendToolExchange(input: {
    call: UnvalidatedToolCallEnvelope
    intermediateText: string
    reasoningContent: string
    observation: NormalizedToolObservation
    ok: boolean
  }): void {
    const assistantCall: AssistantToolCallInputItem = {
      type: 'assistant_tool_call',
      callId: input.call.callId,
      name: input.call.toolName,
      rawArgumentsJson: input.call.rawArgumentsJson,
      reasoningContent: input.reasoningContent,
      ...(input.intermediateText ? { content: input.intermediateText } : {}),
    }
    const toolResult: ToolResultInputItem = {
      type: 'tool_result',
      callId: input.call.callId,
      name: input.call.toolName,
      content: input.observation.content,
      ok: input.ok,
    }

    this.toolExchanges.push({
      exchangeIndex: this.toolExchanges.length,
      assistantCall,
      toolResult,
      observation: { ...input.observation },
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
