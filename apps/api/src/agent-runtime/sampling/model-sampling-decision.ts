import type {
  ModelFinishReason,
  ModelStreamEvent,
  ModelUsage,
  UnvalidatedModelToolCall,
} from '@agent/ai'
import type { UnvalidatedToolCallEnvelope } from '../../tools/core/tool.types.js'
import { mergeModelUsage } from '@agent/ai'

import { ModelSamplingIncompleteError } from '../agent-runtime.errors.js'

export interface ModelSamplingSummary {
  samplingAttemptId: string
  finishReason: ModelFinishReason | null
  usage: ModelUsage | null
  toolCallCount: number
  textChars: number
  /**
   * 从发出请求到收到第一个生成事件（正文、reasoning_started 或 tool_call_started）的毫秒数；
   * 只有 usage / response_completed 的空正文结束为 null。包含 SDK 在首个响应头之前的重试与退避：
   * 429 / 5xx 后重试成功的这一轮会偏大。
   */
  firstTokenMs: number | null
}

export type SamplingDecision
  = | {
    type: 'final_answer'
    summary: ModelSamplingSummary
  }
  | {
    type: 'tool_call'
    /** 本轮全部 Tool Call，按模型给出的 index 顺序；finishReason 为 length 时参数可能被截断。 */
    calls: UnvalidatedToolCallEnvelope[]
    /** 本轮模型产出的全部文本，随 Tool Call 一起作为 assistant content 回填模型。 */
    intermediateText: string
    reasoningContent: string
    summary: ModelSamplingSummary
  }

/**
 * 函数职责：实时转发模型文本，并在流结束后只按 finishReason 分派本轮决策。
 *
 * 流协议不变量（finish 后无事件、tool_calls 必带完整 call 与 reasoning、非
 * tool_calls / length 不带 call、同批 call id 不重复）由 Provider adapter 负责，这里不重复校验。
 *
 * 执行方式：每轮模型请求只调用一次本函数；内部循环消费多个模型事件，文本通过 yield 分段返回，模型流结束后再通过 return 返回最终决策。
 */
export async function* streamModelSampling(
  events: AsyncIterable<ModelStreamEvent>,
  samplingAttemptId: string,
  now: () => number = Date.now,
): AsyncGenerator<string, SamplingDecision> {
  const textChunks: string[] = []
  const toolCalls: UnvalidatedModelToolCall[] = []
  let reasoningContent = ''
  let finishReason: ModelFinishReason | undefined
  let rawFinishReason: string | undefined
  let usage: ModelUsage | null = null
  let textChars = 0
  let firstTokenMs: number | null = null

  const buildSummary = (): ModelSamplingSummary => ({
    samplingAttemptId,
    finishReason: finishReason ?? null,
    usage,
    toolCallCount: toolCalls.length,
    textChars,
    firstTokenMs,
  })

  // events 是惰性的 async generator：下面 for await 第一次拉取时才真正发出模型请求。
  const requestedAt = now()

  try {
    for await (const event of events) {
      switch (event.type) {
        case 'text_delta':
          firstTokenMs ??= Math.max(0, now() - requestedAt)
          textChars += event.delta.length
          textChunks.push(event.delta)
          yield event.delta
          break

        case 'reasoning_started':
        case 'tool_call_started':
          firstTokenMs ??= Math.max(0, now() - requestedAt)
          break

        case 'tool_call_completed':
          firstTokenMs ??= Math.max(0, now() - requestedAt)
          toolCalls.push(event.toolCall)
          reasoningContent = event.reasoningContent
          break

        case 'usage':
          usage = mergeModelUsage(usage, event.usage)
          break

        case 'response_completed':
          finishReason = event.finishReason
          rawFinishReason = event.rawFinishReason
          break
      }
    }
  }
  catch (error) {
    throw new ModelSamplingIncompleteError(
      '模型流读取失败，当前 sampling 未完整结束。',
      buildSummary(),
      error,
    )
  }

  if (!finishReason) {
    throw new ModelSamplingIncompleteError(
      '模型流缺少 response_completed，当前回答未被标记为成功。',
      buildSummary(),
    )
  }

  // tool_calls 正常结束，或 length 截断但仍有可配对的调用：都交给 Runtime 逐个处理，
  // 后者由 Runtime 按截断参数记 Step 并回喂，不在这里让 Run 失败。
  if (finishReason === 'tool_calls' || (finishReason === 'length' && toolCalls.length > 0)) {
    return {
      type: 'tool_call',
      calls: toolCalls.map(toolCall => ({
        callId: toolCall.providerCallId,
        toolName: toolCall.name,
        rawArgumentsJson: toolCall.argumentsJson,
      })),
      // 调用工具前模型可能已经生成了部分文本，作为 intermediateText 回填模型。
      intermediateText: textChunks.join(''),
      // 模型在生成工具调用前可能已经生成了部分推理内容，作为 reasoningContent 回填模型。
      reasoningContent,
      summary: buildSummary(),
    }
  }

  if (finishReason !== 'stop') {
    throw ModelSamplingIncompleteError.fromFinishReason(
      finishReason,
      buildSummary(),
      rawFinishReason,
    )
  }

  return {
    type: 'final_answer',
    summary: buildSummary(),
  }
}
