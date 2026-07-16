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
  }
  | {
    type: 'tool_call'
    call: UnvalidatedToolCallEnvelope
    intermediateText: string
  }

/** 实时转发最终回答文本，并只接受完整最终回答或单个完整 Tool Call。 */
export async function* streamModelSampling(
  events: AsyncIterable<ModelStreamEvent>,
  samplingAttemptId: string,
): AsyncGenerator<string, SamplingDecision> {
  const intermediateTextChunks: string[] = []
  const toolCalls: UnvalidatedModelToolCall[] = []
  let outputMode: 'final_answer' | 'tool_call' | undefined
  let finishReason: ModelFinishReason | undefined

  for await (const event of events) {
    if (finishReason) {
      throw new ModelSamplingIncompleteError(
        '模型在 response_completed 之后仍返回了额外事件。',
      )
    }

    switch (event.type) {
      case 'text_delta':
        if (!outputMode)
          outputMode = 'final_answer'

        if (outputMode === 'final_answer') {
          // ponytail: 已发送的前端 delta 无法撤回；工具调用必须先于文本出现，否则本轮失败。
          yield event.delta
        }
        else {
          intermediateTextChunks.push(event.delta)
        }
        break

      case 'tool_call_completed':
        if (outputMode === 'final_answer') {
          throw new ModelSamplingIncompleteError(
            '模型在最终回答文本之后又返回了 Tool Call，当前流协议无法安全执行该调用。',
          )
        }

        outputMode = 'tool_call'
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
      intermediateText: intermediateTextChunks.join(''),
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
