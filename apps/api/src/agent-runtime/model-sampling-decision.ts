import type {
  ModelFinishReason,
  ModelStreamEvent,
  ModelUsage,
  UnvalidatedModelToolCall,
} from '../llm/model-stream.types.js'
import type { UnvalidatedToolCallEnvelope } from '../tools/core/tool.types.js'

import { mergeModelUsage } from '../llm/model-stream.types.js'
import { ModelSamplingIncompleteError } from './agent-runtime.errors.js'

export interface ModelSamplingSummary {
  samplingAttemptId: string
  finishReason: ModelFinishReason | null
  usage: ModelUsage | null
  toolCallCount: number
  textChars: number
  intermediateTextChars: number
}

export type SamplingDecision
  = | {
    type: 'final_answer'
    summary: ModelSamplingSummary
  }
  | {
    type: 'tool_call'
    call: UnvalidatedToolCallEnvelope
    intermediateText: string
    reasoningContent: string
    summary: ModelSamplingSummary
  }

/**
 * 函数职责：实时转发最终回答文本，并只接受完整最终回答或单个完整 Tool Call。
 *
 * 执行方式：每轮模型请求只调用一次本函数；内部循环消费多个模型事件，文本通过 yield 分段返回，模型流结束后再通过 return 返回最终决策。
 */
export async function* streamModelSampling(
  events: AsyncIterable<ModelStreamEvent>,
  samplingAttemptId: string,
): AsyncGenerator<string, SamplingDecision> {
  const intermediateTextChunks: string[] = []
  const toolCalls: Array<{
    toolCall: UnvalidatedModelToolCall
    reasoningContent: string
  }> = []
  let outputMode: 'final_answer' | 'tool_call' | undefined
  let finishReason: ModelFinishReason | undefined
  let usage: ModelUsage | null = null
  let textChars = 0
  let intermediateTextChars = 0

  const buildSummary = (): ModelSamplingSummary => ({
    samplingAttemptId,
    finishReason: finishReason ?? null,
    usage,
    toolCallCount: toolCalls.length,
    textChars,
    intermediateTextChars,
  })
  const incomplete = (message: string): ModelSamplingIncompleteError =>
    new ModelSamplingIncompleteError(message, buildSummary())

  try {
    for await (const event of events) {
      if (finishReason) {
        throw incomplete(
          '模型在 response_completed 之后仍返回了额外事件。',
        )
      }

      switch (event.type) {
        case 'text_delta':
          textChars += event.delta.length

          if (!outputMode)
            outputMode = 'final_answer'

          if (outputMode === 'final_answer') {
            // ponytail: 已发送的前端 delta 无法撤回；工具调用必须先于文本出现，否则本轮失败。
            yield event.delta
          }
          else {
            intermediateTextChunks.push(event.delta)
            intermediateTextChars += event.delta.length
          }
          break

        case 'tool_call_started':
          if (outputMode === 'final_answer') {
            throw incomplete(
              '模型在最终回答文本之后又返回了 Tool Call，当前流协议无法安全执行该调用。',
            )
          }

          outputMode = 'tool_call'
          break

        case 'tool_call_completed':
          if (outputMode === 'final_answer') {
            throw incomplete(
              '模型在最终回答文本之后又返回了 Tool Call，当前流协议无法安全执行该调用。',
            )
          }

          outputMode = 'tool_call'
          toolCalls.push({
            toolCall: event.toolCall,
            reasoningContent: event.reasoningContent,
          })
          break

        case 'usage':
          usage = mergeModelUsage(usage, event.usage)
          break

        case 'response_completed':
          finishReason = event.finishReason
          break
      }
    }
  }
  catch (error) {
    if (error instanceof ModelSamplingIncompleteError)
      throw error

    throw incomplete('模型流读取失败，当前 sampling 未完整结束。')
  }

  if (!finishReason) {
    throw incomplete(
      '模型流缺少 response_completed，当前回答未被标记为成功。',
    )
  }

  if (finishReason === 'tool_calls') {
    if (toolCalls.length === 0) {
      throw incomplete(
        '模型以 tool_calls 结束，但没有返回完整 Tool Call。',
      )
    }
    if (toolCalls.length > 1) {
      throw incomplete(
        '当前只支持同轮一个 Tool Call，不支持并行工具调用。',
      )
    }
    if (!toolCalls[0]!.reasoningContent) {
      throw incomplete(
        'Tool Call 缺少必需的 thinking continuation。',
      )
    }

    return {
      type: 'tool_call',
      call: toToolCallEnvelope(toolCalls[0]!.toolCall, samplingAttemptId),
      intermediateText: intermediateTextChunks.join(''),
      reasoningContent: toolCalls[0]!.reasoningContent,
      summary: buildSummary(),
    }
  }

  if (outputMode === 'tool_call') {
    throw incomplete(
      `模型返回了 Tool Call，但 finish reason 为 ${finishReason}。`,
    )
  }

  if (finishReason !== 'stop') {
    throw ModelSamplingIncompleteError.fromFinishReason(
      finishReason,
      buildSummary(),
    )
  }

  return {
    type: 'final_answer',
    summary: buildSummary(),
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
