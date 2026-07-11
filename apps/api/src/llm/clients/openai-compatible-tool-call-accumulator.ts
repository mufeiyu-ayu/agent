import type { UnvalidatedModelToolCall } from '../model-stream.types.js'

import { LLMApiError } from '../llm.errors.js'

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

  finalize(): UnvalidatedModelToolCall[] {
    return [...this.buffers.values()]
      .sort((left, right) => left.index - right.index)
      .map(buffer => this.toCompletedToolCall(buffer))
  }

  private toCompletedToolCall(
    buffer: OpenAICompatibleToolCallBuffer,
  ): UnvalidatedModelToolCall {
    if (!buffer.providerCallId) {
      throw new LLMApiError(`模型 Tool Call index=${buffer.index} 缺少 provider call id`)
    }
    if (!buffer.name) {
      throw new LLMApiError(`模型 Tool Call index=${buffer.index} 缺少工具名称`)
    }
    if (!buffer.argumentsJson) {
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
