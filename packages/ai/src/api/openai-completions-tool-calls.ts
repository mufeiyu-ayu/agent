import type { UnvalidatedModelToolCall } from '../types.js'

import { LLMApiError } from '../errors.js'

export interface OpenAICompatibleToolCallFragment {
  index: number
  providerCallIdDelta?: string
  nameDelta?: string
  argumentsJsonDelta?: string
}

interface OpenAICompatibleToolCallBuffer {
  index: number
  providerCallId: string
  name: string
  argumentsJson: string
}

/** 按 Tool Call index 累积 OpenAI-compatible 流式分片。 */
export class OpenAICompatibleToolCallAccumulator {
  private readonly buffers = new Map<number, OpenAICompatibleToolCallBuffer>()

  append(fragment: OpenAICompatibleToolCallFragment): void {
    if (!Number.isInteger(fragment.index) || fragment.index < 0) {
      throw new LLMApiError(`模型返回了无效的 Tool Call index：${fragment.index}`)
    }

    const buffer = this.buffers.get(fragment.index) ?? {
      index: fragment.index,
      providerCallId: '',
      name: '',
      argumentsJson: '',
    }

    buffer.providerCallId += fragment.providerCallIdDelta ?? ''
    buffer.name += fragment.nameDelta ?? ''
    buffer.argumentsJson += fragment.argumentsJsonDelta ?? ''
    this.buffers.set(fragment.index, buffer)
  }

  /**
   * 组装全部分片。`truncated`（finish reason 为 length）时 arguments 允许为空或不完整，
   * 但无 provider call id 或无工具名的分片不构成完整调用身份、无法与 tool 消息配对，整条丢弃。
   * 同批不同 index 的最终 call id 重复视为 Provider 违规。
   */
  finalize(truncated = false): UnvalidatedModelToolCall[] {
    const toolCalls = [...this.buffers.values()]
      .sort((left, right) => left.index - right.index)
      .filter(buffer => !truncated || (buffer.providerCallId && buffer.name))
      .map(buffer => this.toCompletedToolCall(buffer, truncated))
    const seenCallIds = new Set<string>()

    for (const toolCall of toolCalls) {
      if (seenCallIds.has(toolCall.providerCallId)) {
        throw new LLMApiError(
          `模型同一轮返回了重复的 Tool Call id（index=${toolCall.index}）`,
        )
      }
      seenCallIds.add(toolCall.providerCallId)
    }

    return toolCalls
  }

  private toCompletedToolCall(
    buffer: OpenAICompatibleToolCallBuffer,
    truncated: boolean,
  ): UnvalidatedModelToolCall {
    if (!buffer.providerCallId) {
      throw new LLMApiError(`模型 Tool Call index=${buffer.index} 缺少 provider call id`)
    }
    if (!buffer.name) {
      throw new LLMApiError(`模型 Tool Call index=${buffer.index} 缺少工具名称`)
    }
    if (!buffer.argumentsJson && !truncated) {
      throw new LLMApiError(`模型 Tool Call index=${buffer.index} 缺少参数 JSON`)
    }

    return {
      providerCallId: buffer.providerCallId,
      name: buffer.name,
      argumentsJson: buffer.argumentsJson,
      index: buffer.index,
    }
  }
}
