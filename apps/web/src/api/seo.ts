import type {
  ApiErrorResponse,
  ChatStreamEvent,
  MessageCitationV1,
  MessageGroundingV1,
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

/** 单行 NDJSON 解析入口；导出供协议回归测试直接消费。 */
export function parseChatStreamEventLine(line: string): ChatStreamEvent | null {
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

  return sanitizeChatStreamEvent(value)
}

/**
 * 保留已知事件语义，并安全接受 `done` 上可选的 grounding。
 *
 * 服务端投影层已经 fail closed；客户端这里再做一次形状校验，语义不合法时只丢弃
 * 这个可选字段，不让 UI / 审计元数据拖垮整条回答流。本 Task 不渲染来源卡片。
 */
function sanitizeChatStreamEvent(event: ChatStreamEvent): ChatStreamEvent {
  if (event.type !== 'done' || event.grounding === undefined)
    return event

  if (isMessageGroundingV1(event.grounding))
    return event

  const { grounding: _grounding, ...rest } = event

  return rest
}

function isMessageGroundingV1(value: unknown): value is MessageGroundingV1 {
  if (!isRecord(value))
    return false

  return (
    value.schemaVersion === 1
    && typeof value.evidenceAvailability === 'string'
    && typeof value.outcome === 'string'
    && value.citationIntegrity === 'validated'
    && value.faithfulnessStatus === 'not_evaluated'
    && Array.isArray(value.citations)
    && value.citations.every(isMessageCitationV1)
  )
}

function isMessageCitationV1(value: unknown): value is MessageCitationV1 {
  if (!isRecord(value))
    return false

  return (
    typeof value.citationId === 'string'
    && typeof value.sourceId === 'number'
    && (value.chunkId === null || typeof value.chunkId === 'string')
    && (value.granularity === 'article' || value.granularity === 'chunk')
    && typeof value.title === 'string'
    && typeof value.slug === 'string'
    && typeof value.languageCode === 'string'
    && (value.sectionPath === null || typeof value.sectionPath === 'string')
    && (value.excerpt === null || typeof value.excerpt === 'string')
    && (value.rank === null || typeof value.rank === 'number')
    && (value.href === null || typeof value.href === 'string')
    && isRecord(value.strategy)
    && typeof value.strategy.name === 'string'
    && typeof value.strategy.version === 'string'
  )
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
    // grounding 是 done 上的可选 UI / 审计元数据，由 sanitizeChatStreamEvent 单独处理：
    // 它损坏时不应该让整条回答流失败。
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
