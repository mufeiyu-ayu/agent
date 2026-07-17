import type {
  ApiErrorResponse,
  ChatStreamEvent,
  SeoChatRequest,
} from '@agent/contracts'

interface StreamChatWithSeoAgentOptions {
  signal?: AbortSignal
}

export async function* streamChatWithSeoAgent(
  payload: SeoChatRequest,
  options: StreamChatWithSeoAgentOptions = {},
): AsyncGenerator<ChatStreamEvent> {
  const response = await fetch('/api/seo/chat/stream', {
    method: 'POST',
    headers: {
      'Accept': 'application/x-ndjson',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
    ...(options.signal ? { signal: options.signal } : {}),
  })

  if (!response.ok) {
    throw new Error(await getStreamHttpErrorMessage(response))
  }

  if (!response.body) {
    throw new Error('流式响应体为空，请稍后重试')
  }

  yield* parseChatStreamEvents(response.body)
}

async function* parseChatStreamEvents(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<ChatStreamEvent> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  try {
    while (true) {
      const result = await reader.read()

      if (result.done)
        break

      buffer += decoder.decode(result.value, { stream: true })
      const lines = buffer.split(/\r?\n/)

      buffer = lines.pop() ?? ''

      for (const line of lines) {
        const event = parseChatStreamEventLine(line)

        if (event)
          yield event
      }
    }

    buffer += decoder.decode()

    if (buffer.trim()) {
      for (const line of buffer.split(/\r?\n/)) {
        const event = parseChatStreamEventLine(line)

        if (event)
          yield event
      }
    }
  }
  finally {
    reader.releaseLock()
  }
}

function parseChatStreamEventLine(line: string): ChatStreamEvent | null {
  const trimmedLine = line.trim()

  if (!trimmedLine)
    return null

  let value: unknown

  try {
    value = JSON.parse(trimmedLine) as unknown
  }
  catch {
    throw new Error('流式响应 JSON 解析失败，请稍后重试')
  }

  if (!isChatStreamEvent(value)) {
    throw new Error('流式响应事件格式不正确，请稍后重试')
  }

  return value
}

function isChatStreamEvent(value: unknown): value is ChatStreamEvent {
  if (!isRecord(value) || typeof value.type !== 'string')
    return false

  switch (value.type) {
    case 'start':
      return (
        typeof value.conversationId === 'string'
        && typeof value.userMessageId === 'string'
        && typeof value.assistantMessageId === 'string'
      )
    case 'delta':
      return (
        typeof value.conversationId === 'string'
        && typeof value.assistantMessageId === 'string'
        && typeof value.contentDelta === 'string'
      )
    case 'done':
      return (
        typeof value.conversationId === 'string'
        && typeof value.assistantMessageId === 'string'
        && typeof value.content === 'string'
        && typeof value.generatedAt === 'string'
      )
    case 'error':
      return (
        typeof value.conversationId === 'string'
        && typeof value.message === 'string'
        && (
          value.assistantMessageId === undefined
          || typeof value.assistantMessageId === 'string'
        )
      )
    case 'aborted':
      return (
        typeof value.conversationId === 'string'
        && typeof value.assistantMessageId === 'string'
        && typeof value.content === 'string'
      )
    default:
      return false
  }
}

async function getStreamHttpErrorMessage(response: Response): Promise<string> {
  try {
    const payload = await response.json() as Partial<ApiErrorResponse>

    if (typeof payload.message === 'string')
      return payload.message
  }
  catch {
    // 非 JSON 错误响应时使用 HTTP 状态码兜底。
  }

  return `请求失败（${response.status}）`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
