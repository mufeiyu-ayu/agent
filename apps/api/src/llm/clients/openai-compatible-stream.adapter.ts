import type { ChatCompletionChunk } from 'openai/resources/chat/completions'
import type {
  ModelFinishReason,
  ModelStreamEvent,
  ModelUsage,
} from '../model-stream.types.js'

import { LLMApiError } from '../llm.errors.js'
import { OpenAICompatibleToolCallAccumulator } from './openai-compatible-tool-call-accumulator.js'

/** 将 OpenAI-compatible SDK chunk 转换为项目内部模型事件。 */
export async function* adaptOpenAICompatibleStream(
  chunks: AsyncIterable<ChatCompletionChunk>,
): AsyncGenerator<ModelStreamEvent> {
  const toolCallAccumulator = new OpenAICompatibleToolCallAccumulator()
  let finishReason: ModelFinishReason | undefined

  for await (const chunk of chunks) {
    const choice = chunk.choices[0]

    if (choice) {
      if (finishReason) {
        throw new LLMApiError('模型在 finish reason 之后仍返回了 choice 数据')
      }

      const contentDelta = choice.delta.content

      if (contentDelta) {
        // 普通回答按文本碎片转换，上层会继续把这些 delta 实时发送给前端。
        yield {
          type: 'text_delta',
          delta: contentDelta,
        }
      }

      for (const toolCallDelta of choice.delta.tool_calls ?? []) {
        // 工具名和 arguments 可能分多个 chunk 返回，这里只负责持续拼接碎片。
        toolCallAccumulator.append({
          index: toolCallDelta.index,
          ...(toolCallDelta.id
            ? { providerCallIdDelta: toolCallDelta.id }
            : {}),
          ...(toolCallDelta.function?.name
            ? { nameDelta: toolCallDelta.function.name }
            : {}),
          ...(toolCallDelta.function?.arguments
            ? { argumentsJsonDelta: toolCallDelta.function.arguments }
            : {}),
        })
      }

      if (choice.finish_reason) {
        // finish reason 只表示本轮模型生成结束；若为 tool_calls，工具此时尚未执行。
        finishReason = normalizeFinishReason(choice.finish_reason)
        const toolCalls = toolCallAccumulator.finalize()

        if (finishReason === 'tool_calls' && toolCalls.length === 0) {
          throw new LLMApiError('模型以 tool_calls 结束，但没有返回完整 Tool Call')
        }
        if (finishReason !== 'tool_calls' && toolCalls.length > 0) {
          throw new LLMApiError(
            `模型返回了 Tool Call，但 finish reason 为 ${finishReason}`,
          )
        }

        for (const toolCall of toolCalls) {
          // 输出的是已拼接完成的 Tool Call 请求，后端将在上层校验并执行它。
          yield {
            type: 'tool_call_completed',
            toolCall,
          }
        }
      }
    }

    if (chunk.usage) {
      // Usage 可能在结束 choice 之后单独返回，只用于记录本轮 Token 消耗。
      yield {
        type: 'usage',
        usage: toModelUsage(chunk.usage),
      }
    }
  }

  if (!finishReason) {
    throw new LLMApiError('模型流在没有 finish reason 的情况下结束')
  }

  // 原始模型流结束后发出统一完成事件；tool_calls 表示工具调用请求已生成完毕，并非工具已执行。
  yield {
    type: 'response_completed',
    finishReason,
  }
}

function normalizeFinishReason(finishReason: string): ModelFinishReason {
  switch (finishReason) {
    case 'stop':
    case 'tool_calls':
    case 'length':
    case 'content_filter':
      return finishReason
    default:
      return 'unknown'
  }
}

function toModelUsage(
  usage: NonNullable<ChatCompletionChunk['usage']>,
): ModelUsage {
  return {
    inputTokens: usage.prompt_tokens,
    outputTokens: usage.completion_tokens,
    totalTokens: usage.total_tokens,
  }
}
