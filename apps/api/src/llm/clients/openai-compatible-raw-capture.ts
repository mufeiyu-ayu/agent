import type { ChatCompletionChunk } from 'openai/resources/chat/completions'

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
 * 一份非流式形态的原始响应 JSON，流正常结束后交给 onResponse。
 *
 * 只做字段拼接，不做业务校验（校验属于 stream adapter 的职责）；
 * 流中途抛错时不产生捕获结果。
 */
export async function* teeRawResponseCapture(
  chunks: AsyncIterable<ChatCompletionChunk>,
  onResponse: (rawResponse: unknown) => void,
): AsyncGenerator<ChatCompletionChunk> {
  let id: string | undefined
  let model: string | undefined
  let created: number | undefined
  let finishReason: string | null = null
  let usage: ChatCompletionChunk['usage'] | undefined
  const contentChunks: string[] = []
  const reasoningContentChunks: string[] = []
  const toolCalls: RawToolCallSlot[] = []

  for await (const chunk of chunks) {
    id ??= chunk.id
    model ??= chunk.model
    created ??= chunk.created

    const choice = chunk.choices[0]

    if (choice) {
      const delta = choice.delta as ChatCompletionChunk.Choice.Delta & {
        reasoning_content?: string | null
      }

      if (delta.content)
        contentChunks.push(delta.content)
      if (delta.reasoning_content)
        reasoningContentChunks.push(delta.reasoning_content)

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
      }

      if (choice.finish_reason)
        finishReason = choice.finish_reason
    }

    if (chunk.usage)
      usage = chunk.usage

    yield chunk
  }

  const content = contentChunks.join('')
  const reasoningContent = reasoningContentChunks.join('')
  // index 由 provider 提供，可能非 0 起始或有空洞；压缩稀疏位，避免序列化出 null 项。
  const compactToolCalls = toolCalls.filter(slot => slot !== undefined)

  onResponse({
    id,
    object: 'chat.completion',
    created,
    model,
    choices: [
      {
        index: 0,
        finish_reason: finishReason,
        message: {
          role: 'assistant',
          content: content.length > 0 ? content : null,
          ...(reasoningContent.length > 0
            ? { reasoning_content: reasoningContent }
            : {}),
          ...(compactToolCalls.length > 0
            ? { tool_calls: compactToolCalls }
            : {}),
        },
      },
    ],
    ...(usage ? { usage } : {}),
  })
}
