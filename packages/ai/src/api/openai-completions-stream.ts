import type { ChatCompletionChunk } from 'openai/resources/chat/completions'
import type {
  ModelFinishReason,
  ModelStreamEvent,
  ModelUsage,
} from '../types.js'

import { LLMApiError } from '../errors.js'
import { OpenAICompatibleToolCallAccumulator } from './openai-completions-tool-calls.js'

type DeepSeekChatCompletionDelta = ChatCompletionChunk.Choice.Delta & {
  reasoning_content?: string | null
}

/**
 * usage 的三种缓存写法（对照 Pi `parseChunkUsage`）：OpenAI 形状 `prompt_tokens_details.cached_tokens`
 * （中转站上的 gpt / grok / 经中转的 DeepSeek）、DeepSeek 直连的顶层 `prompt_cache_hit_tokens` /
 * `prompt_cache_miss_tokens`、以及部分兼容端点的顶层 `cached_tokens`。
 */
type CompatCompletionUsage = NonNullable<ChatCompletionChunk['usage']> & {
  prompt_cache_hit_tokens?: number | null
  prompt_cache_miss_tokens?: number | null
  cached_tokens?: number | null
  prompt_tokens_details?: {
    cached_tokens?: number | null
  } | null
  completion_tokens_details?: {
    reasoning_tokens?: number | null
  } | null
}

export interface AdaptStreamOptions {
  /**
   * reasoning 模型（DeepSeek thinking）的 Tool Call 必须带 reasoning_content 才能回填续轮；
   * 中转站后面的 gpt / gemini / claude 从不返回它，按模型关掉这条不变量。
   */
  requireReasoningContent: boolean
}

/** 将 OpenAI-compatible SDK chunk 转换为项目内部模型事件。 */
export async function* adaptOpenAICompatibleStream(
  chunks: AsyncIterable<ChatCompletionChunk>,
  options: AdaptStreamOptions,
): AsyncGenerator<ModelStreamEvent> {
  const toolCallAccumulator = new OpenAICompatibleToolCallAccumulator()
  const reasoningContentChunks: string[] = []
  let hasStartedToolCall = false
  let finishReason: ModelFinishReason | undefined

  for await (const chunk of chunks) {
    const choice = chunk.choices[0]

    if (choice) {
      if (finishReason) {
        throw new LLMApiError('模型在 finish reason 之后仍返回了 choice 数据')
      }

      const providerDelta = choice.delta as DeepSeekChatCompletionDelta
      const reasoningContentDelta = providerDelta.reasoning_content
      const contentDelta = providerDelta.content

      if (reasoningContentDelta) {
        reasoningContentChunks.push(reasoningContentDelta)
      }

      const toolCallDeltas = providerDelta.tool_calls ?? []

      for (const toolCallDelta of toolCallDeltas) {
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

      if (!hasStartedToolCall && toolCallDeltas.length > 0) {
        hasStartedToolCall = true
        yield { type: 'tool_call_started' }
      }

      if (contentDelta) {
        // 同一 chunk 已先标记 Tool Call，避免把随后的 assistant content 当成最终回答。
        yield {
          type: 'text_delta',
          delta: contentDelta,
        }
      }

      if (choice.finish_reason) {
        // finish reason 只表示本轮模型生成结束；若为 tool_calls，工具此时尚未执行。
        finishReason = normalizeFinishReason(choice.finish_reason)
        // 例如得到：
        // [{
        //   providerCallId: 'call_123',
        //   name: 'search_articles',
        //   argumentsJson: '{"query":"SP Himeko","limit":5}',
        //   index: 0,
        // }]
        // length：arguments 可能被截断，放行有 id 与 name 的调用，交给上层按截断回喂。
        const toolCalls = toolCallAccumulator.finalize(finishReason === 'length')
        const reasoningContent = reasoningContentChunks.join('')

        if (finishReason === 'tool_calls' && toolCalls.length === 0) {
          throw new LLMApiError('模型以 tool_calls 结束，但没有返回完整 Tool Call')
        }
        // reasoning 模型下，任何会回填成 assistant tool_calls 消息的调用（含 length 截断）都需要 reasoning continuation。
        if (
          options.requireReasoningContent
          && toolCalls.length > 0
          && reasoningContent.length === 0
        ) {
          throw new LLMApiError(
            'DeepSeek thinking Tool Call 缺少必需的 reasoning_content continuation',
          )
        }
        if (
          finishReason !== 'tool_calls'
          && finishReason !== 'length'
          && toolCalls.length > 0
        ) {
          throw new LLMApiError(
            `模型返回了 Tool Call，但 finish reason 为 ${finishReason}`,
          )
        }

        for (const toolCall of toolCalls) {
          // 输出的是已拼接完成的 Tool Call 请求，后端将在上层校验并执行它。
          yield {
            type: 'tool_call_completed',
            toolCall,
            reasoningContent,
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

/**
 * 缓存命中数按三种写法兜底取值；未命中数只有 DeepSeek 直连会报，其他家族在有命中数时用
 * `prompt_tokens − 命中数` 推出。`inputTokens` 保持原始 `prompt_tokens`，不像 Pi 那样扣掉缓存，
 * Admin 投影与概览口径不变；哪个字段都没有时保持 undefined，不补零。
 */
function toModelUsage(
  usage: CompatCompletionUsage,
): ModelUsage {
  const promptCacheHitTokens = usage.prompt_tokens_details?.cached_tokens
    ?? usage.prompt_cache_hit_tokens
    ?? usage.cached_tokens
    ?? undefined
  const promptCacheMissTokens = usage.prompt_cache_miss_tokens
    ?? (promptCacheHitTokens !== undefined && usage.prompt_tokens >= promptCacheHitTokens
      ? usage.prompt_tokens - promptCacheHitTokens
      : undefined)

  return {
    inputTokens: usage.prompt_tokens,
    outputTokens: usage.completion_tokens,
    totalTokens: usage.total_tokens,
    ...(typeof usage.completion_tokens_details?.reasoning_tokens === 'number'
      ? { reasoningTokens: usage.completion_tokens_details.reasoning_tokens }
      : {}),
    ...(promptCacheHitTokens === undefined ? {} : { promptCacheHitTokens }),
    ...(promptCacheMissTokens === undefined ? {} : { promptCacheMissTokens }),
  }
}
