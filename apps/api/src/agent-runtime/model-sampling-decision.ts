import type {
  ModelFinishReason,
  ModelStreamEvent,
  UnvalidatedModelToolCall,
} from '../llm/model-stream.types.js'
import type { UnvalidatedToolCallEnvelope } from '../tools/tool.types.js'

import { ModelSamplingIncompleteError } from './agent-runtime.errors.js'

export type SamplingDecision
  = | {
    type: 'final_answer'
    textChunks: string[]
  }
  | {
    type: 'tool_call'
    call: UnvalidatedToolCallEnvelope
    intermediateText: string
  }

export class ModelSamplingInterruptedError extends Error {
  constructor(
    readonly cause: unknown,
    readonly textChunks: string[],
    readonly hasToolCall: boolean,
  ) {
    super('模型 sampling 在完成前中断。', { cause })
    this.name = 'ModelSamplingInterruptedError'
  }
}

/** 收集一轮 sampling，并只接受完整最终回答或单个完整 Tool Call。 */
export async function collectModelSampling(
  events: AsyncIterable<ModelStreamEvent>,
  samplingAttemptId: string,
): Promise<SamplingDecision> {
  const textChunks: string[] = []
  const toolCalls: UnvalidatedModelToolCall[] = []
  let finishReason: ModelFinishReason | undefined

  try {
    for await (const event of events) {
      if (finishReason) {
        throw new ModelSamplingIncompleteError(
          '模型在 response_completed 之后仍返回了额外事件。',
        )
      }

      switch (event.type) {
        case 'text_delta':
          textChunks.push(event.delta)
          break

        case 'tool_call_completed':
          toolCalls.push(event.toolCall)
          break

        case 'usage':
          // Task 4 只做 Tool Loop；usage 持久化留给后续运行记录任务。
          break

        case 'response_completed':
          finishReason = event.finishReason
          break
      }
    }
  }
  catch (cause) {
    if (cause instanceof ModelSamplingIncompleteError)
      throw cause

    throw new ModelSamplingInterruptedError(
      cause,
      textChunks,
      toolCalls.length > 0,
    )
  }

  if (!finishReason) {
    throw new ModelSamplingIncompleteError(
      '模型流缺少 response_completed，当前回答未被标记为成功。',
    )
  }

  if (finishReason === 'tool_calls') {
    if (toolCalls.length === 0) {
      throw new ModelSamplingIncompleteError(
        '模型以 tool_calls 结束，但没有返回完整 Tool Call。',
      )
    }
    if (toolCalls.length > 1) {
      throw new ModelSamplingIncompleteError(
        '当前只支持同轮一个 Tool Call，不支持并行工具调用。',
      )
    }

    return {
      type: 'tool_call',
      call: toToolCallEnvelope(toolCalls[0]!, samplingAttemptId),
      intermediateText: textChunks.join(''),
    }
  }

  if (toolCalls.length > 0) {
    throw new ModelSamplingIncompleteError(
      `模型返回了 Tool Call，但 finish reason 为 ${finishReason}。`,
    )
  }

  if (finishReason !== 'stop') {
    throw ModelSamplingIncompleteError.fromFinishReason(finishReason)
  }

  return {
    type: 'final_answer',
    textChunks,
  }
}

function toToolCallEnvelope(
  toolCall: UnvalidatedModelToolCall,
  samplingAttemptId: string,
): UnvalidatedToolCallEnvelope {
  return {
    callId: toolCall.providerCallId,
    toolName: toolCall.name,
    rawArgumentsJson: toolCall.argumentsJson,
    samplingAttemptId,
  }
}
