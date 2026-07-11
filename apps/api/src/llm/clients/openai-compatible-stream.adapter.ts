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
        yield {
          type: 'text_delta',
          delta: contentDelta,
        }
      }

      for (const toolCallDelta of choice.delta.tool_calls ?? []) {
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
          yield {
            type: 'tool_call_completed',
            toolCall,
          }
        }
      }
    }

    if (chunk.usage) {
      yield {
        type: 'usage',
        usage: toModelUsage(chunk.usage),
      }
    }
  }

  if (!finishReason) {
    throw new LLMApiError('模型流在没有 finish reason 的情况下结束')
  }

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
