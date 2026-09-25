import type { ChatCompletionChunk } from 'openai/resources/chat/completions'
import type {
  ModelFinishReason,
  ModelStreamEvent,
  ModelUsage,
} from '../types.js'

import { LLMApiError } from '../errors.js'
import { OpenAICompatibleToolCallAccumulator, ToolCallSlots } from './openai-completions-tool-calls.js'

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
  /** compat 同名字段：tool_calls 分片可以不带 index，每片是一个完整调用，按 `ToolCallSlots` 取槽位。缺省严格，缺 index 即报错。 */
  toolCallIndexOptional?: boolean
  /** compat 同名字段：带 Tool Call 的 stop 归一成 tool_calls。缺省严格，带 Tool Call 的 stop 即报错。 */
  toolCallsMayFinishWithStop?: boolean
}

/** 将 OpenAI-compatible SDK chunk 转换为项目内部模型事件。 */
export async function* adaptOpenAICompatibleStream(
  chunks: AsyncIterable<ChatCompletionChunk>,
  options: AdaptStreamOptions,
): AsyncGenerator<ModelStreamEvent> {
  const toolCallAccumulator = new OpenAICompatibleToolCallAccumulator()
  const toolCallSlots = new ToolCallSlots()
  const reasoningContentChunks: string[] = []
  let hasStartedReasoning = false
  let hasStartedToolCall = false
  let finishReason: ModelFinishReason | undefined

  for await (const chunk of chunks) {
    // 各家真实流都带 choices 数组（只带 usage 的末尾 chunk 是空数组，个别中转站连空数组也省掉）；
    // 两者都没有就是上游返回了别的东西（裸 error 对象、null），按协议异常报，不让它变成 TypeError。
    if (typeof chunk !== 'object' || chunk === null || (!Array.isArray(chunk.choices) && !chunk.usage))
      throw new LLMApiError('模型流返回了没有 choices 的数据块')

    const choice = chunk.choices?.[0]

    if (choice) {
      if (finishReason) {
        throw new LLMApiError('模型在 finish reason 之后仍返回了 choice 数据')
      }

      // 个别端点在只带 finish_reason 的末尾 choice 里省掉 delta。
      const providerDelta = (choice.delta ?? {}) as DeepSeekChatCompletionDelta
      const reasoningContentDelta = providerDelta.reasoning_content
      const contentDelta = providerDelta.content

      // 处理思考模型的 reasoning_content：只要有 reasoning_content，就算是思考模型，首个 reasoning_content 到达时发 reasoning_started 事件。
      if (reasoningContentDelta) {
        reasoningContentChunks.push(reasoningContentDelta)

        if (!hasStartedReasoning) {
          hasStartedReasoning = true
          yield { type: 'reasoning_started' }
        }
      }

      const toolCallDeltas = providerDelta.tool_calls ?? []

      // 拼接 toolcall 碎片
      for (const toolCallDelta of toolCallDeltas) {
        // SDK 类型把 index 标为必填，Google 官方端点的分片却不带它，且每个分片就是一个完整调用；null 同样按缺失处理。
        const index = options.toolCallIndexOptional
          ? toolCallSlots.slotOf(toolCallDelta.index)
          : toolCallDelta.index

        // 工具名和 arguments 可能分多个 chunk 返回，这里只负责持续拼接碎片。
        toolCallAccumulator.append({
          index,
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

      // 模型输出文本：每片原样作为 text_delta 发出，不在这里拼接。
      if (contentDelta) {
        // 同一 chunk 已先标记 Tool Call，避免把随后的 assistant content 当成最终回答。
        yield {
          type: 'text_delta',
          delta: contentDelta,
        }
      }

      // 模型生成结束（流后面可能还有 usage 块）：先记下原因，结束事件等流读完再发。
      if (choice.finish_reason) {
        // finish reason 只表示本轮模型生成结束；若为 tool_calls，工具此时尚未执行。
        // 归一后取值与上层（streamModelSampling）的处理：
        // - stop：话说完且没调工具，判 final_answer
        // - tool_calls：调用请求已生成完，判 tool_call
        // - length：撞到 max_tokens；有调用就判 tool_call 按截断回喂，没有就抛错
        // - content_filter：被服务商内容审核截断，抛错
        // - unknown：其余原始值（如 DeepSeek 的 insufficient_system_resource），抛错
        finishReason = normalizeFinishReason(choice.finish_reason)

        const toolCalls = toolCallAccumulator.finalize(finishReason === 'length')
        const reasoningContent = reasoningContentChunks.join('')

        // Runtime 只按 finish reason 分派：带 Tool Call 的 stop 不归一，调用就会被当成最终回答丢掉。
        if (finishReason === 'stop' && toolCalls.length > 0 && options.toolCallsMayFinishWithStop) {
          finishReason = 'tool_calls'
        }

        if (finishReason === 'tool_calls' && toolCalls.length === 0) {
          throw new LLMApiError('模型以 tool_calls 结束，但没有返回完整 Tool Call')
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
 *
 * reasoning 按 Pi 口径算作 output 的子集：grok 的 `completion_tokens` 不含推理 Token，
 * 只有 `total_tokens` 能证明这一点（= prompt + completion + reasoning 且 ≠ prompt + completion），
 * 此时 `outputTokens` 归一为 completion + reasoning；其余家族原样保留。
 */
function toModelUsage(
  usage: CompatCompletionUsage,
): ModelUsage {
  // 兼容端点不受 SDK 类型约束：不是有限数的值（字符串、null 等）一律当作缺失，继续往下兜底。
  const promptCacheHitTokens = [
    usage.prompt_tokens_details?.cached_tokens,
    usage.prompt_cache_hit_tokens,
    usage.cached_tokens,
  ].find(isFiniteNumber)
  const promptCacheMissTokens = (isFiniteNumber(usage.prompt_cache_miss_tokens) ? usage.prompt_cache_miss_tokens : undefined)
    ?? (promptCacheHitTokens !== undefined && usage.prompt_tokens >= promptCacheHitTokens
      ? usage.prompt_tokens - promptCacheHitTokens
      : undefined)
  const reasoningTokens = usage.completion_tokens_details?.reasoning_tokens
  const reasoningOutsideCompletion = typeof reasoningTokens === 'number'
    && usage.total_tokens === usage.prompt_tokens + usage.completion_tokens + reasoningTokens
    && usage.total_tokens !== usage.prompt_tokens + usage.completion_tokens

  return {
    inputTokens: usage.prompt_tokens,
    outputTokens: reasoningOutsideCompletion
      ? usage.completion_tokens + reasoningTokens
      : usage.completion_tokens,
    totalTokens: usage.total_tokens,
    ...(typeof reasoningTokens === 'number' ? { reasoningTokens } : {}),
    ...(promptCacheHitTokens === undefined ? {} : { promptCacheHitTokens }),
    ...(promptCacheMissTokens === undefined ? {} : { promptCacheMissTokens }),
  }
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}
