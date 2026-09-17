import type { ChatCompletionChunk } from 'openai/resources/chat/completions'
import type {
  ModelRawResponseCapture,
  ModelResponseCaptureEvent,
} from '../llm.types.js'

interface RawToolCallSlot {
  id?: string
  type?: string
  function: {
    name: string
    arguments: string
  }
}

/**
 * debug 捕获用的透传聚合器：原样转发每个 chunk，同时把流式 delta 组装成
 * 一份非流式形态的原始响应 JSON，并在任意关闭路径提交一次捕获结果。
 *
 * 只做字段拼接，不做业务校验（校验属于 stream adapter 的职责）；
 * 捕获是旁路观测：回调失败不会改变原流的完成或异常语义。
 */
export async function* teeRawResponseCapture(
  chunks: AsyncIterable<ChatCompletionChunk>,
  onResponse: (capture: ModelRawResponseCapture) => void,
  onCaptureError?: () => void,
): AsyncGenerator<ChatCompletionChunk> {
  let id: string | undefined
  let model: string | undefined
  let created: number | undefined
  let finishReason: string | null = null
  let usage: ChatCompletionChunk['usage'] | undefined
  let receivedChunkCount = 0
  let sawChoice = false
  let sourceCompleted = false
  let committed = false
  let lastEvent: ModelResponseCaptureEvent | null = null
  let textChars = 0
  const contentChunks: string[] = []
  const reasoningContentChunks: string[] = []
  const toolCalls: RawToolCallSlot[] = []

  try {
    for await (const chunk of chunks) {
      receivedChunkCount += 1
      id ??= chunk.id
      model ??= chunk.model
      created ??= chunk.created

      const choice = chunk.choices[0]

      if (choice) {
        sawChoice = true
        const delta = choice.delta as ChatCompletionChunk.Choice.Delta & {
          reasoning_content?: string | null
        }

        if (delta.reasoning_content) {
          reasoningContentChunks.push(delta.reasoning_content)
          lastEvent = 'reasoning_delta'
        }

        for (const toolCallDelta of delta.tool_calls ?? []) {
          const slot = toolCalls[toolCallDelta.index]
            ?? (toolCalls[toolCallDelta.index] = { function: { name: '', arguments: '' } })

          if (toolCallDelta.id)
            slot.id = toolCallDelta.id
          if (toolCallDelta.type)
            slot.type = toolCallDelta.type
          if (toolCallDelta.function?.name)
            slot.function.name += toolCallDelta.function.name
          if (toolCallDelta.function?.arguments)
            slot.function.arguments += toolCallDelta.function.arguments
          lastEvent = 'tool_call_delta'
        }

        if (delta.content) {
          contentChunks.push(delta.content)
          textChars += delta.content.length
          lastEvent = 'text_delta'
        }

        if (choice.finish_reason) {
          finishReason = choice.finish_reason
          lastEvent = 'finish_reason'
        }
      }

      if (chunk.usage) {
        usage = chunk.usage
        lastEvent = 'usage'
      }

      yield chunk
    }

    sourceCompleted = true
  }
  finally {
    if (!committed) {
      committed = true
      const compactToolCalls = toolCalls.filter(slot => slot !== undefined)
      const capture: ModelRawResponseCapture = receivedChunkCount === 0
        ? {
            state: 'empty',
            lastEvent: null,
            textChars: 0,
            toolCallCount: 0,
          }
        : {
            state: sourceCompleted ? 'complete' : 'partial',
            lastEvent,
            textChars,
            toolCallCount: compactToolCalls.length,
            rawResponse: buildRawResponse({
              id,
              model,
              created,
              finishReason,
              usage,
              sawChoice,
              content: contentChunks.join(''),
              reasoningContent: reasoningContentChunks.join(''),
              toolCalls: compactToolCalls,
            }),
          }

      try {
        onResponse(capture)
      }
      catch {
        try {
          onCaptureError?.()
        }
        catch {
          // 捕获失败不得覆盖 Provider 流的完成、异常或 return 语义。
        }
      }
    }
  }
}

function buildRawResponse(input: {
  id: string | undefined
  model: string | undefined
  created: number | undefined
  finishReason: string | null
  usage: ChatCompletionChunk['usage'] | undefined
  sawChoice: boolean
  content: string
  reasoningContent: string
  toolCalls: RawToolCallSlot[]
}): unknown {
  return {
    id: input.id,
    object: 'chat.completion',
    created: input.created,
    model: input.model,
    choices: input.sawChoice
      ? [{
          index: 0,
          finish_reason: input.finishReason,
          message: {
            role: 'assistant',
            content: input.content.length > 0 ? input.content : null,
            ...(input.reasoningContent.length > 0
              ? { reasoning_content: input.reasoningContent }
              : {}),
            ...(input.toolCalls.length > 0
              ? { tool_calls: input.toolCalls }
              : {}),
          },
        }]
      : [],
    ...(input.usage ? { usage: input.usage } : {}),
  }
}
