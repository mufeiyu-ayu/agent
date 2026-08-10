import type { ChatMessage } from '../llm/llm.types.js'
import type { ModelInputItem } from '../llm/model-input.types.js'
import type { UnvalidatedToolCallEnvelope } from '../tools/core/tool.types.js'

import { toModelInputItems } from '../llm/model-input.types.js'

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
}

/** 单次 Run 内的 model-visible context；不负责选择、预算或生命周期。 */
export class ModelContext {
  private constructor(private readonly items: ModelInputItem[]) {}

  static fromHistory(
    historyMessages: ChatMessage[],
    buildModelMessages: (historyMessages: ChatMessage[]) => ChatMessage[],
  ): ModelContext {
    return new ModelContext(
      toModelInputItems(buildModelMessages(historyMessages)),
    )
  }

  forSampling(): ModelInputItem[] {
    return this.items
  }

  appendToolExchange(input: {
    call: UnvalidatedToolCallEnvelope
    intermediateText: string
    reasoningContent: string
    observationContent: string
    ok: boolean
  }): void {
    this.items.push(
      {
        type: 'assistant_tool_call',
        callId: input.call.callId,
        name: input.call.toolName,
        rawArgumentsJson: input.call.rawArgumentsJson,
        reasoningContent: input.reasoningContent,
        ...(input.intermediateText ? { content: input.intermediateText } : {}),
      },
      {
        type: 'tool_result',
        callId: input.call.callId,
        name: input.call.toolName,
        content: input.observationContent,
        ok: input.ok,
      },
    )
  }

  snapshot(samplingIndex: number): ModelContextSnapshot {
    const items = this.items.map(toSnapshotItem)
    const toolExchangeCount = items.filter(
      item => item.category === 'assistant_tool_call',
    ).length

    return {
      samplingIndex,
      itemCount: items.length,
      characterCount: items.reduce(
        (total, item) => total + item.characterCount,
        0,
      ),
      hasToolExchange: toolExchangeCount > 0,
      toolExchangeCount,
      items,
    }
  }
}

function toSnapshotItem(item: ModelInputItem): ModelContextSnapshotItem {
  switch (item.type) {
    case 'message':
      return {
        source: item.role === 'system' ? 'instructions' : 'conversation',
        category: `${item.role}_message`,
        characterCount: countCharacters(item.content),
      }

    case 'assistant_tool_call':
      return {
        source: 'tool_exchange',
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
        source: 'tool_exchange',
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
